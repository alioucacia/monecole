from rest_framework import serializers

from accounts.models import User

from .models import Reunion


class ParticipantSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "full_name", "role", "role_display"]


class ReunionSerializer(serializers.ModelSerializer):
    organisateur_nom = serializers.CharField(source="organisateur.get_full_name", read_only=True)
    participants_detail = ParticipantSerializer(source="participants", many=True, read_only=True)
    statut_display = serializers.CharField(source="get_statut_display", read_only=True)
    salle = serializers.CharField(read_only=True)
    est_organisateur = serializers.SerializerMethodField()

    class Meta:
        model = Reunion
        fields = [
            "id", "titre", "description", "organisateur", "organisateur_nom",
            "participants", "participants_detail", "salle", "date_debut", "duree_minutes",
            "statut", "statut_display", "instantanee", "avec_video", "date_creation", "est_organisateur",
        ]
        read_only_fields = ["organisateur", "salle", "date_creation"]

    def get_est_organisateur(self, obj):
        request = self.context.get("request")
        return bool(request and obj.organisateur_id == request.user.id)

    def validate_participants(self, value):
        request = self.context["request"]
        hors_ecole = [u for u in value if u.ecole_id != request.user.ecole_id]
        if hors_ecole:
            raise serializers.ValidationError("Tous les participants doivent appartenir à votre établissement.")
        return value
