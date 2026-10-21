from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("people", "0012_eleveprofile_exonere_fratrie"),
        ("tenants", "0029_ecole_eleve_bonus_reglage"),
    ]

    operations = [
        migrations.AddField(
            model_name="eleveprofile",
            name="bonus_mode",
            field=models.CharField(
                choices=[
                    ("auto", "Automatique (règle de la fratrie)"),
                    ("oui", "Élève Bonus (désigné par l'administrateur)"),
                    ("non", "Jamais Élève Bonus"),
                ],
                default="auto",
                help_text="Choix de l'administrateur : laisser la règle décider, désigner cet élève comme Bonus, ou l'exclure du Bonus.",
                max_length=4,
            ),
        ),
        migrations.AlterField(
            model_name="eleveprofile",
            name="exonere_fratrie",
            field=models.BooleanField(
                default=False,
                editable=False,
                help_text="Élève Bonus : enfant de la classe la plus basse d'un parent qui a au moins le nombre d'enfants inscrits fixé pour l'école (ou désigné par l'administrateur) — exonéré de scolarité.",
            ),
        ),
    ]
