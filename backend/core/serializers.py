from rest_framework import serializers

from .models import SauvegardeLog


class SauvegardeLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SauvegardeLog
        fields = ["id", "date_lancement", "fichier", "taille_octets", "duree_secondes", "statut", "message"]
        read_only_fields = fields
