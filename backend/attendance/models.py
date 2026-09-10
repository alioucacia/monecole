from django.conf import settings
from django.db import models

from academics.models import Creneau
from people.models import EleveProfile


class Presence(models.Model):
    class Statut(models.TextChoices):
        PRESENT = "present", "Présent"
        ABSENT = "absent", "Absent"
        RETARD = "retard", "Retard"

    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="presences")
    date = models.DateField()
    creneau = models.ForeignKey(Creneau, on_delete=models.SET_NULL, null=True, blank=True, related_name="presences")
    # (déjà optionnel : blank=True permet de saisir une présence journalière sans créneau précis)
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.PRESENT)
    justifie = models.BooleanField(default=False)
    motif = models.CharField(max_length=255, blank=True)
    enregistre_par = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="presences_enregistrees"
    )

    class Meta:
        ordering = ["-date"]
        unique_together = ["eleve", "date", "creneau"]

    def __str__(self):
        return f"{self.eleve} - {self.date} - {self.get_statut_display()}"


class JustificatifAbsence(models.Model):
    """Justificatif soumis par l'élève/le parent pour une absence ou une maladie — avec
    preuve optionnelle (certificat médical scanné, etc.), à valider par l'administration
    ou la surveillance générale."""

    class Motif(models.TextChoices):
        MALADIE = "maladie", "Maladie"
        AUTRE = "autre", "Autre motif"

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        APPROUVE = "approuve", "Approuvé"
        REJETE = "rejete", "Rejeté"

    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="justificatifs")
    date_absence = models.DateField()
    motif = models.CharField(max_length=10, choices=Motif.choices, default=Motif.AUTRE)
    description = models.CharField(max_length=500, blank=True)
    piece_jointe = models.FileField(upload_to="justificatifs/", blank=True, null=True)
    statut = models.CharField(max_length=12, choices=Statut.choices, default=Statut.EN_ATTENTE)
    soumis_par = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="justificatifs_soumis"
    )
    traite_par = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="justificatifs_traites"
    )
    commentaire_traitement = models.CharField(max_length=255, blank=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-cree_le"]
        verbose_name = "Justificatif d'absence"
        verbose_name_plural = "Justificatifs d'absence"

    def __str__(self):
        return f"{self.eleve} - {self.date_absence} ({self.get_statut_display()})"
