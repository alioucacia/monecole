from rest_framework import serializers

from .models import Emprunt, Livre


class LivreSerializer(serializers.ModelSerializer):
    exemplaires_disponibles = serializers.IntegerField(read_only=True)
    exemplaires_empruntes = serializers.IntegerField(read_only=True)

    class Meta:
        model = Livre
        fields = [
            "id", "titre", "auteur", "isbn", "categorie", "couverture", "exemplaires_total",
            "duree_emprunt_jours", "exemplaires_disponibles", "exemplaires_empruntes", "date_ajout",
        ]


class EmpruntSerializer(serializers.ModelSerializer):
    livre_titre = serializers.CharField(source="livre.titre", read_only=True)
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)
    statut = serializers.CharField(read_only=True)

    class Meta:
        model = Emprunt
        fields = [
            "id", "livre", "livre_titre", "eleve", "eleve_nom", "date_emprunt",
            "date_retour_prevue", "date_retour_effective", "statut", "enregistre_par",
        ]
        read_only_fields = ["date_emprunt", "enregistre_par"]
        extra_kwargs = {
            # Le frontend préremplit déjà cette date à partir de `livre.duree_emprunt_jours`,
            # mais on la calcule aussi ici par sécurité pour tout autre client de l'API.
            "date_retour_prevue": {"required": False},
        }

    def validate_livre(self, livre):
        if self.instance is None and livre.exemplaires_disponibles <= 0:
            raise serializers.ValidationError("Aucun exemplaire disponible pour ce livre.")
        return livre

    def create(self, validated_data):
        if not validated_data.get("date_retour_prevue"):
            from datetime import date, timedelta

            validated_data["date_retour_prevue"] = date.today() + timedelta(days=validated_data["livre"].duree_emprunt_jours)
        return super().create(validated_data)
