from rest_framework import serializers

from .models import AnneeScolaire, Classe, Creneau, Enseignement, Matiere


class AnneeScolaireSerializer(serializers.ModelSerializer):
    class Meta:
        model = AnneeScolaire
        fields = ["id", "libelle", "date_debut", "date_fin", "active"]


class MatiereSerializer(serializers.ModelSerializer):
    class Meta:
        model = Matiere
        fields = ["id", "nom", "code", "coefficient", "couleur"]


class ClasseSerializer(serializers.ModelSerializer):
    effectif = serializers.IntegerField(read_only=True)
    places_disponibles = serializers.IntegerField(read_only=True)
    professeur_principal_nom = serializers.CharField(
        source="professeur_principal.get_full_name", read_only=True, default=None
    )
    annee_scolaire_libelle = serializers.CharField(source="annee_scolaire.libelle", read_only=True)
    cycle_display = serializers.CharField(source="get_cycle_display", read_only=True, default="")

    class Meta:
        model = Classe
        fields = [
            "id", "nom", "niveau", "cycle", "cycle_display", "annee_scolaire", "annee_scolaire_libelle",
            "professeur_principal", "professeur_principal_nom", "capacite", "effectif", "places_disponibles",
        ]


class EnseignementSerializer(serializers.ModelSerializer):
    enseignant_nom = serializers.CharField(source="enseignant.get_full_name", read_only=True)
    matiere_nom = serializers.CharField(source="matiere.nom", read_only=True)
    classe_nom = serializers.CharField(source="classe.nom", read_only=True)

    class Meta:
        model = Enseignement
        fields = [
            "id", "enseignant", "enseignant_nom", "matiere", "matiere_nom",
            "classe", "classe_nom",
        ]


class CreneauSerializer(serializers.ModelSerializer):
    matiere_nom = serializers.CharField(source="enseignement.matiere.nom", read_only=True)
    matiere_couleur = serializers.CharField(source="enseignement.matiere.couleur", read_only=True)
    enseignant_nom = serializers.CharField(source="enseignement.enseignant.get_full_name", read_only=True)
    classe_nom = serializers.CharField(source="classe.nom", read_only=True)

    class Meta:
        model = Creneau
        fields = [
            "id", "classe", "classe_nom", "enseignement", "matiere_nom", "matiere_couleur",
            "enseignant_nom", "jour", "heure_debut", "heure_fin", "salle",
        ]
