from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations
from django.db.models import Sum

# Facteurs possibles (voir EleveProfile.facteur_mensualite / facteur_inscription_reinscription) :
# exonéré, Fondation 50% + fidélité, Fondation 50%, fidélité, plein tarif.
FACTEURS = [Decimal("0"), Decimal("0.475"), Decimal("0.5"), Decimal("0.95"), Decimal("1")]


def corriger(apps, schema_editor):
    """Avant la correction de Frais.montant_du, une réduction accordée APRÈS un paiement (ex:
    inscription payée puis élève passé en Fondation 100%) abaissait le gel `facteur_applique`
    sous ce qui était déjà versé : l'argent encaissé devenait un trop-perçu (taux de recouvrement
    > 100%). On remonte ce gel au plus petit facteur qui couvre le montant versé."""
    Frais = apps.get_model("payments", "Frais")
    frais = (
        Frais.objects.filter(facteur_applique__isnull=False)
        .annotate(verse=Sum("paiements__montant"))
        .filter(verse__isnull=False)
    )
    for f in frais.iterator():
        du = (f.montant * f.facteur_applique).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if du >= f.verse:
            continue
        facteur = next(
            (c for c in FACTEURS if (f.montant * c).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) >= f.verse),
            Decimal("1"),
        )
        if facteur > f.facteur_applique:
            Frais.objects.filter(pk=f.pk).update(facteur_applique=facteur)


class Migration(migrations.Migration):
    dependencies = [("payments", "0013_frais_mois")]

    operations = [migrations.RunPython(corriger, migrations.RunPython.noop)]
