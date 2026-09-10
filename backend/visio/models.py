import uuid

from django.conf import settings
from django.db import models

from tenants.models import Ecole


class Reunion(models.Model):
    """Une réunion vidéo (planifiée) ou un appel instantané entre utilisateurs de la même
    école. La visioconférence elle-même n'est pas hébergée par cette plateforme — chaque
    réunion se voit attribuer un nom de salle unique (`salle`) sur le service public Jitsi
    Meet (meet.jit.si), gratuit, sans compte requis côté participants, et embarquable en
    iframe — voir `VisioPage.tsx` côté frontend. Aucune infrastructure temps réel (signalisation
    WebRTC, serveur TURN...) n'est donc nécessaire ici, ce qui évite d'alourdir la plateforme
    d'une brique que ni Django ni ce projet ne portent aujourd'hui (pas de Channels/ASGI)."""

    class Statut(models.TextChoices):
        PLANIFIEE = "planifiee", "Planifiée"
        EN_COURS = "en_cours", "En cours"
        TERMINEE = "terminee", "Terminée"
        ANNULEE = "annulee", "Annulée"

    ecole = models.ForeignKey(Ecole, on_delete=models.CASCADE, related_name="reunions")
    titre = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    organisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reunions_organisees"
    )
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name="reunions_invite", blank=True
    )
    # Nom de salle Jitsi Meet — unique et peu devinable (préfixé par l'école) puisque
    # meet.jit.si est un service PARTAGÉ par tout le monde : n'importe qui connaissant le nom
    # exact d'une salle peut la rejoindre, d'où l'UUID plutôt qu'un slug lisible.
    salle = models.CharField(max_length=100, unique=True, editable=False)
    date_debut = models.DateTimeField()
    duree_minutes = models.PositiveSmallIntegerField(default=30)
    statut = models.CharField(max_length=15, choices=Statut.choices, default=Statut.PLANIFIEE)
    # Appel rapide (déclenché depuis la messagerie, démarre immédiatement, un seul invité) par
    # opposition à une réunion planifiée à l'avance avec plusieurs participants.
    instantanee = models.BooleanField(default=False)
    # Appel audio seul (caméra coupée à l'entrée dans la salle Jitsi, réactivable à tout moment
    # par chaque participant) — utile pour un appel rapide sans vidéo. Sans effet sur une
    # réunion planifiée classique (toujours en vidéo).
    avec_video = models.BooleanField(default=True)
    date_creation = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date_debut"]
        verbose_name = "Réunion"
        verbose_name_plural = "Réunions"

    def __str__(self):
        return f"{self.titre} ({self.date_debut:%d/%m/%Y %H:%M})"

    def save(self, *args, **kwargs):
        if not self.salle:
            prefixe = self.ecole.slug if self.ecole_id else "ecole"
            self.salle = f"em-{prefixe}-{uuid.uuid4().hex[:16]}"
        super().save(*args, **kwargs)
