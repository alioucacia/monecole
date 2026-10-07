"""Sauvegarde de toute la base (toutes écoles) au format JSON compressé — partagée par la
commande planifiée `backup_daily` et le bouton « Lancer une sauvegarde » du Super Admin.

Le bouton lance la sauvegarde en arrière-plan, dans un processus séparé (`lancer_en_arriere_plan`) :
exécutée dans la requête HTTP, elle dépassait le délai de 30 s de nginx/gunicorn dès que la base
grossit (même une petite base locale prend déjà ~15 s), la requête était coupée et la sauvegarde
ne se faisait pas."""

import gzip
import os
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.utils import timezone

from .models import SauvegardeLog

# Sauvegardes conservées 30 jours glissants ; au-delà, seul le fichier est supprimé
# (l'historique dans SauvegardeLog, lui, est conservé indéfiniment pour la traçabilité).
RETENTION_JOURS = 30

# Tables techniques qu'il est inutile de sauvegarder chaque jour (régénérées par Django).
EXCLURE = ["contenttypes", "auth.permission", "sessions.session", "admin.logentry"]

# Au-delà, une sauvegarde « en cours » est considérée comme interrompue (serveur redémarré
# pendant l'exécution, ou ancienne sauvegarde coupée par le délai de 30 s quand elle s'exécutait
# encore dans la requête) : marquée en échec, elle n'empêche plus d'en relancer une.
DUREE_MAX_EN_COURS = timedelta(minutes=30)


def dossier_sauvegardes() -> Path:
    dossier = Path(settings.BASE_DIR) / "backups"
    dossier.mkdir(exist_ok=True)
    return dossier


def executer_sauvegarde(log: SauvegardeLog | None = None) -> SauvegardeLog:
    """Exécute la sauvegarde et renseigne `log` (créé s'il n'est pas fourni) : succès avec
    fichier/taille/durée, ou échec avec le message d'erreur. Le fichier est écrit directement
    compressé en UTF-8 au fil de l'écriture de `dumpdata`, sans garder toute la base en
    mémoire (et quel que soit l'encodage par défaut du système : les emojis des messages, par
    exemple, faisaient échouer l'écriture avec l'encodage de Windows)."""
    debut = time.monotonic()
    dossier = dossier_sauvegardes()
    fichier = dossier / f"backup_{timezone.localtime():%Y%m%d_%H%M%S}.json.gz"
    if log is None:
        log = SauvegardeLog.objects.create(statut=SauvegardeLog.Statut.EN_COURS, message="Sauvegarde en cours…")
    try:
        exclusions = []
        for app_label in EXCLURE:
            exclusions += ["--exclude", app_label]
        with gzip.open(fichier, "wt", encoding="utf-8") as sortie:
            call_command("dumpdata", "--natural-foreign", "--natural-primary", *exclusions, stdout=sortie)
        taille = fichier.stat().st_size
        log.fichier = fichier.name
        log.taille_octets = taille
        log.statut = SauvegardeLog.Statut.SUCCES
        log.message = f"Sauvegarde réussie ({taille / 1024:.1f} Ko)."
    except Exception as exc:  # noqa: BLE001 — on veut tracer n'importe quelle erreur de sauvegarde
        fichier.unlink(missing_ok=True)
        log.fichier = ""
        log.taille_octets = 0
        log.statut = SauvegardeLog.Statut.ECHEC
        log.message = str(exc)[:500] or exc.__class__.__name__
    log.duree_secondes = round(time.monotonic() - debut, 2)
    log.save()
    if log.statut == SauvegardeLog.Statut.SUCCES:
        purger_anciennes_sauvegardes(dossier)
    return log


def purger_anciennes_sauvegardes(dossier: Path):
    seuil = time.time() - RETENTION_JOURS * 86400
    for fichier in dossier.glob("backup_*.json.gz"):
        if fichier.stat().st_mtime < seuil:
            fichier.unlink(missing_ok=True)


def marquer_sauvegardes_interrompues() -> None:
    """Passe en échec les sauvegardes restées « en cours » au-delà de DUREE_MAX_EN_COURS —
    sans cela, elles restaient « en cours » indéfiniment et la page Sauvegardes gardait le
    bouton « Lancer une sauvegarde » désactivé pour toujours."""
    bloquees = SauvegardeLog.objects.filter(
        statut=SauvegardeLog.Statut.EN_COURS, date_lancement__lt=timezone.now() - DUREE_MAX_EN_COURS,
    )
    for log in bloquees:
        message = "Sauvegarde interrompue (serveur redémarré ou délai dépassé pendant l'exécution)."
        detail = _fin_du_journal(log.pk)
        if detail:
            message = f"{message} Détail : {detail}"
        log.statut = SauvegardeLog.Statut.ECHEC
        log.message = message[:500]
        log.save(update_fields=["statut", "message"])


def _fin_du_journal(log_id: int) -> str:
    """Dernières lignes du journal du processus de sauvegarde, s'il concerne bien `log_id`."""
    try:
        lignes = fichier_journal().read_text(encoding="utf-8", errors="replace").strip().splitlines()
    except OSError:
        return ""
    if not lignes or not lignes[0].startswith(f"Sauvegarde #{log_id} "):
        return ""
    return " | ".join(lignes[1:][-4:])


def sauvegarde_en_cours() -> SauvegardeLog | None:
    marquer_sauvegardes_interrompues()
    return SauvegardeLog.objects.filter(
        statut=SauvegardeLog.Statut.EN_COURS, date_lancement__gte=timezone.now() - DUREE_MAX_EN_COURS,
    ).first()


def fichier_journal() -> Path:
    """Sortie du dernier processus de sauvegarde lancé depuis la page Super Admin — contient
    l'erreur exacte si le processus meurt sans pouvoir la noter dans SauvegardeLog."""
    return dossier_sauvegardes() / "derniere_sauvegarde.log"


def lancer_en_arriere_plan() -> SauvegardeLog:
    """Crée l'entrée « en cours » et exécute la sauvegarde dans un PROCESSUS séparé
    (`manage.py backup_daily --log-id`) : la requête HTTP répond immédiatement, la page
    Sauvegardes suit l'avancement en rechargeant l'historique.

    Pas un thread du processus web : un worker Gunicorn arrêté ou redémarré (déploiement,
    recyclage) ou tué faute de mémoire pendant l'export emportait la sauvegarde avec lui, qui
    restait « en cours » sans aucune erreur. Le processus séparé (nouvelle session) n'en dépend
    plus, et sa sortie est écrite dans `fichier_journal()`."""
    log = SauvegardeLog.objects.create(statut=SauvegardeLog.Statut.EN_COURS, message="Sauvegarde en cours…")
    lancer_commande_detachee(
        ["backup_daily", "--log-id", str(log.pk)], fichier_journal(),
        f"Sauvegarde #{log.pk} lancée le {timezone.localtime():%d/%m/%Y %H:%M:%S}",
    )
    return log


def lancer_commande_detachee(arguments: list[str], journal: Path, entete: str) -> None:
    """Lance `manage.py <arguments>` dans un processus indépendant du worker web (nouvelle
    session), sa sortie écrite dans `journal` après la ligne `entete`. Partagé avec la
    sauvegarde / restauration des écoles (core/sauvegarde_ecole.py)."""
    commande = [sys.executable, str(Path(settings.BASE_DIR) / "manage.py"), *arguments]
    options = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if os.name == "nt"
        else {"start_new_session": True}
    )
    with open(journal, "w", encoding="utf-8") as sortie:
        sortie.write(f"{entete}\n")
        sortie.flush()
        subprocess.Popen(
            commande, cwd=settings.BASE_DIR, stdin=subprocess.DEVNULL, stdout=sortie, stderr=subprocess.STDOUT,
            close_fds=True, **options,
        )
