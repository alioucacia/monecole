from django.core.management.base import BaseCommand, CommandError

from core.models import SauvegardeLog
from core.sauvegarde import executer_sauvegarde


class Command(BaseCommand):
    help = "Sauvegarde journalière de toute la base de données (toutes écoles) au format JSON compressé."

    def add_arguments(self, parser):
        # Utilisé par le bouton « Lancer une sauvegarde » (core/sauvegarde.py) : l'entrée « en
        # cours » est déjà créée, ce processus la complète.
        parser.add_argument("--log-id", type=int, default=None)

    def handle(self, *args, **options):
        log = None
        if options["log_id"]:
            log = SauvegardeLog.objects.filter(pk=options["log_id"]).first()
        log = executer_sauvegarde(log)
        if log.statut != SauvegardeLog.Statut.SUCCES:
            raise CommandError(f"Échec de la sauvegarde : {log.message}")
        self.stdout.write(self.style.SUCCESS(f"Sauvegarde créée : {log.fichier} ({log.taille_octets / 1024:.1f} Ko)"))
