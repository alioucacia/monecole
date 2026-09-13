from django.db import migrations


def basculer_vers_officiel(apps, schema_editor):
    """Bascule TOUTES les écoles déjà créées sur le modèle de bulletin "Officiel" (5) — demande
    explicite : remplacer le bulletin utilisé partout par ce format papier (IRE/DPE/DSEE,
    tableau SEM1/SEM2, bandeau "Résultat de fin d'années"), pas seulement le proposer en option."""
    Ecole = apps.get_model("tenants", "Ecole")
    Ecole.objects.update(modele_bulletin=5)


class Migration(migrations.Migration):

    dependencies = [
        ("tenants", "0019_bulletin_officiel_par_defaut"),
    ]

    operations = [
        migrations.RunPython(basculer_vers_officiel, migrations.RunPython.noop),
    ]
