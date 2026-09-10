from django.conf import settings
from rest_framework import serializers

from .models import AffectationTransport, PointageTransport, TicketBus, Trajet


class TrajetSerializer(serializers.ModelSerializer):
    effectif = serializers.IntegerField(read_only=True)
    lien_chauffeur = serializers.SerializerMethodField()

    class Meta:
        model = Trajet
        fields = [
            "id", "nom", "chauffeur_nom", "chauffeur_telephone", "vehicule_immatriculation", "capacite",
            "heure_depart", "heure_retour", "description", "effectif",
            "lien_chauffeur", "derniere_latitude", "derniere_longitude", "position_maj_le",
        ]

    def get_lien_chauffeur(self, obj):
        # Lien secret (sans authentification) qui permet de pointer les montées/descentes —
        # ne doit être visible que du Super Admin de l'établissement, jamais des élèves/parents
        # qui voient pourtant ce même trajet (le leur).
        request = self.context.get("request")
        if not request or getattr(request.user, "role", None) != "admin":
            return None
        return f"{settings.FRONTEND_URL}/chauffeur/{obj.token_chauffeur}"


class AffectationTransportSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)
    trajet_nom = serializers.CharField(source="trajet.nom", read_only=True)
    classe_nom = serializers.CharField(source="eleve.classe.nom", read_only=True, default=None)

    class Meta:
        model = AffectationTransport
        fields = ["id", "eleve", "eleve_nom", "classe_nom", "trajet", "trajet_nom", "point_montee", "date_debut"]


class TicketBusSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="affectation.eleve.user.get_full_name", read_only=True)
    trajet_nom = serializers.CharField(source="affectation.trajet.nom", read_only=True)

    class Meta:
        model = TicketBus
        fields = ["id", "affectation", "eleve_nom", "trajet_nom", "mois", "montant", "paye", "date_paiement", "qr_token", "cree_le"]
        read_only_fields = ["qr_token", "cree_le"]


class PointageTransportSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)

    class Meta:
        model = PointageTransport
        fields = ["id", "trajet", "eleve", "eleve_nom", "type_evenement", "horodatage", "latitude", "longitude"]
        read_only_fields = ["horodatage"]
