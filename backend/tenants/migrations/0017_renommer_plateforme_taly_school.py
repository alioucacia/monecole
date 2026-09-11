from django.db import migrations


def _renommer_plateforme(apps, schema_editor):
    """`ParametresPlateforme` est un singleton créé par `get_or_create(pk=1)` la première fois
    que `ParametresPlateforme.charger()` est appelé (voir models.py) — avec la valeur par défaut
    du champ EN VIGUEUR À CE MOMENT-LÀ ('École Manager', avant que ce défaut ne soit changé en
    'Taly-School' dans le code). Changer le défaut du champ ne modifie jamais une ligne déjà
    créée : la plateforme en production est donc restée bloquée sur l'ancien nom tant que
    personne n'allait le changer à la main dans « Paramètres plateforme ». On corrige ici
    la ligne existante, sans toucher à un nom que le Super Admin aurait déjà personnalisé
    depuis (autre que l'un des deux anciens défauts, accentué ou non)."""
    ParametresPlateforme = apps.get_model("tenants", "ParametresPlateforme")
    ParametresPlateforme.objects.filter(nom_plateforme__in=["École Manager", "Ecole Manager"]).update(
        nom_plateforme="TALY-SCHOOL"
    )
    ParametresPlateforme.objects.filter(email_expediteur_nom__in=["École Manager", "Ecole Manager"]).update(
        email_expediteur_nom="Taly-School"
    )


def _sans_effet(apps, schema_editor):
    """Migration arrière volontairement no-op : impossible de distinguer un nom revenu à
    l'ancienne valeur par choix du Super Admin d'un simple retour en arrière de migration."""


class Migration(migrations.Migration):

    dependencies = [
        ('tenants', '0016_ecole_modele_certificat'),
    ]

    operations = [
        migrations.RunPython(_renommer_plateforme, _sans_effet),
    ]
