from rest_framework import serializers

from .models import JustificatifAbsence, Presence


class PresenceSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)
    classe_nom = serializers.CharField(source="eleve.classe.nom", read_only=True, default=None)

    class Meta:
        model = Presence
        fields = [
            "id", "eleve", "eleve_nom", "classe_nom", "date", "creneau",
            "statut", "justifie", "motif", "enregistre_par",
        ]
        read_only_fields = ["enregistre_par"]


class PresenceBulkItemSerializer(serializers.Serializer):
    eleve = serializers.IntegerField()
    statut = serializers.ChoiceField(choices=Presence.Statut.choices)
    justifie = serializers.BooleanField(default=False)
    motif = serializers.CharField(required=False, allow_blank=True, default="")


class PresenceBulkSerializer(serializers.Serializer):
    """Saisie groupée de la feuille d'appel pour une classe/date/créneau."""

    date = serializers.DateField()
    creneau = serializers.IntegerField(required=False, allow_null=True)
    entries = PresenceBulkItemSerializer(many=True)


class JustificatifAbsenceSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)
    classe_nom = serializers.CharField(source="eleve.classe.nom", read_only=True, default=None)
    soumis_par_nom = serializers.CharField(source="soumis_par.get_full_name", read_only=True, default=None)
    traite_par_nom = serializers.CharField(source="traite_par.get_full_name", read_only=True, default=None)

    class Meta:
        model = JustificatifAbsence
        fields = [
            "id", "eleve", "eleve_nom", "classe_nom", "date_absence", "motif", "description",
            "piece_jointe", "statut", "soumis_par", "soumis_par_nom", "traite_par", "traite_par_nom",
            "commentaire_traitement", "cree_le",
        ]
        read_only_fields = ["statut", "soumis_par", "traite_par", "commentaire_traitement", "cree_le"]


class TraiterJustificatifSerializer(serializers.Serializer):
    commentaire = serializers.CharField(required=False, allow_blank=True, default="")
