"""Sauvegarde de toute la base (toutes écoles) au format JSON compressé — partagée par la
commande planifiée `backup_daily` et le bouton « Lancer une sauvegarde » du Super Admin.

Le bouton lance la sauvegarde en arrière-plan (`lancer_en_arriere_plan`) : exécutée dans la
requête HTTP, elle dépassait le délai de 30 s de nginx/gunicorn dès que la base grossit (même une
petite base locale prend déjà ~15 s), la requête était coupée et la sauvegarde ne se faisait pas."""

import gzip
import threading
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.utils import timezone

from .models import SauvegardeLog

# Sauvegardes conservées 30 jours glissants ; au-delà, seul le fichier est supprimé
# (l'historique dans SauvegardeLog, lui, est conservé indéfiniment pour la traçabilité).
RETENTION_JOURS = 30

# Tables techniques qu'il est inutile de sauvegarder chaque jour (régénérées par Django).
EXCLURE = ["contenttypes", "auth.permission", "sessions.session", "admin.logentry"]

# Au-delà, une sauvegarde « en cours » est considérée comme interrompue (serveur redémarré
# pendant l'exécution) et n'empêche plus d'en relancer une.
DUREE_MAX_EN_COURS = timedelta(hours=1)


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


def sauvegarde_en_cours() -> SauvegardeLog | None:
    return SauvegardeLog.objects.filter(
        statut=SauvegardeLog.Statut.EN_COURS, date_lancement__gte=timezone.now() - DUREE_MAX_EN_COURS,
    ).first()


def lancer_en_arriere_plan() -> SauvegardeLog:
    """Crée l'entrée « en cours » et exécute la sauvegarde dans un thread : la requête HTTP
    répond immédiatement, la page Sauvegardes suit l'avancement en rechargeant l'historique."""
    log = SauvegardeLog.objects.create(statut=SauvegardeLog.Statut.EN_COURS, message="Sauvegarde en cours…")

    def travail():
        close_old_connections()
        try:
            executer_sauvegarde(log)
        finally:
            connection.close()  # connexion propre à ce thread

    threading.Thread(target=travail, name=f"sauvegarde-{log.pk}", daemon=True).start()
    return log
