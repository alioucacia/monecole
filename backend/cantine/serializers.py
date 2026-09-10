from django.conf import settings
from rest_framework import serializers

from .models import Formule, InscriptionCantine, PointageCantine, TicketCantine


class FormuleSerializer(serializers.ModelSerializer):
    effectif = serializers.IntegerField(read_only=True)
    lien_agent = serializers.SerializerMethodField()

    class Meta:
        model = Formule
        fields = [
            "id", "nom", "responsable_nom", "responsable_telephone", "prix", "capacite",
            "heure_service", "description", "effectif", "lien_agent",
        ]

    def get_lien_agent(self, obj):
        # Lien secret (sans authentification) qui permet de pointer les repas —
        # ne doit être visible que de l'Administrateur de l'établissement, jamais des
        # élèves/parents qui voient pourtant cette même formule (la leur).
        request = self.context.get("request")
        if not request or getattr(request.user, "role", None) != "admin":
            return None
        return f"{settings.FRONTEND_URL}/agent-cantine/{obj.token_agent}"


class InscriptionCantineSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)
    formule_nom = serializers.CharField(source="formule.nom", read_only=True)
    classe_nom = serializers.CharField(source="eleve.classe.nom", read_only=True, default=None)

    class Meta:
        model = InscriptionCantine
        fields = ["id", "eleve", "eleve_nom", "classe_nom", "formule", "formule_nom", "date_debut"]


class TicketCantineSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="inscription.eleve.user.get_full_name", read_only=True)
    formule_nom = serializers.CharField(source="inscription.formule.nom", read_only=True)

    class Meta:
        model = TicketCantine
        fields = ["id", "inscription", "eleve_nom", "formule_nom", "mois", "montant", "paye", "date_paiement", "qr_token", "cree_le"]
        read_only_fields = ["qr_token", "cree_le"]


class PointageCantineSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)

    class Meta:
        model = PointageCantine
        fields = ["id", "formule", "eleve", "eleve_nom", "horodatage"]
        read_only_fields = ["horodatage"]
