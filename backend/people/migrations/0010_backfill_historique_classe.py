"""Rattrapage, pour les élèves déjà inscrits avant l'introduction de HistoriqueClasse : une
entrée d'historique sur leur classe ACTUELLE, pour l'année scolaire de cette classe. C'est un
best-effort — l'historique des années précédentes n'a jamais été enregistré nulle part et ne
peut pas être reconstitué ; ça évite seulement qu'un élève déjà inscrit se retrouve sans AUCUNE
entrée pour l'année en cours tant qu'il n'a pas encore été réinscrit/modifié une première fois
depuis ce correctif."""

from django.db import migrations


def backfill(apps, schema_editor):
    EleveProfile = apps.get_model("people", "EleveProfile")
    HistoriqueClasse = apps.get_model("people", "HistoriqueClasse")

    a_creer = []
    for eleve in EleveProfile.objects.filter(classe__isnull=False).select_related("classe"):
        a_creer.append(HistoriqueClasse(
            eleve_id=eleve.id, classe_id=eleve.classe_id, annee_scolaire_id=eleve.classe.annee_scolaire_id,
        ))
    HistoriqueClasse.objects.bulk_create(a_creer, ignore_conflicts=True)


def backwards(apps, schema_editor):
    pass  # rien à défaire : la table sera de toute façon supprimée si la migration précédente l'est


class Migration(migrations.Migration):

    dependencies = [
        ("people", "0009_historiqueclasse"),
    ]

    operations = [
        migrations.RunPython(backfill, backwards),
    ]
