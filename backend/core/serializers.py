from rest_framework import serializers

from .models import OperationSauvegardeEcole, SauvegardeLog


class SauvegardeLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SauvegardeLog
        fields = ["id", "date_lancement", "fichier", "taille_octets", "duree_secondes", "statut", "message"]
        read_only_fields = fields


class OperationSauvegardeEcoleSerializer(serializers.ModelSerializer):
    auteur_nom = serializers.SerializerMethodField()
    origine_display = serializers.CharField(source="get_origine_display", read_only=True)
    # Archive encore présente sur le serveur (téléchargeable / restaurable).
    disponible = serializers.SerializerMethodField()
    source_date = serializers.DateTimeField(source="source.date_lancement", read_only=True, default=None)

    class Meta:
        model = OperationSauvegardeEcole
        fields = [
            "id", "type", "origine", "origine_display", "statut", "date_lancement", "auteur_nom", "source",
            "source_date", "fichier", "taille_octets", "duree_secondes", "message", "resume", "disponible",
        ]
        read_only_fields = fields

    def get_auteur_nom(self, operation):
        if operation.auteur is None:
            return ""
        return operation.auteur.get_full_name() or operation.auteur.username

    def get_disponible(self, operation):
        from .sauvegarde_ecole import chemin_archive

        return (
            operation.type == OperationSauvegardeEcole.Type.SAUVEGARDE
            and operation.statut == OperationSauvegardeEcole.Statut.SUCCES
            and chemin_archive(operation) is not None
        )
