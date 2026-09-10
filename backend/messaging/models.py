import os

from django.conf import settings
from django.db import models


def message_upload_path(instance, filename):
    return f"messages/{instance.expediteur_id}/{filename}"


class Message(models.Model):
    class TypeMessage(models.TextChoices):
        TEXTE = "texte", "Texte"
        VOCAL = "vocal", "Message vocal"
        FICHIER = "fichier", "Pièce jointe"

    expediteur = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_envoyes"
    )
    destinataire = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_recus"
    )
    contenu = models.TextField(blank=True)
    type_message = models.CharField(max_length=10, choices=TypeMessage.choices, default=TypeMessage.TEXTE)
    fichier = models.FileField(upload_to=message_upload_path, blank=True, null=True)
    date_envoi = models.DateTimeField(auto_now_add=True)
    lu = models.BooleanField(default=False)

    class Meta:
        ordering = ["-date_envoi"]

    def __str__(self):
        return f"{self.expediteur} → {self.destinataire} ({self.date_envoi:%d/%m/%Y})"

    @property
    def fichier_nom(self):
        return os.path.basename(self.fichier.name) if self.fichier else None
