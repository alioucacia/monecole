from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from tenants.models import Ecole


class Command(BaseCommand):
    help = (
        "Fixe le nombre de jours restants de l'abonnement d'une école (ex : 3 pour tester le "
        "renouvellement) — la fin d'abonnement devient aujourd'hui + JOURS. "
        "Usage : manage.py abonnement_jours \"Nom ou slug de l'école\" 3"
    )

    def add_arguments(self, parser):
        parser.add_argument("ecole", help="Nom, slug ou identifiant de l'école")
        parser.add_argument("jours", type=int, help="Jours restants souhaités (0 = expire ce soir, négatif = déjà expiré)")

    def handle(self, *args, ecole, jours, **options):
        filtre = Q(nom__iexact=ecole) | Q(slug__iexact=ecole)
        if ecole.isdigit():
            filtre |= Q(pk=int(ecole))
        ecoles = list(Ecole.objects.filter(filtre))
        if len(ecoles) != 1:
            raise CommandError(
                f"{len(ecoles)} école(s) correspondent à « {ecole} » — précisez le slug ou l'identifiant."
            )
        cible = ecoles[0]
        cible.date_fin_abonnement = date.today() + timedelta(days=jours)
        cible.save(update_fields=["date_fin_abonnement"])
        self.stdout.write(self.style.SUCCESS(
            f"{cible.nom} : abonnement valable jusqu'au {cible.date_fin_abonnement:%d/%m/%Y} "
            f"({cible.jours_restants_abonnement} jour(s) restant(s), statut : {cible.statut_abonnement})."
        ))
