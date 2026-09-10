from rest_framework import serializers

from .models import Note, Periode


class PeriodeSerializer(serializers.ModelSerializer):
    annee_scolaire_libelle = serializers.CharField(source="annee_scolaire.libelle", read_only=True)

    class Meta:
        model = Periode
        fields = ["id", "nom", "annee_scolaire", "annee_scolaire_libelle", "date_debut", "date_fin"]


class NoteSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)
    matiere_nom = serializers.CharField(source="matiere.nom", read_only=True)
    enseignant_nom = serializers.CharField(source="enseignant.get_full_name", read_only=True, default=None)
    periode_nom = serializers.CharField(source="periode.nom", read_only=True)

    class Meta:
        model = Note
        fields = [
            "id", "eleve", "eleve_nom", "matiere", "matiere_nom", "enseignant", "enseignant_nom",
            "periode", "periode_nom", "type_evaluation", "valeur", "coefficient", "date", "commentaire",
        ]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.role == "teacher" and not validated_data.get("enseignant"):
            validated_data["enseignant"] = request.user
        return super().create(validated_data)
