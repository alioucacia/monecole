"""Sauvegarde et restauration des données d'UNE école par son propre Administrateur (page
« Sauvegarde & restauration ») — à distinguer de la sauvegarde de toute la plateforme réservée
au Super Admin (core/sauvegarde.py).

Archive (.zip) :
- `donnees.json`  : les données de l'école, sérialisées par Django en gardant leurs identifiants ;
- `media/…`       : les fichiers associés (photos, logo, justificatifs, couvertures…) ;
- `manifeste.json`: école, date, nombre d'éléments, empreintes SHA-256 des données et fichiers ;
- `signature`     : HMAC du manifeste avec la SECRET_KEY du serveur.

La signature garantit qu'une archive a été produite par cette plateforme POUR CETTE ÉCOLE et
n'a pas été retouchée : une archive modifiée (ou celle d'une autre école) ne peut pas servir à
écrire dans les données d'un autre établissement ni à créer des comptes arbitraires.

Restauration (dans UNE transaction — si une étape échoue, rien n'est modifié) :
1. sauvegarde automatique de l'état actuel (pour pouvoir revenir en arrière) ;
2. suppression des données actuelles de l'école (périmètre `PERIMETRE`) ;
3. réinsertion des données de l'archive avec leurs identifiants d'origine.
Les comptes Administrateur existants sont conservés tels quels (mot de passe actuel compris),
pour que la personne qui restaure garde son accès ; les comptes des autres rôles reprennent
leur état sauvegardé. L'abonnement, la facturation, les tickets de support et le journal de la
plateforme ne sont jamais touchés.

Exécution en arrière-plan (`manage.py sauvegarde_ecole --operation-id`), comme la sauvegarde de
la plateforme : une grosse école dépasserait le délai de 30 s d'une requête HTTP."""

import hashlib
import json
import tempfile
import time
import zipfile
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath

from django.apps import apps
from django.conf import settings
from django.core import serializers
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from .models import OperationSauvegardeEcole

FORMAT = 1
SEL_SIGNATURE = "core.sauvegarde_ecole"

# Archives conservées par école (sauvegardes manuelles, automatiques et importées confondues) ;
# au-delà, les plus anciennes sont supprimées du disque (leur ligne d'historique reste).
NOMBRE_ARCHIVES_CONSERVEES = 10

# Taille maximale d'une archive importée (voir aussi client_max_body_size dans nginx.conf).
TAILLE_MAX_IMPORT = 500 * 1024 * 1024

DUREE_MAX_EN_COURS = timedelta(minutes=30)

# Données de l'école, des « parents » aux « enfants » : (modèle, chemins vers l'école). Un
# objet fait partie de l'école quand TOUS ses chemins y mènent (messages : expéditeur ET
# destinataire de l'école — un échange avec le Super Admin n'en fait pas partie).
# Tout nouveau modèle rattaché à une école doit être ajouté ici ou à MODELES_HORS_PERIMETRE
# (vérifié par les tests).
PERIMETRE = [
    ("accounts.User", ("ecole",)),
    ("accounts.JournalUtilisateur", ("utilisateur__ecole",)),
    ("academics.AnneeScolaire", ("ecole",)),
    ("academics.Matiere", ("ecole",)),
    ("academics.Classe", ("annee_scolaire__ecole",)),
    ("academics.Enseignement", ("classe__annee_scolaire__ecole",)),
    ("academics.Creneau", ("classe__annee_scolaire__ecole",)),
    ("academics.ChapitreProgramme", ("classe__annee_scolaire__ecole",)),
    ("grades.Periode", ("annee_scolaire__ecole",)),
    ("people.EleveProfile", ("user__ecole",)),
    ("people.EnseignantProfile", ("user__ecole",)),
    ("people.HistoriqueClasse", ("eleve__user__ecole",)),
    ("people.EleveBadge", ("eleve__user__ecole",)),
    ("people.EnseignantBadge", ("enseignant__user__ecole",)),
    ("people.PointageEnseignant", ("enseignant__user__ecole",)),
    ("people.PaieEnseignant", ("enseignant__user__ecole",)),
    ("people.GroupeRevision", ("enseignant__ecole",)),
    ("people.MessageIA", ("eleve__user__ecole",)),
    ("people.AlerteParent", ("eleve__user__ecole",)),
    ("people.RendezVous", ("ecole",)),
    ("grades.Note", ("eleve__user__ecole",)),
    ("attendance.Presence", ("eleve__user__ecole",)),
    ("attendance.JustificatifAbsence", ("eleve__user__ecole",)),
    ("payments.TypeFrais", ("ecole",)),
    ("payments.TarifClasse", ("ecole",)),
    ("payments.Frais", ("eleve__user__ecole",)),
    ("payments.Paiement", ("frais__eleve__user__ecole",)),
    ("payments.CategorieDepense", ("ecole",)),
    ("payments.Depense", ("ecole",)),
    ("announcements.Annonce", ("ecole",)),
    ("library.Livre", ("ecole",)),
    ("library.Emprunt", ("livre__ecole",)),
    ("transport.Trajet", ("ecole",)),
    ("transport.AffectationTransport", ("trajet__ecole",)),
    ("transport.PointageTransport", ("trajet__ecole",)),
    ("transport.TicketBus", ("affectation__trajet__ecole",)),
    ("cantine.Formule", ("ecole",)),
    ("cantine.InscriptionCantine", ("formule__ecole",)),
    ("cantine.PointageCantine", ("formule__ecole",)),
    ("cantine.TicketCantine", ("inscription__formule__ecole",)),
    ("acces.Equipement", ("ecole",)),
    ("acces.CarteAcces", ("ecole",)),
    ("acces.Passage", ("ecole",)),
    ("messaging.Message", ("expediteur__ecole", "destinataire__ecole")),
    ("visio.Reunion", ("ecole",)),
    ("tenants.ParametresEcole", ("ecole",)),
    ("tenants.ModeleMessage", ("ecole",)),
    ("core.DocumentOfficiel", ("ecole",)),
    ("core.RapportAnnuel", ("ecole",)),
]

# Modèles volontairement exclus : sécurité des comptes (codes, sessions, appareils — jamais
# restaurés), plateforme (abonnement, facturation, support, journaux), et l'école elle-même
# (seuls ses champs de `CHAMPS_ECOLE` sont restaurés).
MODELES_HORS_PERIMETRE = {
    "accounts.CodeOTP", "accounts.SessionActive", "accounts.AppareilConnu", "accounts.EvenementSecurite",
    "tenants.Ecole", "tenants.PlanAbonnement", "tenants.PaiementEcole", "tenants.TransactionAbonnement",
    "tenants.ParametresPlateforme", "tenants.JournalActivite",
    "core.SauvegardeLog", "core.OperationSauvegardeEcole",
    "support.Ticket", "support.MessageTicket",
}

# Champs de l'école modifiables par son Administrateur (voir MonEcoleSerializer) : ce sont les
# seuls restaurés — abonnement, modules et personnalisation restent décidés par le Super Admin.
CHAMPS_ECOLE = [
    "nom", "adresse", "telephone", "email", "logo", "ire", "dpe", "dsee",
    "entete_ministere_1", "entete_ministere_2", "entete_republique", "entete_devise",
]

# Résumé affiché dans l'historique.
LIBELLES_RESUME = {
    "people.EleveProfile": "eleves",
    "people.EnseignantProfile": "enseignants",
    "accounts.User": "comptes",
    "academics.Classe": "classes",
    "grades.Note": "notes",
    "attendance.Presence": "presences",
    "payments.Paiement": "paiements",
    "payments.Depense": "depenses",
}


class ArchiveInvalide(Exception):
    """Archive illisible, retouchée, d'une autre école ou incompatible — message affichable."""


# --------------------------------------------------------------------------------------------
# Fichiers et historique
# --------------------------------------------------------------------------------------------

def dossier_ecole(ecole_id: int) -> Path:
    dossier = Path(settings.BASE_DIR) / "backups" / "ecoles" / str(ecole_id)
    dossier.mkdir(parents=True, exist_ok=True)
    return dossier


def chemin_archive(operation: OperationSauvegardeEcole) -> Path | None:
    if not operation.fichier:
        return None
    chemin = dossier_ecole(operation.ecole_id) / Path(operation.fichier).name
    return chemin if chemin.exists() else None


def fichier_journal(ecole_id: int) -> Path:
    return dossier_ecole(ecole_id) / "derniere_operation.log"


def marquer_operations_interrompues(ecole_id: int) -> None:
    OperationSauvegardeEcole.objects.filter(
        ecole_id=ecole_id, statut=OperationSauvegardeEcole.Statut.EN_COURS,
        date_lancement__lt=timezone.now() - DUREE_MAX_EN_COURS,
    ).update(
        statut=OperationSauvegardeEcole.Statut.ECHEC,
        message="Opération interrompue (serveur redémarré ou délai dépassé pendant l'exécution).",
    )


def operation_en_cours(ecole_id: int) -> OperationSauvegardeEcole | None:
    marquer_operations_interrompues(ecole_id)
    return OperationSauvegardeEcole.objects.filter(
        ecole_id=ecole_id, statut=OperationSauvegardeEcole.Statut.EN_COURS,
    ).first()


def lancer_en_arriere_plan(operation: OperationSauvegardeEcole) -> OperationSauvegardeEcole:
    from .sauvegarde import lancer_commande_detachee

    lancer_commande_detachee(
        ["sauvegarde_ecole", "--operation-id", str(operation.pk)], fichier_journal(operation.ecole_id),
        f"{operation.get_type_display()} #{operation.pk} lancée le {timezone.localtime():%d/%m/%Y %H:%M:%S}",
    )
    return operation


def purger_anciennes_archives(ecole_id: int) -> None:
    anciennes = OperationSauvegardeEcole.objects.filter(
        ecole_id=ecole_id, type=OperationSauvegardeEcole.Type.SAUVEGARDE,
        statut=OperationSauvegardeEcole.Statut.SUCCES,
    ).exclude(fichier="")[NOMBRE_ARCHIVES_CONSERVEES:]
    for operation in anciennes:
        chemin = chemin_archive(operation)
        if chemin:
            chemin.unlink(missing_ok=True)
        operation.fichier = ""
        operation.message = (
            f"{operation.message} Archive supprimée du serveur (seules les {NOMBRE_ARCHIVES_CONSERVEES} "
            "plus récentes sont conservées)."
        ).strip()[:500]
        operation.save(update_fields=["fichier", "message"])


# --------------------------------------------------------------------------------------------
# Périmètre
# --------------------------------------------------------------------------------------------

def _modele(label: str):
    return apps.get_model(label)


def _queryset(label: str, chemins: tuple[str, ...], ecole):
    return _modele(label).objects.filter(**{chemin: ecole for chemin in chemins})


def _champs_fichier(modele) -> list[str]:
    return [f.attname for f in modele._meta.concrete_fields if f.get_internal_type() in ("FileField", "ImageField")]


def _signer(contenu: bytes) -> str:
    return salted_hmac(SEL_SIGNATURE, contenu, algorithm="sha256").hexdigest()


def _sha256_fichier(chemin: Path) -> str:
    empreinte = hashlib.sha256()
    with open(chemin, "rb") as source:
        for bloc in iter(lambda: source.read(1024 * 1024), b""):
            empreinte.update(bloc)
    return empreinte.hexdigest()


def _resume(comptes: dict[str, int]) -> dict[str, int]:
    return {cle: comptes.get(label, 0) for label, cle in LIBELLES_RESUME.items()}


# --------------------------------------------------------------------------------------------
# Sauvegarde
# --------------------------------------------------------------------------------------------

def exporter_ecole(ecole, destination: Path) -> dict:
    """Écrit l'archive de `ecole` dans `destination` ; renvoie le manifeste."""
    from tenants.models import Ecole

    comptes: dict[str, int] = {}
    chemins_media: set[str] = set(filter(None, [ecole.logo.name if ecole.logo else ""]))

    with tempfile.TemporaryDirectory(dir=destination.parent) as temporaire:
        fichier_donnees = Path(temporaire) / "donnees.json"

        def objets():
            yield from Ecole.objects.filter(pk=ecole.pk)
            for label, chemins in PERIMETRE:
                queryset = _queryset(label, chemins, ecole).order_by("pk")
                comptes[label] = queryset.count()
                champs = _champs_fichier(queryset.model)
                if champs:
                    for valeurs in queryset.values_list(*champs):
                        chemins_media.update(v for v in valeurs if v)
                yield from queryset.iterator(chunk_size=2000)

        with open(fichier_donnees, "w", encoding="utf-8") as sortie:
            serializers.serialize("json", objets(), stream=sortie)

        fichiers = {}
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            archive.write(fichier_donnees, "donnees.json")
            for nom in sorted(chemins_media):
                # Un fichier référencé mais absent du disque (supprimé à la main…) ne doit pas
                # empêcher la sauvegarde des données elles-mêmes.
                if not default_storage.exists(nom):
                    continue
                with default_storage.open(nom, "rb") as source, archive.open(f"media/{nom}", "w") as cible:
                    empreinte = hashlib.sha256()
                    for bloc in iter(lambda: source.read(1024 * 1024), b""):
                        empreinte.update(bloc)
                        cible.write(bloc)
                fichiers[nom] = empreinte.hexdigest()

            manifeste = {
                "format": FORMAT,
                "ecole_id": ecole.pk,
                "ecole_nom": ecole.nom,
                "cree_le": timezone.now().isoformat(),
                "comptes": comptes,
                "donnees_sha256": _sha256_fichier(fichier_donnees),
                "fichiers": fichiers,
            }
            contenu = json.dumps(manifeste, ensure_ascii=False, indent=2).encode("utf-8")
            archive.writestr("manifeste.json", contenu)
            archive.writestr("signature", _signer(contenu))
    return manifeste


def executer_sauvegarde(operation: OperationSauvegardeEcole) -> OperationSauvegardeEcole:
    debut = time.monotonic()
    ecole = operation.ecole
    nom = f"sauvegarde_{ecole.slug or ecole.pk}_{timezone.localtime():%Y%m%d_%H%M%S}_{operation.pk}.zip"
    destination = dossier_ecole(ecole.pk) / nom
    try:
        manifeste = exporter_ecole(ecole, destination)
        operation.fichier = nom
        operation.taille_octets = destination.stat().st_size
        operation.resume = _resume(manifeste["comptes"])
        operation.statut = OperationSauvegardeEcole.Statut.SUCCES
        operation.message = f"Sauvegarde réussie ({operation.taille_octets / (1024 * 1024):.1f} Mo)."
    except Exception as exc:  # noqa: BLE001 — toute erreur est tracée dans l'historique
        destination.unlink(missing_ok=True)
        operation.fichier = ""
        operation.statut = OperationSauvegardeEcole.Statut.ECHEC
        operation.message = (str(exc) or exc.__class__.__name__)[:500]
    operation.duree_secondes = round(time.monotonic() - debut, 2)
    operation.save()
    if operation.statut == OperationSauvegardeEcole.Statut.SUCCES:
        purger_anciennes_archives(ecole.pk)
    return operation


# --------------------------------------------------------------------------------------------
# Lecture / vérification d'une archive
# --------------------------------------------------------------------------------------------

def _chemin_media_sur(nom: str) -> bool:
    chemin = PurePosixPath(nom)
    return bool(nom) and not chemin.is_absolute() and ".." not in chemin.parts and "\\" not in nom


def verifier_archive(chemin: Path, ecole) -> dict:
    """Vérifie signature, école et intégrité des données ; renvoie le manifeste."""
    try:
        with zipfile.ZipFile(chemin) as archive:
            noms = set(archive.namelist())
            if not {"manifeste.json", "donnees.json", "signature"} <= noms:
                raise ArchiveInvalide("Ce fichier n'est pas une sauvegarde d'école de la plateforme.")
            if archive.getinfo("manifeste.json").file_size > 20 * 1024 * 1024:
                raise ArchiveInvalide("Manifeste de sauvegarde invalide.")
            contenu = archive.read("manifeste.json")
            signature = archive.read("signature").decode("ascii", errors="replace").strip()
            if not constant_time_compare(signature, _signer(contenu)):
                raise ArchiveInvalide(
                    "Signature invalide : ce fichier a été modifié, ou n'a pas été produit par cette plateforme."
                )
            manifeste = json.loads(contenu)
            if manifeste.get("format") != FORMAT:
                raise ArchiveInvalide("Format de sauvegarde non pris en charge.")
            if manifeste.get("ecole_id") != ecole.pk:
                raise ArchiveInvalide(
                    f"Cette sauvegarde appartient à un autre établissement (« {manifeste.get('ecole_nom', '?')} ») "
                    "et ne peut pas être restaurée ici."
                )
            empreinte = hashlib.sha256()
            with archive.open("donnees.json") as donnees:
                for bloc in iter(lambda: donnees.read(1024 * 1024), b""):
                    empreinte.update(bloc)
            if empreinte.hexdigest() != manifeste.get("donnees_sha256"):
                raise ArchiveInvalide("Les données de la sauvegarde sont corrompues.")
            if not all(_chemin_media_sur(nom) for nom in manifeste.get("fichiers", {})):
                raise ArchiveInvalide("Sauvegarde invalide (chemin de fichier non autorisé).")
            return manifeste
    except (zipfile.BadZipFile, OSError, ValueError, KeyError) as exc:
        raise ArchiveInvalide("Fichier de sauvegarde illisible ou endommagé.") from exc


def importer_archive(fichier_televerse, ecole, auteur) -> OperationSauvegardeEcole:
    """Enregistre une archive téléversée (après vérification) comme sauvegarde importée."""
    if fichier_televerse.size > TAILLE_MAX_IMPORT:
        raise ArchiveInvalide(f"Fichier trop volumineux (maximum {TAILLE_MAX_IMPORT // (1024 * 1024)} Mo).")
    nom = f"import_{ecole.slug or ecole.pk}_{timezone.localtime():%Y%m%d_%H%M%S}.zip"
    destination = dossier_ecole(ecole.pk) / nom
    with open(destination, "wb") as sortie:
        for bloc in fichier_televerse.chunks():
            sortie.write(bloc)
    try:
        manifeste = verifier_archive(destination, ecole)
    except ArchiveInvalide:
        destination.unlink(missing_ok=True)
        raise
    cree_le = manifeste.get("cree_le", "")
    try:
        date_sauvegarde = f" du {timezone.localtime(datetime.fromisoformat(cree_le)):%d/%m/%Y à %H:%M}"
    except (TypeError, ValueError):
        date_sauvegarde = ""
    operation = OperationSauvegardeEcole.objects.create(
        ecole=ecole, type=OperationSauvegardeEcole.Type.SAUVEGARDE, origine=OperationSauvegardeEcole.Origine.IMPORTEE,
        statut=OperationSauvegardeEcole.Statut.SUCCES, auteur=auteur, fichier=nom,
        taille_octets=destination.stat().st_size, resume=_resume(manifeste.get("comptes", {})),
        message=f"Sauvegarde{date_sauvegarde} importée depuis « {Path(fichier_televerse.name).name[:150]} ».",
    )
    purger_anciennes_archives(ecole.pk)
    return operation


# --------------------------------------------------------------------------------------------
# Restauration
# --------------------------------------------------------------------------------------------

def restaurer_ecole(ecole, chemin: Path) -> dict:
    """Remplace les données de `ecole` par celles de l'archive `chemin` ; renvoie le nombre
    d'éléments restaurés par modèle. Lève ArchiveInvalide si la restauration est impossible."""
    from accounts.models import User
    from tenants.models import ParametresEcole

    manifeste = verifier_archive(chemin, ecole)
    perimetre = dict(PERIMETRE)
    with zipfile.ZipFile(chemin) as archive, archive.open("donnees.json") as donnees:
        try:
            objets = list(serializers.deserialize("json", donnees, ignorenonexistent=True))
        except serializers.base.DeserializationError as exc:
            raise ArchiveInvalide(
                "Les données de cette sauvegarde ne correspondent plus à la version actuelle de l'application."
            ) from exc

    etat_ecole = None
    par_modele: dict[str, list] = {label: [] for label in perimetre}
    for objet in objets:
        label = objet.object._meta.label
        if label == "tenants.Ecole" and objet.object.pk == ecole.pk:
            etat_ecole = objet.object
        elif label in perimetre:
            par_modele[label].append(objet)
        else:
            raise ArchiveInvalide(f"Sauvegarde invalide (type de données inattendu : {label}).")

    utilisateurs = par_modele["accounts.User"]
    for objet in utilisateurs:
        compte = objet.object
        if compte.ecole_id != ecole.pk or compte.role == User.Role.SUPERADMIN or compte.is_superuser:
            raise ArchiveInvalide("Sauvegarde invalide (compte n'appartenant pas à l'établissement).")

    comptes = Counter()
    with transaction.atomic(), connection.constraint_checks_disabled():
        # 1. Données actuelles (hors comptes), des « enfants » aux « parents » : les frais
        #    avant leurs types (PROTECT), les dépenses avant leurs catégories…
        for label, chemins in reversed(PERIMETRE):
            if label != "accounts.User":
                _queryset(label, chemins, ecole).delete()

        # 2. Comptes : ceux créés depuis la sauvegarde disparaissent (sauf les Administrateurs,
        #    toujours conservés) ; les autres sont mis à jour, et non supprimés puis recréés,
        #    pour ne pas emporter leurs tickets de support.
        ids_sauvegardes = {objet.object.pk for objet in utilisateurs}
        User.objects.filter(ecole=ecole).exclude(role=User.Role.ADMIN).exclude(pk__in=ids_sauvegardes).delete()
        existants = dict(User.objects.filter(pk__in=ids_sauvegardes).values_list("pk", "ecole_id"))
        admins_actuels = set(
            User.objects.filter(pk__in=ids_sauvegardes, role=User.Role.ADMIN).values_list("pk", flat=True)
        )
        if any(ecole_id != ecole.pk for ecole_id in existants.values()):
            raise ArchiveInvalide("Restauration impossible : un compte de la sauvegarde appartient à un autre établissement.")

        # 3. Un identifiant encore présent appartient forcément à une autre école (tout ce qui
        #    était à celle-ci vient d'être supprimé) : refuser plutôt que l'écraser.
        for label, liste in par_modele.items():
            if label == "accounts.User" or not liste:
                continue
            if _modele(label).objects.filter(pk__in=[objet.object.pk for objet in liste]).exists():
                raise ArchiveInvalide(
                    "Restauration impossible : certaines données de la sauvegarde sont en conflit avec "
                    "celles d'un autre établissement."
                )

        # 4. Réinsertion, des « parents » aux « enfants ».
        try:
            for label, _chemins in PERIMETRE:
                for objet in par_modele[label]:
                    if label == "accounts.User" and objet.object.pk in admins_actuels:
                        continue
                    objet.save()
                    comptes[label] += 1

            if etat_ecole is not None:
                for champ in CHAMPS_ECOLE:
                    setattr(ecole, champ, getattr(etat_ecole, champ))
                ecole.save(update_fields=CHAMPS_ECOLE)
            ParametresEcole.objects.get_or_create(ecole=ecole)

            tables = {_modele(label)._meta.db_table for label in perimetre}
            connection.check_constraints(table_names=sorted(tables))
        except IntegrityError as exc:
            raise ArchiveInvalide(
                "Restauration impossible : les données de la sauvegarde sont incohérentes avec la base actuelle "
                f"(par exemple un identifiant ou un matricule déjà utilisé ailleurs). Détail : {str(exc)[:200]}"
            ) from exc

    _restaurer_fichiers(chemin, manifeste)
    return dict(comptes)


def _restaurer_fichiers(chemin: Path, manifeste: dict) -> None:
    """Remet les fichiers manquants (photos supprimées depuis…) ; les fichiers encore présents
    ne sont pas réécrits."""
    with zipfile.ZipFile(chemin) as archive:
        for nom, empreinte in manifeste.get("fichiers", {}).items():
            if not _chemin_media_sur(nom) or default_storage.exists(nom):
                continue
            try:
                contenu = archive.read(f"media/{nom}")
            except KeyError:
                continue
            if hashlib.sha256(contenu).hexdigest() == empreinte:
                default_storage.save(nom, ContentFile(contenu))


def executer_restauration(operation: OperationSauvegardeEcole) -> OperationSauvegardeEcole:
    debut = time.monotonic()
    source = operation.source
    chemin = chemin_archive(source) if source else None
    try:
        if chemin is None:
            raise ArchiveInvalide("L'archive de cette sauvegarde n'est plus disponible sur le serveur.")
        # Filet de sécurité : l'état actuel est sauvegardé avant d'être remplacé.
        avant = OperationSauvegardeEcole.objects.create(
            ecole=operation.ecole, type=OperationSauvegardeEcole.Type.SAUVEGARDE,
            origine=OperationSauvegardeEcole.Origine.AVANT_RESTAURATION, auteur=operation.auteur,
            message="Sauvegarde automatique avant restauration…",
        )
        avant = executer_sauvegarde(avant)
        if avant.statut != OperationSauvegardeEcole.Statut.SUCCES:
            raise ArchiveInvalide(
                f"Restauration annulée : la sauvegarde préalable de l'état actuel a échoué ({avant.message})"
            )
        comptes = restaurer_ecole(operation.ecole, chemin)
        operation.resume = _resume(comptes)
        operation.statut = OperationSauvegardeEcole.Statut.SUCCES
        operation.message = (
            f"Données restaurées depuis la sauvegarde du {timezone.localtime(source.date_lancement):%d/%m/%Y à %H:%M}. "
            "L'état précédent a été sauvegardé automatiquement."
        )
    except ArchiveInvalide as exc:
        operation.statut = OperationSauvegardeEcole.Statut.ECHEC
        operation.message = str(exc)[:500]
    except Exception as exc:  # noqa: BLE001 — toute erreur est tracée dans l'historique
        operation.statut = OperationSauvegardeEcole.Statut.ECHEC
        operation.message = f"Échec de la restauration, aucune donnée n'a été modifiée. Détail : {exc}"[:500]
    operation.duree_secondes = round(time.monotonic() - debut, 2)
    operation.save()
    return operation


def executer(operation: OperationSauvegardeEcole) -> OperationSauvegardeEcole:
    if operation.type == OperationSauvegardeEcole.Type.RESTAURATION:
        return executer_restauration(operation)
    return executer_sauvegarde(operation)
