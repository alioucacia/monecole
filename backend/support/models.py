import os

from django.conf import settings
from django.db import models


def ticket_upload_path(instance, filename):
    return f"tickets/{instance.ticket_id}/{filename}"


class Ticket(models.Model):
    """Un ticket de support technique, ouvert par n'importe quel utilisateur connecté (élève,
    parent, enseignant, personnel, admin d'école) et traité par la plateforme (Super Admin) —
    contrairement à `messaging.Message`, qui reste strictement interne à une même école, un
    ticket traverse volontairement la frontière école/plateforme (voir `ecole`, nullable, et
    `assigne_a`, réservé au rôle superadmin)."""

    class Statut(models.TextChoices):
        OUVERT = "ouvert", "Ouvert"
        EN_COURS = "en_cours", "En cours de traitement"
        RESOLU = "resolu", "Résolu"
        FERME = "ferme", "Fermé"

    class Priorite(models.TextChoices):
        BASSE = "basse", "Basse"
        NORMALE = "normale", "Normale"
        HAUTE = "haute", "Haute"
        URGENTE = "urgente", "Urgente"

    # Nullable : un ticket ouvert par un Super Admin (rare, mais son compte n'a pas d'école) ne
    # doit pas être bloqué par une contrainte NOT NULL.
    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, blank=True, related_name="tickets")
    auteur = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tickets_crees")
    sujet = models.CharField(max_length=150)
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.OUVERT)
    priorite = models.CharField(max_length=10, choices=Priorite.choices, default=Priorite.NORMALE)
    cree_le = models.DateTimeField(auto_now_add=True)
    maj_le = models.DateTimeField(auto_now=True)
    assigne_a = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="tickets_assignes", limit_choices_to={"role": "superadmin"},
    )

    class Meta:
        ordering = ["-maj_le"]
        verbose_name = "Ticket de support"
        verbose_name_plural = "Tickets de support"

    def __str__(self):
        return f"#{self.pk} — {self.sujet} ({self.get_statut_display()})"

    def save(self, *args, **kwargs):
        if not self.ecole_id and self.auteur_id and self.auteur.ecole_id:
            self.ecole_id = self.auteur.ecole_id
        super().save(*args, **kwargs)


class MessageTicket(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    auteur = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_tickets")
    contenu = models.TextField(blank=True)
    fichier = models.FileField(upload_to=ticket_upload_path, blank=True, null=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["cree_le"]
        verbose_name = "Message de ticket"
        verbose_name_plural = "Messages de ticket"

    def __str__(self):
        return f"{self.auteur} sur ticket #{self.ticket_id} ({self.cree_le:%d/%m/%Y})"

    @property
    def fichier_nom(self):
        return os.path.basename(self.fichier.name) if self.fichier else None
