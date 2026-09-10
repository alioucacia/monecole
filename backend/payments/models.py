from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

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
    # Figé au premier paiement encaissé sur ce frais (voir PaiementViewSet.perform_create), à la
    # valeur de `eleve.facteur_mensualite` à cet instant — reste `None` tant qu'aucun paiement n'a
    # été fait (le frais suit alors la réduction courante, toujours modifiable). Une fois figé, un
    # changement ultérieur de catégorie de paiement de l'élève n'affecte plus ce frais : la
    # réduction ne s'applique jamais à une somme déjà versée (voir `montant_du` ci-dessous).
    facteur_applique = models.DecimalField(max_digits=4, decimal_places=3, null=True, blank=True)

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
        ou juste voir le tarif de référence). Seuls les frais mensuels (scolarité) sont concernés
        — les autres types (cantine, transport, inscription...) restent dus intégralement quelle
        que soit la catégorie de l'élève.

        AVANT un premier correctif, `solde`/`statut` ci-dessous se basaient directement sur
        `self.montant` (le tarif plein) : un élève « Fondation 50% » ou avec la réduction fidélité
        de 5% se voyait donc réclamer/afficher le montant intégral partout où ce frais est utilisé
        (liste des frais, encaissement d'un paiement, fiche de paiement PDF).

        Tant qu'aucun paiement n'a été encaissé sur ce frais, la réduction appliquée est celle
        actuelle de l'élève (`facteur_applique` vaut `None`, recalculée à la volée à chaque appel).
        Dès le PREMIER paiement, `facteur_applique` est figé (voir `PaiementViewSet.perform_create`)
        à la réduction en vigueur à cet instant — un changement de catégorie de paiement ultérieur
        n'affecte alors plus ce frais : la réduction ne s'applique jamais à une somme déjà versée.
        Sans ce gel, changer la catégorie de l'élève après des paiements déjà encaissés recalculait
        rétroactivement le montant dû — un mois déjà soldé au tarif réduit repassait « impayé/
        partiel » dès que la réduction était retirée après coup (ou l'inverse en l'accordant)."""
        if not self.type_frais.est_mensuel:
            return self.montant
        facteur = self.facteur_applique if self.facteur_applique is not None else self.eleve.facteur_mensualite
        # `facteur` a 3 décimales (voir facteur_applique/EleveProfile.facteur_mensualite) : sans
        # arrondi, le produit hérite de ces 3 décimales et dépasse les 2 autorisées par
        # Paiement.montant, ce qui rejette avec une erreur de validation tout paiement dont le
        # montant est repris tel quel depuis ce calcul (ex: "payer le solde exact du mois").
        return (self.montant * facteur).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

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


# Catégories créées automatiquement pour chaque école (voir le signal plus bas) — un point de
# départ raisonnable, que l'administrateur peut ensuite renommer, compléter ou supprimer depuis
# CategorieDepenseViewSet (rien de figé côté code, contrairement à l'ancien Depense.Categorie
# à choix fixes que ce modèle remplace).
CATEGORIES_DEPENSE_PAR_DEFAUT = [
    "Fournitures scolaires", "Entretien / Réparations", "Salaires (hors enseignants)",
    "Eau / Électricité / Internet", "Transport", "Restauration / Cantine", "Événement scolaire", "Autre",
]


class CategorieDepense(models.Model):
    """Catégorie de dépense, propre à chaque école et librement gérée par son administrateur
    (contrairement aux choix fixes qu'elle remplace) — voir CATEGORIES_DEPENSE_PAR_DEFAUT pour
    le jeu de départ créé automatiquement à la création de l'école."""

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, related_name="categories_depense")
    nom = models.CharField(max_length=100)

    class Meta:
        unique_together = ["ecole", "nom"]
        ordering = ["nom"]
        verbose_name = "Catégorie de dépense"
        verbose_name_plural = "Catégories de dépense"

    def __str__(self):
        return self.nom


@receiver(post_save, sender="tenants.Ecole")
def creer_categories_depense_par_defaut(sender, instance, created, **kwargs):
    if created:
        CategorieDepense.objects.bulk_create(
            [CategorieDepense(ecole=instance, nom=nom) for nom in CATEGORIES_DEPENSE_PAR_DEFAUT],
            ignore_conflicts=True,
        )


class Depense(models.Model):
    """Une sortie de caisse de l'établissement (hors salaires enseignants, gérés séparément dans
    `people.PaieEnseignant`) : fournitures, entretien, factures... — le pendant de `Paiement`
    (une rentrée) pour le tableau de bord Caisse (voir `CaisseView`)."""

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, related_name="depenses")
    date = models.DateField(default=date.today, help_text="Date effective de la dépense (modifiable — saisie possible a posteriori)")
    categorie = models.ForeignKey(
        CategorieDepense, on_delete=models.PROTECT, related_name="depenses",
        help_text="Catégories gérées par l'établissement — voir CategorieDepenseViewSet",
    )
    motif = models.CharField(max_length=255)
    montant = models.DecimalField(max_digits=10, decimal_places=2)
    mode_paiement = models.CharField(max_length=20, choices=Paiement.ModePaiement.choices, default=Paiement.ModePaiement.ESPECES)
    reference = models.CharField(max_length=100, blank=True)
    # Texte libre plutôt qu'une FK vers un compte utilisateur : la personne qui a autorisé/émis la
    # dépense (ex: le Directeur) n'a pas forcément de compte dans l'application.
    responsable = models.CharField(max_length=150, help_text="Personne responsable ayant autorisé/émis cette dépense")
    enregistre_par = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="depenses_enregistrees",
        help_text="Utilisateur ayant saisi la dépense dans l'application (traçabilité, distinct du responsable ci-dessus)",
    )
    justificatif = models.FileField(upload_to="depenses/", blank=True, null=True)
    commentaire = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "Dépense"
        verbose_name_plural = "Dépenses"

    def __str__(self):
        return f"{self.motif} — {self.montant} ({self.date})"
