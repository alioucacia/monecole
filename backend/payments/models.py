import re
import unicodedata
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

from academics.models import AnneeScolaire, Classe
from people.models import EleveProfile


_ORDINAUX_TRANCHE = {"premiere": 1, "premier": 1, "deuxieme": 2, "second": 2, "seconde": 2, "troisieme": 3}


def numero_tranche_du_nom(nom: str) -> int | None:
    """Numéro de tranche indiqué par le nom d'un type de frais — « 1ère Tranche », « 2ème
    tranche », « Tranche 3 », « Deuxième tranche »... — `None` si le nom n'en indique aucun
    (type de frais unique couvrant toutes les tranches)."""
    texte = unicodedata.normalize("NFKD", nom or "").encode("ascii", "ignore").decode().lower()
    if "tranche" not in texte:
        return None
    # `texte` est déjà sans accents (« n° » y devient « n »).
    chiffre = (
        re.search(r"\b(\d+)\s*(?:ere|er|eme|e|re|nd|nde)?\s*tranche\b", texte)
        or re.search(r"\btranche\s*(?:no?\.?\s*)?(\d+)\b", texte)
    )
    if chiffre:
        return int(chiffre.group(1)) or None
    for mot, numero in _ORDINAUX_TRANCHE.items():
        if re.search(rf"\b{mot}\s+tranche\b", texte):
            return numero
    return None


class TypeFrais(models.Model):
    class Periodicite(models.TextChoices):
        MENSUEL = "mensuel", "Mensuel"
        # Valeur DB inchangée ("trimestriel") pour ne pas migrer les données déjà en place —
        # seul le libellé affiché change ("Tranche" plutôt que "Trimestriel", demande explicite).
        TRIMESTRIEL = "trimestriel", "Tranche"
        ANNUEL = "annuel", "Annuel"
        AUTRE = "autre", "Autre / ponctuel"

    class Usage(models.TextChoices):
        STANDARD = "standard", "Standard"
        INSCRIPTION = "inscription", "Frais d'inscription (nouvel élève)"
        REINSCRIPTION = "reinscription", "Frais de réinscription"

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="types_frais")
    nom = models.CharField(max_length=100, help_text="Ex: Frais de scolarité, Cantine, Transport")
    montant_standard = models.DecimalField(max_digits=10, decimal_places=2)
    # Détermine la liste déroulante "Échéance" proposée à la création d'un Frais de ce type (voir
    # PaymentsPage.tsx : mensuel -> mois de l'année scolaire, trimestriel -> les Periode (Trimestre
    # 1/2/3...) de l'école, annuel -> l'année scolaire elle-même, autre -> une date libre comme
    # avant). `est_mensuel` reste le champ historique utilisé par tout le suivi mensuel
    # (Frais.montant_du, _calculer_suivi_mensuel, generer_pour_classe...) — pour ne pas devoir
    # migrer ces nombreux points, il est maintenant dérivé automatiquement de `periodicite` (voir
    # `save()` ci-dessous) plutôt que renseigné indépendamment : une seule information à tenir
    # à jour, pas deux qui pourraient diverger.
    periodicite = models.CharField(max_length=20, choices=Periodicite.choices, default=Periodicite.AUTRE)
    est_mensuel = models.BooleanField(
        default=False,
        help_text="Frais récurrent chaque mois (ex: scolarité mensuelle) — active le suivi mois par mois de l'élève",
    )
    # Marque CE type de frais comme LE frais d'inscription (ou de réinscription) de l'école — au
    # plus un de chaque par école, à la discrétion de l'admin (rien n'empêche techniquement d'en
    # marquer deux, seul le premier trouvé est utilisé). Permet de le retrouver de façon fiable
    # (StudentsPage à la création d'un élève, ReinscriptionPage) sans deviner sur le nom (un
    # `nom__icontains="inscription"` matchait aussi bien "réinscription" que "inscription", voir
    # people.views.EleveProfileViewSet.recu_inscription) — et surtout, une fois marqué, son
    # montant par classe se règle avec le mécanisme déjà existant (TarifClasse / "Tarifs par
    # classe"), qui fonctionne pour n'importe quel TypeFrais sans rien y ajouter.
    usage = models.CharField(max_length=20, choices=Usage.choices, default=Usage.STANDARD)

    class Meta:
        ordering = ["nom"]

    def __str__(self):
        return self.nom

    def save(self, *args, **kwargs):
        self.est_mensuel = self.periodicite == self.Periodicite.MENSUEL
        super().save(*args, **kwargs)

    @property
    def numero_tranche(self) -> int | None:
        """Pour un type de frais « Tranche » propre à UNE tranche (ex : « 2ème Tranche », chacun
        avec son montant), le numéro de cette tranche — voir `numero_tranche_du_nom`. `None` pour
        un type unique couvrant toutes les tranches (le paiement précise alors la tranche)."""
        if self.periodicite != self.Periodicite.TRIMESTRIEL:
            return None
        return numero_tranche_du_nom(self.nom)


USAGES_INSCRIPTION = (TypeFrais.Usage.INSCRIPTION, TypeFrais.Usage.REINSCRIPTION)
# Mois de mensualité d'une année scolaire : Octobre à Juin (9 mois). Septembre est le mois de
# l'inscription/réinscription, Juillet et Août sont hors année scolaire — aucun des trois n'est
# une mensualité (ni dans le suivi mensuel, ni dans les listes de mois, ni à l'encaissement).
MOIS_MENSUALITE = (10, 11, 12, 1, 2, 3, 4, 5, 6)
MESSAGE_MOIS_HORS_MENSUALITE = (
    "Les mensualités vont d'Octobre à Juin (9 mois) : Septembre est le mois de "
    "l'inscription/réinscription, Juillet et Août sont hors année scolaire."
)

# Formules de paiement de la scolarité, exclusives l'une de l'autre sur une même année (voir
# Frais.formule_scolarite).
PERIODICITES_SCOLARITE = (TypeFrais.Periodicite.MENSUEL, TypeFrais.Periodicite.TRIMESTRIEL, TypeFrais.Periodicite.ANNUEL)
FORMULES_SCOLARITE = {
    TypeFrais.Periodicite.MENSUEL: "par mensualités",
    TypeFrais.Periodicite.TRIMESTRIEL: "par tranches",
    TypeFrais.Periodicite.ANNUEL: "à l'année",
}

# Mois couverts par chaque tranche de scolarité (frais de périodicité « Tranche »), dans l'ordre
# des Periode de l'année (Trimestre 1, 2, 3) : la 1re tranche couvre aussi Juin, dernier mois.
MOIS_PAR_TRANCHE = ((10, 11, 12, 6), (1, 2, 3), (4, 5))


def formule_compatible(formule, periodicite) -> bool:
    """Une scolarité de périodicité `periodicite` peut-elle être payée par un élève dont la
    formule de l'année est `formule` (voir Frais.formule_scolarite) ? Les formules restent
    exclusives, à une exception près : un élève qui a commencé par tranches peut aussi payer
    par mensualités — mais jamais un mois couvert par une tranche déjà entamée (voir
    `tranches_entamees`)."""
    return (
        not formule or formule == periodicite
        or (formule == TypeFrais.Periodicite.TRIMESTRIEL and periodicite == TypeFrais.Periodicite.MENSUEL)
    )


def tranche_du_mois(mois_numero: int) -> int:
    """Numéro (1, 2, 3) de la tranche qui couvre ce mois de mensualité — voir MOIS_PAR_TRANCHE."""
    return next((i + 1 for i, mois in enumerate(MOIS_PAR_TRANCHE) if mois_numero in mois), 0)


def tranches_entamees(eleve_id, annee_scolaire_id) -> set[int]:
    """Numéros des tranches de scolarité sur lesquelles l'élève a déjà versé quelque chose cette
    année : type propre à une tranche (« 2ème Tranche »), ou tranche (Periode) précisée au
    paiement d'un type unique. Un versement ancien sans tranche précisée compte pour la 1re
    (le suivi mensuel complète les tranches dans l'ordre)."""
    from grades.models import Periode

    paiements = list(
        Paiement.objects.filter(
            frais__eleve_id=eleve_id, frais__annee_scolaire_id=annee_scolaire_id,
            frais__type_frais__periodicite=TypeFrais.Periodicite.TRIMESTRIEL, montant__gt=0,
        ).exclude(frais__type_frais__usage__in=USAGES_INSCRIPTION).select_related("frais__type_frais")
    )
    if not paiements:
        return set()
    periodes = list(
        Periode.objects.filter(annee_scolaire_id=annee_scolaire_id).order_by("date_debut").values_list("id", flat=True)
    )[:len(MOIS_PAR_TRANCHE)]
    numeros = set()
    for p in paiements:
        numero = p.frais.type_frais.numero_tranche
        if not numero:
            numero = periodes.index(p.periode_id) + 1 if p.periode_id in periodes else 1
        numeros.add(numero)
    return numeros


def mois_payes_en_mensualites(eleve_id, annee_scolaire_id) -> set[int]:
    """Numéros des mois (1-12) sur lesquels l'élève a déjà versé une mensualité cette année."""
    mois = set()
    for paye, frais_mois, echeance in Paiement.objects.filter(
        frais__eleve_id=eleve_id, frais__annee_scolaire_id=annee_scolaire_id,
        frais__type_frais__periodicite=TypeFrais.Periodicite.MENSUEL, montant__gt=0,
    ).exclude(frais__type_frais__usage__in=USAGES_INSCRIPTION).values_list("mois", "frais__mois", "frais__date_echeance"):
        mois.add((paye or frais_mois or echeance).month)
    return mois


MESSAGE_ELEVE_BONUS = "Élève Bonus : cet élève ne paie pas la scolarité (mensualités, tranches ou annuel)."


def est_scolarite(type_frais) -> bool:
    """Frais de scolarité (mensuel, tranche ou annuel), hors inscription/réinscription — ceux
    dont un « Élève Bonus » est exonéré. Cantine, transport, inscription... restent dus."""
    return type_frais.periodicite in PERIODICITES_SCOLARITE and type_frais.usage not in USAGES_INSCRIPTION


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
        return f"{self.type_frais} — {self.classe} ({self.annee_scolaire}) : {self.montant} GNF"


class Frais(models.Model):
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="frais")
    type_frais = models.ForeignKey(TypeFrais, on_delete=models.PROTECT, related_name="frais")
    annee_scolaire = models.ForeignKey(AnneeScolaire, on_delete=models.CASCADE, related_name="frais")
    montant = models.DecimalField(max_digits=10, decimal_places=2)
    date_echeance = models.DateField()
    # Mois couvert (1er du mois) par un frais Mensuel/Autre — distinct de `date_echeance`, qui est
    # désormais la date du jour de création (« Nouveau frais »). `None` pour les frais antérieurs
    # à ce champ : le mois se déduit alors de `date_echeance` (voir `mois_reference`).
    mois = models.DateField(null=True, blank=True)
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
        return f"{self.type_frais} - {self.eleve} ({self.montant} GNF)"

    @staticmethod
    def filtre_equivalents(eleve, type_frais, annee_scolaire, date_echeance=None) -> models.Q | None:
        """Critère des frais qui couvrent la MÊME obligation que (eleve, type_frais, annee) — un
        seul doit exister, sinon chaque doublon permettrait de repayer le même mois / la même
        inscription (les garde-fous de PaiementSerializer ne voyaient que le frais visé) :
        - inscription / réinscription : une seule par élève et par année, tous types confondus ;
        - tranche, annuel : un seul frais de ce type par élève et par année ;
        - mensuel, autre / ponctuel : un seul frais de ce type par élève et par MOIS d'échéance —
          les écoles créent un frais par mois (le formulaire demande le mois d'échéance, et
          « Générer pour la classe » est relancé chaque mois) : sans cette règle, rien
          n'empêchait de créer et payer deux fois le même mois, mais une règle « un par an »
          empêchait au contraire de créer les mois suivants. `None` si l'échéance n'est pas
          connue. Pour un frais mensuel, le mois PAYÉ (`Paiement.mois`) est en plus contrôlé
          sur tous les frais de ce type de l'année (voir PaiementSerializer.validate)."""
        base = models.Q(eleve=eleve, annee_scolaire=annee_scolaire)
        if type_frais.usage in USAGES_INSCRIPTION:
            return base & models.Q(type_frais__usage__in=USAGES_INSCRIPTION)
        if type_frais.periodicite not in (TypeFrais.Periodicite.AUTRE, TypeFrais.Periodicite.MENSUEL):
            return base & models.Q(type_frais=type_frais)
        if date_echeance:
            return base & models.Q(type_frais=type_frais) & Frais.filtre_mois(date_echeance)
        return None

    @staticmethod
    def filtre_mois(mois, prefixe="") -> models.Q:
        """Frais dont le mois couvert est `mois` : champ `mois` s'il est renseigné, sinon mois de
        `date_echeance` (frais créés avant l'ajout de `mois`)."""
        return models.Q(**{f"{prefixe}mois__year": mois.year, f"{prefixe}mois__month": mois.month}) | models.Q(**{
            f"{prefixe}mois__isnull": True,
            f"{prefixe}date_echeance__year": mois.year, f"{prefixe}date_echeance__month": mois.month,
        })

    @property
    def mois_reference(self):
        """Mois couvert par ce frais (1er du mois) — voir `mois`."""
        return (self.mois or self.date_echeance).replace(day=1)

    @staticmethod
    def formule_scolarite(eleve_id, annee_scolaire_id) -> str | None:
        """Formule de scolarité de l'élève pour l'année (périodicité Mensuel, Tranche ou Annuel),
        fixée par son PREMIER paiement de scolarité — `None` tant qu'il n'a rien payé. Une fois
        commencée, l'année se poursuit dans cette formule : un élève qui a payé à l'année ne
        paie plus de mensualité ni de tranche, et un élève qui a commencé par mensualités ne
        peut plus passer à l'annuel ni aux tranches. Seule exception (voir
        `formule_compatible`) : commencé par tranches, il peut compléter par mensualités les
        mois qu'aucune tranche entamée ne couvre."""
        premier = (
            Paiement.objects.filter(
                frais__eleve_id=eleve_id, frais__annee_scolaire_id=annee_scolaire_id,
                frais__type_frais__periodicite__in=PERIODICITES_SCOLARITE,
            )
            .exclude(frais__type_frais__usage__in=USAGES_INSCRIPTION)
            .order_by("date_paiement", "id").values_list("frais__type_frais__periodicite", flat=True).first()
        )
        return premier

    def equivalents(self):
        """Ce frais et ses éventuels doublons (données antérieures au blocage des doublons) —
        voir `filtre_equivalents`."""
        filtre = self.filtre_equivalents(self.eleve, self.type_frais, self.annee_scolaire, self.mois_reference)
        return Frais.objects.filter(filtre) if filtre is not None else Frais.objects.filter(pk=self.pk)

    def _facteur_reduction_courant(self) -> Decimal | None:
        """Le facteur de réduction ACTUELLEMENT applicable à ce frais selon son usage — deux
        barèmes distincts (voir EleveProfile.facteur_mensualite/facteur_inscription_reinscription) :
        mensualité (scolarité) d'un côté, inscription/réinscription de l'autre. `None` pour tout
        le reste (cantine, transport, tranche, annuel, autre...), qui reste dû intégralement quelle
        que soit la catégorie de l'élève — ces frais-là n'entrent jamais dans le mécanisme de gel
        ci-dessous."""
        if self.eleve.exonere_fratrie and est_scolarite(self.type_frais):
            # « Élève Bonus » (voir people/fratrie.py) : scolarité gratuite, quelle que soit la
            # formule (mensualités, tranches ou annuel).
            return Decimal("0")
        if self.type_frais.est_mensuel:
            return self.eleve.facteur_mensualite
        if self.type_frais.usage in (TypeFrais.Usage.INSCRIPTION, TypeFrais.Usage.REINSCRIPTION):
            return self.eleve.facteur_inscription_reinscription
        return None

    @property
    def montant_du(self) -> Decimal:
        """Montant réellement dû, compte tenu d'une éventuelle réduction — `self.montant` reste
        toujours le tarif standard (utile pour reproduire un frais identique l'année suivante,
        ou juste voir le tarif de référence). Seuls les frais mensuels (scolarité) et les frais
        d'inscription/réinscription (TypeFrais.usage) sont concernés par une catégorie de
        paiement — les autres types (cantine, transport...) restent dus intégralement quelle
        que soit la catégorie de l'élève.

        AVANT un premier correctif, `solde`/`statut` ci-dessous se basaient directement sur
        `self.montant` (le tarif plein) : un élève « Fondation 50% » ou avec la réduction fidélité
        de 5% se voyait donc réclamer/afficher le montant intégral partout où ce frais est utilisé
        (liste des frais, encaissement d'un paiement, fiche de paiement PDF).

        Tant qu'aucun paiement n'a été encaissé sur ce frais, la réduction appliquée est celle
        actuelle de l'élève (`facteur_applique` vaut `None`, recalculée à la volée à chaque appel).
        Dès le PREMIER paiement, `facteur_applique` est figé (voir `PaiementViewSet.perform_create`)
        à la réduction en vigueur à cet instant, pour ne jamais recalculer rétroactivement un mois
        déjà soldé (un mois payé à 100% ne doit pas repasser « impayé/partiel » si la réduction de
        l'élève est retirée après coup).

        MAIS ce gel ne doit bloquer que les DURCISSEMENTS (réduction retirée/diminuée) — jamais un
        ASSOUPLISSEMENT (nouvelle catégorie plus favorable, ou réduction fidélité tout juste
        accordée) : un gel figé une bonne fois pour toutes au premier paiement empêchait cette
        dernière de jamais s'appliquer aux mois suivants de l'année, y compris ceux pas encore
        payés — c'était le bug initialement signalé ici. Le gel « cliquette » donc uniquement vers
        le bas : dès qu'un facteur plus favorable que celui figé est observé, il devient le nouveau
        gel (persisté), et ne remonte plus jamais — un mois soldé pendant une période où la
        réduction était plus généreuse reste protégé même si elle est ensuite retirée."""
        facteur_actuel = self._facteur_reduction_courant()
        if facteur_actuel is None:
            return self.montant
        if self.facteur_applique is None:
            facteur = facteur_actuel
        elif facteur_actuel < self.facteur_applique:
            self.facteur_applique = facteur_actuel
            if self.pk:
                type(self).objects.filter(pk=self.pk).update(facteur_applique=facteur_actuel)
            facteur = facteur_actuel
        else:
            facteur = self.facteur_applique
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
        # Un élève Fondation 100% (montant_du == 0 pour un frais mensuel/inscription/
        # réinscription) n'a RIEN à payer sur ce frais — sans ce cas, il s'affichait "Impayé"
        # partout (liste des frais, situation par classe...) pour un frais dont il est
        # légitimement exonéré, ce qui est trompeur autant pour l'élève que pour la comptabilité.
        if self.montant_du <= 0:
            return "paye"
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
    # Pendant de `mois` ci-dessus, pour un frais de périodicité Tranche (trimestriel) : quelle
    # tranche ce paiement couvre — réutilise les mêmes Periode (Trimestre 1/2/3...) que les
    # bulletins plutôt que d'inventer un second découpage de l'année. Permet le même
    # garde-fou anti-double-paiement que pour le mois (voir PaiementSerializer.validate).
    periode = models.ForeignKey(
        "grades.Periode", on_delete=models.SET_NULL, null=True, blank=True, related_name="paiements",
        help_text="Tranche couverte par ce paiement (uniquement pour un frais de périodicité Tranche)",
    )

    class Meta:
        ordering = ["-date_paiement"]

    def save(self, *args, **kwargs):
        if self.mois:
            self.mois = self.mois.replace(day=1)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.frais.eleve} - {self.montant} GNF ({self.date_paiement})"


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
        return f"{self.motif} — {self.montant} GNF ({self.date})"
