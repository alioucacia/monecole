"""Le signal `creer_categories_depense_par_defaut` (voir payments/models.py) ne peuple les
catégories de dépense par défaut que pour une école CRÉÉE après ce correctif — cette migration
fait le même travail, une fois, pour toutes les écoles déjà existantes."""

from django.db import migrations

CATEGORIES_PAR_DEFAUT = [
    "Fournitures scolaires", "Entretien / Réparations", "Salaires (hors enseignants)",
    "Eau / Électricité / Internet", "Transport", "Restauration / Cantine", "Événement scolaire", "Autre",
]


def seed(apps, schema_editor):
    Ecole = apps.get_model("tenants", "Ecole")
    CategorieDepense = apps.get_model("payments", "CategorieDepense")

    a_creer = []
    for ecole in Ecole.objects.all():
        for nom in CATEGORIES_PAR_DEFAUT:
            a_creer.append(CategorieDepense(ecole=ecole, nom=nom))
    CategorieDepense.objects.bulk_create(a_creer, ignore_conflicts=True)


def backwards(apps, schema_editor):
    pass  # rien à défaire : la table sera de toute façon supprimée si la migration précédente l'est


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0007_categoriedepense_alter_depense_categorie"),
    ]

    operations = [
        migrations.RunPython(seed, backwards),
    ]
