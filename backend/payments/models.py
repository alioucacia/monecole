from decimal import Decimal

from django.conf import settings
from django.db import models

from academics.models import AnneeScolaire, Classe
from people.models import EleveProfile


class TypeFrais(models.Model):
    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="types_frais")
    nom = models.CharField(max_length=100, help_text="Ex: Frais de scolarité, Cantine, Transport")
    montant_standard = models.DecimalField(max_digits=10, decimal_places=2)
    est_mensuel = models.BooleanField(
        default=False,
        help_text="Frais récurrent chaque mois (ex: scolarité mensuelle) — active le suivi mois par mois de l'élève",
    )

    class Meta:
        ordering = ["nom"]

    def __str__(self):
        return self.nom


class TarifClasse(models.Model):
    """Montant spécifique d'un type de frais pour une classe donnée, sur une année scolaire —
    permet de paramétrer des tarifs différents par classe (ex: scolarité plus élevée en
    Terminale qu'en 6ème) sans ressaisir un montant à la main pour chaque élève. Sert de valeur
    par défaut lors de la création des `Frais` (à la place de `TypeFrais.montant_standard`)."""

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, related_name="tarifs_classe")
    type_frais = models.ForeignKey(TypeFrais, on_delete=models.CASCADE, related_name="tarifs_classe")
    classe = models.ForeignKey(Classe, on_delete=models.CASCADE, related_name="tarifs_frais")
    annee_scolaire = models.ForeignKey(AnneeScolaire, on_delete=models.CASCADE, related_name="tarifs_classe")
    montant = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        unique_together = ["type_frais", "classe", "annee_scolaire"]
        ordering = ["classe__niveau", "classe__nom", "type_frais__nom"]
        verbose_name = "Tarif par classe"
        verbose_name_plural = "Tarifs par classe"

    def __str__(self):
        return f"{self.type_frais} — {self.classe} ({self.annee_scolaire}) : {self.montant}"


class Frais(models.Model):
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="frais")
    type_frais = models.ForeignKey(TypeFrais, on_delete=models.PROTECT, related_name="frais")
    annee_scolaire = models.ForeignKey(AnneeScolaire, on_delete=models.CASCADE, related_name="frais")
    montant = models.DecimalField(max_digits=10, decimal_places=2)
    date_echeance = models.DateField()

    class Meta:
        ordering = ["-date_echeance"]
        verbose_name = "Frais"
        verbose_name_plural = "Frais"

    def __str__(self):
        return f"{self.type_frais} - {self.eleve} ({self.montant})"

    @property
    def montant_du(self) -> Decimal:
        """Montant réellement dû, compte tenu d'une éventuelle réduction — `self.montant` reste
        toujours le tarif standard (utile pour reproduire un frais identique l'année suivante,
        ou juste voir le tarif de référence), la réduction n'y est jamais figée (voir
        `EleveProfile.facteur_mensualite` : recalculée à la volée pour rester à jour même si la
        catégorie de paiement de l'élève change après coup). Seuls les frais mensuels (scolarité)
        sont concernés — les autres types (cantine, transport, inscription...) restent dus
        intégralement quelle que soit la catégorie de l'élève.

        AVANT ce correctif, `solde`/`statut` ci-dessous se basaient directement sur `self.montant`
        (le tarif plein) : un élève « Fondation 50% » ou avec la réduction fidélité de 5% se
        voyait donc réclamer/afficher le montant intégral partout où ce frais est utilisé (liste
        des frais, encaissement d'un paiement, fiche de paiement PDF) — seul le rapport séparé
        « suivi mensuel » (`_calculer_suivi_mensuel`) appliquait déjà correctement la réduction.

        Le montant dû ne redescend jamais en dessous de ce qui a déjà été payé (`max(...,
        self.montant_paye)`) : la réduction ne s'applique donc plus à une somme déjà versée. Sans
        ce plancher, changer la catégorie de paiement de l'élève APRÈS des paiements déjà encaissés
        recalculerait rétroactivement le montant dû — un frais déjà soldé au tarif plein
        repasserait « impayé/partiel » si la réduction est retirée après coup, ou au contraire
        deviendrait « payé en trop » si une réduction est accordée après coup."""
        if not self.type_frais.est_mensuel:
            return self.montant
        return max(self.montant * self.eleve.facteur_mensualite, self.montant_paye)

    @property
    def montant_paye(self):
        total = self.paiements.aggregate(total=models.Sum("montant"))["total"]
        return total or Decimal("0")

    @property
    def solde(self):
        return self.montant_du - self.montant_paye

    @property
    def statut(self):
        if self.montant_paye <= 0:
            return "impaye"
        if self.montant_paye < self.montant_du:
            return "partiel"
        return "paye"


class Paiement(models.Model):
    class ModePaiement(models.TextChoices):
        ESPECES = "especes", "Espèces"
        CHEQUE = "cheque", "Chèque"
        VIREMENT = "virement", "Virement"
        MOBILE_MONEY = "mobile_money", "Mobile Money"

    frais = models.ForeignKey(Frais, on_delete=models.CASCADE, related_name="paiements")
    montant = models.DecimalField(max_digits=10, decimal_places=2)
    date_paiement = models.DateField(auto_now_add=True)
    mode_paiement = models.CharField(max_length=20, choices=ModePaiement.choices, default=ModePaiement.ESPECES)
    reference = models.CharField(max_length=100, blank=True)
    enregistre_par = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="paiements_enregistres")
    mois = models.DateField(
        null=True, blank=True,
        help_text="Mois de scolarité couvert par ce paiement (uniquement pour un frais mensuel) — premier jour du mois",
    )

    class Meta:
        ordering = ["-date_paiement"]

    def save(self, *args, **kwargs):
        if self.mois:
            self.mois = self.mois.replace(day=1)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.frais.eleve} - {self.montant} ({self.date_paiement})"
