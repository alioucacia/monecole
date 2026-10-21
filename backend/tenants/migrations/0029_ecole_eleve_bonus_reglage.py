from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tenants", "0028_ecole_signataires_historique_paiement"),
    ]

    operations = [
        migrations.AddField(
            model_name="ecole",
            name="eleve_bonus_actif",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="ecole",
            name="eleve_bonus_seuil",
            field=models.PositiveSmallIntegerField(default=6),
        ),
    ]
