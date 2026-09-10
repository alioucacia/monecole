import gzip
import time
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import SauvegardeLog

# Sauvegardes conservées 30 jours glissants ; au-delà, seul le fichier est supprimé
# (l'historique dans SauvegardeLog, lui, est conservé indéfiniment pour la traçabilité).
RETENTION_JOURS = 30

# Tables techniques qu'il est inutile de sauvegarder chaque jour (régénérées par Django).
EXCLURE = ["contenttypes", "auth.permission", "sessions.session", "admin.logentry"]


class Command(BaseCommand):
    help = "Sauvegarde journalière de toute la base de données (toutes écoles) au format JSON compressé."

    def handle(self, *args, **options):
        debut = time.monotonic()
        backups_dir = Path(settings.BASE_DIR) / "backups"
        backups_dir.mkdir(exist_ok=True)

        horodatage = timezone.localtime().strftime("%Y%m%d_%H%M%S")
        fichier = backups_dir / f"backup_{horodatage}.json.gz"

        try:
            buffer = StringIO()
            exclude_args = []
            for app_label in EXCLURE:
                exclude_args += ["--exclude", app_label]
            call_command("dumpdata", "--natural-foreign", "--natural-primary", *exclude_args, stdout=buffer)
            contenu = buffer.getvalue().encode("utf-8")
            with gzip.open(fichier, "wb") as f:
                f.write(contenu)

            taille = fichier.stat().st_size
            duree = round(time.monotonic() - debut, 2)
            SauvegardeLog.objects.create(
                fichier=str(fichier.name), taille_octets=taille, duree_secondes=duree,
                statut=SauvegardeLog.Statut.SUCCES,
                message=f"Sauvegarde réussie ({taille / 1024:.1f} Ko).",
            )
            self.stdout.write(self.style.SUCCESS(f"Sauvegarde créée : {fichier.name} ({taille / 1024:.1f} Ko)"))
        except Exception as exc:  # noqa: BLE001 — on veut tracer n'importe quelle erreur de sauvegarde
            duree = round(time.monotonic() - debut, 2)
            SauvegardeLog.objects.create(
                fichier="", taille_octets=0, duree_secondes=duree,
                statut=SauvegardeLog.Statut.ECHEC, message=str(exc)[:500],
            )
            self.stderr.write(self.style.ERROR(f"Échec de la sauvegarde : {exc}"))
            raise

        self._purger_anciennes_sauvegardes(backups_dir)

    def _purger_anciennes_sauvegardes(self, backups_dir: Path):
        seuil = time.time() - RETENTION_JOURS * 86400
        for fichier in backups_dir.glob("backup_*.json.gz"):
            if fichier.stat().st_mtime < seuil:
                fichier.unlink(missing_ok=True)
