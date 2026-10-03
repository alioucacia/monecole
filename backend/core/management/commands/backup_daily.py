from django.core.management.base import BaseCommand, CommandError

from core.models import SauvegardeLog
from core.sauvegarde import executer_sauvegarde


class Command(BaseCommand):
    help = "Sauvegarde journalière de toute la base de données (toutes écoles) au format JSON compressé."

    def handle(self, *args, **options):
        log = executer_sauvegarde()
        if log.statut != SauvegardeLog.Statut.SUCCES:
            raise CommandError(f"Échec de la sauvegarde : {log.message}")
        self.stdout.write(self.style.SUCCESS(f"Sauvegarde créée : {log.fichier} ({log.taille_octets / 1024:.1f} Ko)"))
