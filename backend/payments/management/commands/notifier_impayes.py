from django.core.management.base import BaseCommand

from payments.notifications import notifier_frais_impayes


class Command(BaseCommand):
    help = (
        "Envoie un rappel (email + SMS) aux parents (toutes écoles) dont un ou plusieurs "
        "frais sont en retard de paiement. À planifier quotidiennement, comme backup_daily."
    )

    def handle(self, *args, **options):
        nb = notifier_frais_impayes()
        self.stdout.write(self.style.SUCCESS(f"{nb} famille(s) notifiee(s)."))
