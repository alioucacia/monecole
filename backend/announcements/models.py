from django.conf import settings
from django.db import models

from academics.models import Classe


class Annonce(models.Model):
    class Cible(models.TextChoices):
        TOUS = "all", "Tout le monde"
        ADMIN = "admin", "Administrateurs"
        TEACHER = "teacher", "Enseignants"
        STUDENT = "student", "Élèves"
        PARENT = "parent", "Parents"

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="annonces")
    titre = models.CharField(max_length=200)
    contenu = models.TextField()
    auteur = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="annonces")
    cible_role = models.CharField(max_length=20, choices=Cible.choices, default=Cible.TOUS)
    classe = models.ForeignKey(Classe, on_delete=models.CASCADE, null=True, blank=True, related_name="annonces")
    date_publication = models.DateTimeField(auto_now_add=True)
    epingle = models.BooleanField(default=False)

    # Canaux additionnels au fil d'annonces in-app (celui-ci reste toujours actif) — surtout
    # utile pour les annonces plateforme du Super Admin, qui doivent parfois vraiment
    # atteindre les destinataires plutôt que d'attendre qu'ils consultent le fil.
    envoyer_email = models.BooleanField(default=False, help_text="Envoyer aussi cette annonce par e-mail aux destinataires")
    envoyer_sms = models.BooleanField(default=False, help_text="Envoyer aussi cette annonce par SMS aux destinataires")
    notifications_envoyees = models.BooleanField(default=False, editable=False)

    class Meta:
        ordering = ["-epingle", "-date_publication"]

    def __str__(self):
        return self.titre
