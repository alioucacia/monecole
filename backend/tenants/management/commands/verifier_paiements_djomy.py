from django.core.management.base import BaseCommand

from tenants.abonnement import verifier_transactions_en_attente
from tenants.models import TransactionAbonnement


class Command(BaseCommand):
    help = (
        "Vérifie auprès de Djomy les paiements d'abonnement encore en attente (3 derniers jours) "
        "et prolonge automatiquement l'abonnement des écoles dont le paiement est validé "
        "(30 jours Mensuel / 365 jours Annuel). À planifier toutes les 5 minutes."
    )

    def handle(self, *args, **options):
        resultats = verifier_transactions_en_attente()
        reussis = sum(1 for t in resultats if t.statut == TransactionAbonnement.Statut.REUSSI)
        echoues = sum(1 for t in resultats if t.statut == TransactionAbonnement.Statut.ECHOUE)
        self.stdout.write(self.style.SUCCESS(
            f"{len(resultats)} transaction(s) verifiee(s) — {reussis} validee(s), {echoues} echouee(s), "
            f"{len(resultats) - reussis - echoues} toujours en attente."
        ))
