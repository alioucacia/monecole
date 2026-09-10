from rest_framework import serializers

from .models import Message

TAILLE_MAX_FICHIER = 15 * 1024 * 1024  # 15 Mo


class MessageSerializer(serializers.ModelSerializer):
    expediteur_nom = serializers.CharField(source="expediteur.get_full_name", read_only=True)
    destinataire_nom = serializers.CharField(source="destinataire.get_full_name", read_only=True)
    fichier_nom = serializers.CharField(read_only=True)
    fichier_url = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id", "expediteur", "expediteur_nom", "destinataire", "destinataire_nom",
            "contenu", "type_message", "fichier", "fichier_nom", "fichier_url", "date_envoi", "lu",
        ]
        read_only_fields = ["expediteur", "date_envoi", "lu"]
        extra_kwargs = {"fichier": {"write_only": True, "required": False}}

    def get_fichier_url(self, obj):
        if not obj.fichier:
            return None
        request = self.context.get("request")
        url = obj.fichier.url
        return request.build_absolute_uri(url) if request else url

    def validate_fichier(self, fichier):
        if fichier and fichier.size > TAILLE_MAX_FICHIER:
            raise serializers.ValidationError("Le fichier dépasse la taille maximale autorisée (15 Mo).")
        return fichier

    def validate(self, attrs):
        contenu = attrs.get("contenu", "")
        fichier = attrs.get("fichier")
        if not contenu and not fichier:
            raise serializers.ValidationError("Le message doit contenir du texte ou une pièce jointe.")
        return attrs
