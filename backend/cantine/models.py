import uuid
from decimal import Decimal

from django.db import models

from people.models import EleveProfile


class Formule(models.Model):
    """Une formule de repas proposée par la cantine (ex: Formule standard, Menu végétarien)."""

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="formules_cantine")
    nom = models.CharField(max_length=100, help_text="Ex: Formule standard")
    responsable_nom = models.CharField(max_length=150, blank=True)
    responsable_telephone = models.CharField(
        max_length=30, blank=True,
        help_text="Visible par les élèves/parents inscrits à cette formule, pour le joindre directement.",
    )
    prix = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    capacite = models.PositiveIntegerField(default=100)
    heure_service = models.TimeField(null=True, blank=True)
    description = models.CharField(max_length=255, blank=True)

    # Lien de scan pour l'agent de cantine (pas de compte à créer : un lien secret suffit,
    # comme la vérification de badge). L'agent l'ouvre sur son téléphone/tablette pour
    # pointer les repas pris au self.
    token_agent = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    class Meta:
        ordering = ["nom"]

    def __str__(self):
        return self.nom

    @property
    def effectif(self):
        return self.inscriptions.count()


class InscriptionCantine(models.Model):
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="inscriptions_cantine")
    formule = models.ForeignKey(Formule, on_delete=models.CASCADE, related_name="inscriptions")
    date_debut = models.DateField(auto_now_add=True)

    class Meta:
        ordering = ["formule__nom"]
        unique_together = ["eleve", "formule"]

    def __str__(self):
        return f"{self.eleve} → {self.formule}"


class PointageCantine(models.Model):
    """Repas pris par un élève, pointé par l'agent de cantine via son lien de scan."""

    formule = models.ForeignKey(Formule, on_delete=models.CASCADE, related_name="pointages")
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="pointages_cantine")
    horodatage = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-horodatage"]
        verbose_name = "Pointage cantine"
        verbose_name_plural = "Pointages cantine"

    def __str__(self):
        return f"{self.eleve} — repas ({self.horodatage:%d/%m %H:%M})"


class TicketCantine(models.Model):
    """Ticket/abonnement mensuel de cantine pour un élève inscrit à une formule —
    imprimable avec QR, vérifiable par l'agent avant le service."""

    inscription = models.ForeignKey(InscriptionCantine, on_delete=models.CASCADE, related_name="tickets")
    mois = models.DateField(help_text="Premier jour du mois couvert par ce ticket")
    montant = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    paye = models.BooleanField(default=False)
    date_paiement = models.DateField(null=True, blank=True)
    qr_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-mois"]
        unique_together = ["inscription", "mois"]
        verbose_name = "Ticket de cantine"
        verbose_name_plural = "Tickets de cantine"

    def save(self, *args, **kwargs):
        if self.mois:
            self.mois = self.mois.replace(day=1)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.inscription.eleve} — {self.mois:%m/%Y}"
