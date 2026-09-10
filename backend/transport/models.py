import uuid
from decimal import Decimal

from django.db import models

from people.models import EleveProfile


class Trajet(models.Model):
    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="trajets")
    nom = models.CharField(max_length=100, help_text="Ex: Ligne 1 — Centre-ville")
    chauffeur_nom = models.CharField(max_length=150, blank=True)
    chauffeur_telephone = models.CharField(
        max_length=30, blank=True,
        help_text="Visible par les élèves/parents affectés à ce trajet, pour le joindre directement.",
    )
    vehicule_immatriculation = models.CharField(max_length=30, blank=True)
    capacite = models.PositiveIntegerField(default=30)
    heure_depart = models.TimeField(null=True, blank=True)
    heure_retour = models.TimeField(null=True, blank=True)
    description = models.CharField(max_length=255, blank=True)

    # Lien de scan pour le chauffeur (pas de compte à créer : un lien secret suffit, comme
    # la vérification de badge). Le chauffeur l'ouvre sur son téléphone pour pointer les
    # montées/descentes ; chaque pointage peut mettre à jour la position connue du bus.
    token_chauffeur = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    derniere_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    derniere_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    position_maj_le = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["nom"]

    def __str__(self):
        return self.nom

    @property
    def effectif(self):
        return self.affectations.count()


class AffectationTransport(models.Model):
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="affectations_transport")
    trajet = models.ForeignKey(Trajet, on_delete=models.CASCADE, related_name="affectations")
    point_montee = models.CharField(max_length=150, blank=True)
    date_debut = models.DateField(auto_now_add=True)

    class Meta:
        ordering = ["trajet__nom"]
        unique_together = ["eleve", "trajet"]

    def __str__(self):
        return f"{self.eleve} → {self.trajet}"


class PointageTransport(models.Model):
    """Montée/descente d'un élève, pointée par le chauffeur via son lien de scan. La position
    GPS du téléphone au moment du scan (si autorisée par le navigateur) sert de dernière
    position connue du bus — pas de traceur GPS matériel requis."""

    class TypeEvenement(models.TextChoices):
        MONTEE = "montee", "Montée"
        DESCENTE = "descente", "Descente"

    trajet = models.ForeignKey(Trajet, on_delete=models.CASCADE, related_name="pointages")
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="pointages_transport")
    type_evenement = models.CharField(max_length=10, choices=TypeEvenement.choices)
    horodatage = models.DateTimeField(auto_now_add=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    class Meta:
        ordering = ["-horodatage"]
        verbose_name = "Pointage transport"
        verbose_name_plural = "Pointages transport"

    def __str__(self):
        return f"{self.eleve} — {self.get_type_evenement_display()} ({self.horodatage:%d/%m %H:%M})"


class TicketBus(models.Model):
    """Ticket/abonnement mensuel de bus pour un élève affecté à un trajet — imprimable
    avec QR, vérifiable par le chauffeur avant la montée."""

    affectation = models.ForeignKey(AffectationTransport, on_delete=models.CASCADE, related_name="tickets")
    mois = models.DateField(help_text="Premier jour du mois couvert par ce ticket")
    montant = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    paye = models.BooleanField(default=False)
    date_paiement = models.DateField(null=True, blank=True)
    qr_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-mois"]
        unique_together = ["affectation", "mois"]
        verbose_name = "Ticket de bus"
        verbose_name_plural = "Tickets de bus"

    def save(self, *args, **kwargs):
        if self.mois:
            self.mois = self.mois.replace(day=1)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.affectation.eleve} — {self.mois:%m/%Y}"
