from rest_framework import serializers

from .models import Annonce


class AnnonceSerializer(serializers.ModelSerializer):
    auteur_nom = serializers.CharField(source="auteur.get_full_name", read_only=True, default=None)
    classe_nom = serializers.CharField(source="classe.nom", read_only=True, default=None)
    ecole_nom = serializers.CharField(source="ecole.nom", read_only=True, default=None)

    class Meta:
        model = Annonce
        fields = [
            "id", "titre", "contenu", "auteur", "auteur_nom", "cible_role",
            "classe", "classe_nom", "ecole", "ecole_nom", "date_publication", "epingle",
            "envoyer_email", "envoyer_sms", "notifications_envoyees",
        ]
        # "ecole" est toujours imposé par la vue (perform_create), jamais par le client :
        # AnnonceViewSet impose l'école de l'auteur, AnnoncePlateformeViewSet lit la cible
        # directement dans la requête plutôt que via ce champ — voir les deux `perform_create`.
        read_only_fields = ["auteur", "ecole", "date_publication", "notifications_envoyees"]
