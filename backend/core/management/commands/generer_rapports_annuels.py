from datetime import date

from django.core.management.base import BaseCommand

from academics.models import AnneeScolaire
from core.models import RapportAnnuel
from core.rapport_annuel import generer_et_enregistrer


class Command(BaseCommand):
    help = (
        "Génère automatiquement le rapport annuel PDF de chaque école dont l'année scolaire vient de "
        "se terminer (une seule fois par année). À planifier chaque jour, comme backup_daily."
    )

    def handle(self, *args, **options):
        deja = set(RapportAnnuel.objects.filter(provisoire=False).values_list("annee_scolaire_id", flat=True))
        annees = AnneeScolaire.objects.filter(date_fin__lt=date.today(), ecole__isnull=False, ecole__actif=True).select_related("ecole")
        nb = 0
        for annee in annees:
            if annee.id in deja:
                continue
            try:
                generer_et_enregistrer(annee.ecole, annee, automatique=True)
                nb += 1
                self.stdout.write(f"Rapport annuel {annee.libelle} généré pour {annee.ecole.nom}")
            except Exception as exc:  # noqa: BLE001 — une école en échec ne bloque pas les autres
                self.stderr.write(f"Échec pour {annee.ecole.nom} ({annee.libelle}) : {exc}")
        self.stdout.write(self.style.SUCCESS(f"{nb} rapport(s) annuel(s) généré(s)."))
