from django.db import migrations


def backfill_periodicite(apps, schema_editor):
    """Les TypeFrais existants n'avaient que `est_mensuel` (booléen) — on le traduit en
    `periodicite` ("mensuel" si coché, "autre" sinon, valeur par défaut déjà appliquée par la
    migration précédente) pour ne perdre aucune configuration déjà en place."""
    TypeFrais = apps.get_model("payments", "TypeFrais")
    TypeFrais.objects.filter(est_mensuel=True).update(periodicite="mensuel")


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0009_typefrais_periodicite"),
    ]

    operations = [
        migrations.RunPython(backfill_periodicite, migrations.RunPython.noop),
    ]
