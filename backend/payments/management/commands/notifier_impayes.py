from django.core.management.base import BaseCommand

from payments.notifications import notifier_frais_impayes


class Command(BaseCommand):
    help = (
        "Envoie un rappel (email + SMS) aux parents (toutes écoles) dont un ou plusieurs "
        "frais sont en retard de paiement. À planifier quotidiennement, comme backup_daily."
    )

    def handle(self, *args, **options):
        bilan = notifier_frais_impayes()
        self.stdout.write(self.style.SUCCESS(
            f"{bilan['notifies']} famille(s) notifiee(s) — {bilan['sms_envoyes']} SMS, "
            f"{bilan['sms_echecs']} echec(s) SMS, {bilan['emails_envoyes']} e-mail(s), "
            f"{bilan['sans_contact']} sans contact, {bilan['deja_relances']} deja relancee(s)."
        ))
