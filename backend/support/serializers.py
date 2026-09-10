from rest_framework import serializers

from core.validators import EXTENSIONS_DOCUMENT, TAILLE_MAX_DOCUMENT, valider_taille_fichier

from .models import MessageTicket, Ticket


class MessageTicketSerializer(serializers.ModelSerializer):
    auteur_nom = serializers.CharField(source="auteur.get_full_name", read_only=True)
    auteur_role = serializers.CharField(source="auteur.role", read_only=True)
    fichier_nom = serializers.CharField(read_only=True)
    fichier_url = serializers.SerializerMethodField()

    class Meta:
        model = MessageTicket
        fields = ["id", "ticket", "auteur", "auteur_nom", "auteur_role", "contenu", "fichier", "fichier_nom", "fichier_url", "cree_le"]
        read_only_fields = ["auteur", "cree_le"]
        extra_kwargs = {"fichier": {"write_only": True, "required": False}}

    def get_fichier_url(self, obj):
        if not obj.fichier:
            return None
        request = self.context.get("request")
        url = obj.fichier.url
        return request.build_absolute_uri(url) if request else url

    def validate_fichier(self, fichier):
        return valider_taille_fichier(fichier, TAILLE_MAX_DOCUMENT, EXTENSIONS_DOCUMENT)

    def validate(self, attrs):
        contenu = attrs.get("contenu", "")
        fichier = attrs.get("fichier")
        if not contenu and not fichier:
            raise serializers.ValidationError("Le message doit contenir du texte ou une pièce jointe.")
        return attrs


class TicketSerializer(serializers.ModelSerializer):
    auteur_nom = serializers.CharField(source="auteur.get_full_name", read_only=True)
    auteur_role = serializers.CharField(source="auteur.role", read_only=True)
    ecole_nom = serializers.CharField(source="ecole.nom", read_only=True, default=None)
    assigne_a_nom = serializers.CharField(source="assigne_a.get_full_name", read_only=True, default=None)
    statut_display = serializers.CharField(source="get_statut_display", read_only=True)
    priorite_display = serializers.CharField(source="get_priorite_display", read_only=True)
    nombre_messages = serializers.IntegerField(source="messages.count", read_only=True)
    # Premier message, requis à la création (le sujet seul ne suffit pas à décrire le problème) —
    # jamais renvoyé en lecture (les messages se consultent via /support/messages/?ticket=).
    message = serializers.CharField(write_only=True, required=True, allow_blank=False)

    class Meta:
        model = Ticket
        fields = [
            "id", "ecole", "ecole_nom", "auteur", "auteur_nom", "auteur_role", "sujet",
            "statut", "statut_display", "priorite", "priorite_display", "cree_le", "maj_le",
            "assigne_a", "assigne_a_nom", "nombre_messages", "message",
        ]
        read_only_fields = ["ecole", "auteur", "statut", "cree_le", "maj_le", "assigne_a"]

    def create(self, validated_data):
        message_contenu = validated_data.pop("message")
        ticket = Ticket.objects.create(**validated_data)
        MessageTicket.objects.create(ticket=ticket, auteur=ticket.auteur, contenu=message_contenu)
        return ticket


class ChangerStatutTicketSerializer(serializers.Serializer):
    statut = serializers.ChoiceField(choices=Ticket.Statut.choices)
    assigne_a = serializers.IntegerField(required=False, allow_null=True)
