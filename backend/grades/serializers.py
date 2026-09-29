from rest_framework import serializers

from academics.models import bareme_de_classe

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
    # Note maximale : 10 en Préscolaire/Primaire, 20 en Collège/Lycée (voir Classe.bareme).
    bareme = serializers.SerializerMethodField()

    class Meta:
        model = Note
        fields = [
            "id", "eleve", "eleve_nom", "matiere", "matiere_nom", "enseignant", "enseignant_nom",
            "periode", "periode_nom", "type_evaluation", "valeur", "bareme", "coefficient", "date", "commentaire",
        ]

    def get_bareme(self, obj) -> int:
        return bareme_de_classe(obj.eleve.classe)

    def validate(self, attrs):
        eleve = attrs.get("eleve", getattr(self.instance, "eleve", None))
        valeur = attrs.get("valeur", getattr(self.instance, "valeur", None))
        if eleve is not None and valeur is not None:
            bareme = bareme_de_classe(eleve.classe)
            if valeur > bareme:
                raise serializers.ValidationError({
                    "valeur": f"La note ne peut pas dépasser {bareme} : la classe de cet élève est notée sur {bareme}."
                })
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.role == "teacher" and not validated_data.get("enseignant"):
            validated_data["enseignant"] = request.user
        return super().create(validated_data)
