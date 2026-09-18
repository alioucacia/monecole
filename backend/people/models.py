import unicodedata
from decimal import Decimal

from django.conf import settings
from django.db import models
import uuid

from academics.models import AnneeScolaire, Classe


def _deux_lettres(texte: str) -> str:
    """2 premières lettres (sans accent, majuscules) d'un nom/prénom — "Élodie" -> "EL",
    "Aïssatou" -> "AI". "XX" si rien d'exploitable (chaîne vide, ne contenant que des espaces...)."""
    normalise = unicodedata.normalize("NFKD", texte or "")
    lettres = "".join(c for c in normalise if c.isalpha())
    return (lettres[:2] or "XX").upper()


def generer_matricule_eleve(first_name: str, last_name: str, ecole) -> str:
    """Matricule auto-généré : 2 premières lettres du prénom + 2 premières lettres du nom +
    le numéro de place de cet élève dans la table des inscriptions de l'école (ex: 15e élève
    inscrit à cette école -> "OUBA15"). Le matricule sert aussi d'identifiant de connexion
    (`username`) et doit donc rester unique sur toute la plateforme, pas seulement par école —
    on incrémente le numéro tant que la combinaison existe déjà (collision entre deux écoles
    ayant les mêmes initiales au même rang, ou matricule ré-attribué manuellement)."""
    from accounts.models import User

    prefixe = _deux_lettres(first_name) + _deux_lettres(last_name)
    rang = EleveProfile.objects.filter(user__ecole=ecole).count() + 1
    matricule = f"{prefixe}{rang}"
    while EleveProfile.objects.filter(matricule=matricule).exists() or User.objects.filter(username=matricule).exists():
        rang += 1
        matricule = f"{prefixe}{rang}"
    return matricule


def generer_matricule_enseignant(first_name: str, last_name: str, ecole) -> str:
    """Matricule auto-généré pour un enseignant, sur le même principe que celui des élèves
    (voir `generer_matricule_eleve`) : 2 premières lettres du prénom + 2 premières lettres du
    nom + le numéro de place de cet enseignant dans l'école (ex: 5e enseignant embauché dans
    cette école -> "OUBA5"). Sert aussi d'identifiant de connexion (`username`), donc unique sur
    toute la plateforme."""
    from accounts.models import User

    prefixe = _deux_lettres(first_name) + _deux_lettres(last_name)
    rang = EnseignantProfile.objects.filter(user__ecole=ecole).count() + 1
    matricule = f"{prefixe}{rang}"
    while EnseignantProfile.objects.filter(matricule=matricule).exists() or User.objects.filter(username=matricule).exists():
        rang += 1
        matricule = f"{prefixe}{rang}"
    return matricule


class EleveProfile(models.Model):
    class Regime(models.TextChoices):
        EXTERNE = "externe", "Externe"
        DEMI_PENSION = "demi_pension", "Demi-pension"
        INTERNE = "interne", "Interne"

    class StatutInscription(models.TextChoices):
        NOUVEAU = "nouveau", "Nouvelle inscription"
        REINSCRIPTION = "reinscription", "Réinscription"
        TRANSFERT = "transfert", "Transfert"

    class CategoriePaiement(models.TextChoices):
        STANDARD = "standard", "Standard — paie l'intégralité de la mensualité"
        FONDATION_50 = "fondation_50", "Fondation — 50% de réduction sur la mensualité"
        FONDATION_GRATUIT = "fondation_gratuit", "Fondation — exonéré de mensualité"
        INSCRIPTION_SEULEMENT = "inscription_seulement", "Inscription/réinscription uniquement (pas de mensualité)"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="eleve_profile",
        limit_choices_to={"role": "student"},
    )
    matricule = models.CharField(max_length=30, unique=True)
    classe = models.ForeignKey(Classe, on_delete=models.SET_NULL, null=True, blank=True, related_name="eleves")
    parent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        limit_choices_to={"role": "parent"},
        related_name="enfants",
    )
    date_inscription = models.DateField(auto_now_add=True)
    lieu_naissance = models.CharField(max_length=100, blank=True)

    # Filiation — noms libres (en plus du compte "parent" ci-dessus, qui donne l'accès au
    # portail) : la fiche d'inscription papier liste traditionnellement père/mère/tuteur.
    nom_pere = models.CharField(max_length=150, blank=True)
    nom_mere = models.CharField(max_length=150, blank=True)
    nom_tuteur = models.CharField(max_length=150, blank=True)

    regime = models.CharField(max_length=20, choices=Regime.choices, default=Regime.EXTERNE)
    statut_inscription = models.CharField(max_length=20, choices=StatutInscription.choices, default=StatutInscription.NOUVEAU)

    actif = models.BooleanField(default=True, help_text="Faux si l'élève ne se réinscrit pas (parti, changé d'école...)")
    date_sortie = models.DateField(null=True, blank=True)
    motif_sortie = models.CharField(max_length=255, blank=True)

    # Prise en charge de la mensualité (scolarité) — n'affecte que les frais marqués « mensuel »
    # (TypeFrais.est_mensuel) ; les autres frais (cantine, transport, inscription...) restent
    # facturés normalement à tous les élèves, quelle que soit leur catégorie.
    categorie_paiement = models.CharField(
        max_length=25, choices=CategoriePaiement.choices, default=CategoriePaiement.STANDARD,
    )
    reduction_fidelite_mensualite = models.BooleanField(
        default=False,
        help_text=(
            "Réduction de 5% sur la mensualité, accordée manuellement par l'administration aux "
            "élèves réguliers dans leurs paiements. Se cumule avec la catégorie de paiement "
            "(ex: Fondation 50% + fidélité = 47,5% du tarif standard)."
        ),
    )

    class Meta:
        ordering = ["user__last_name", "user__first_name"]
        verbose_name = "Profil élève"
        verbose_name_plural = "Profils élèves"

    def __str__(self):
        return f"{self.user.get_full_name()} ({self.matricule})"

    @property
    def facteur_mensualite(self) -> Decimal:
        """Fraction du tarif standard de mensualité effectivement due par cet élève, compte tenu
        de sa catégorie de paiement et d'une éventuelle réduction fidélité (les deux se cumulent).
        0 = aucune mensualité due (Fondation gratuite, ou élève qui ne paie que l'inscription)."""
        if self.categorie_paiement in (self.CategoriePaiement.FONDATION_GRATUIT, self.CategoriePaiement.INSCRIPTION_SEULEMENT):
            return Decimal("0")
        facteur = Decimal("0.5") if self.categorie_paiement == self.CategoriePaiement.FONDATION_50 else Decimal("1")
        if self.reduction_fidelite_mensualite:
            facteur *= Decimal("0.95")
        return facteur

    @property
    def facteur_inscription_reinscription(self) -> Decimal:
        """Fraction du tarif standard des frais d'inscription/réinscription (TypeFrais.usage)
        effectivement due par cet élève — barème DISTINCT de `facteur_mensualite` : seule la
        catégorie « Fondation 100% » (exonération totale, gratuité) en dispense complètement.
        Fondation 50% et « Inscription seulement » paient ces frais-là en INTÉGRALITÉ (c'est
        justement ce qui les distingue de Fondation 100% — voir les 4 catégories définies par
        l'établissement) ; la réduction fidélité (mensualité uniquement) ne s'y applique pas non
        plus. 1 = tarif plein, 0 = exonéré."""
        if self.categorie_paiement == self.CategoriePaiement.FONDATION_GRATUIT:
            return Decimal("0")
        return Decimal("1")


class HistoriqueClasse(models.Model):
    """Classe d'un élève pour une année scolaire donnée — nécessaire car `EleveProfile.classe`
    ne garde que l'affectation ACTUELLE : sans cet historique, un bulletin ou un certificat émis
    pour une année passée afficherait la classe d'aujourd'hui plutôt que celle de l'époque (bug
    corrigé en introduisant ce modèle). Alimenté automatiquement (voir
    `enregistrer_historique_classe` ci-dessous) à la création d'un élève, à chaque réinscription
    et à tout changement manuel de classe — jamais à modifier à la main."""

    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="historique_classes")
    classe = models.ForeignKey(Classe, on_delete=models.CASCADE, related_name="historique_eleves")
    annee_scolaire = models.ForeignKey(AnneeScolaire, on_delete=models.CASCADE, related_name="historique_classes_eleves")

    class Meta:
        unique_together = ["eleve", "annee_scolaire"]
        ordering = ["-annee_scolaire__date_debut"]
        verbose_name = "Historique de classe"
        verbose_name_plural = "Historique de classe"

    def __str__(self):
        return f"{self.eleve} — {self.classe} ({self.annee_scolaire})"


def enregistrer_historique_classe(eleve, classe):
    """Enregistre/met à jour la classe de l'élève pour l'année scolaire de `classe` — à appeler
    partout où `EleveProfile.classe` est affecté (création, réinscription, modification manuelle
    depuis la fiche élève), jamais en écrivant directement sur `HistoriqueClasse`. Sans effet si
    `classe` est vide (élève retiré de toute classe : on ne veut pas perdre la dernière classe
    connue pour cette année dans l'historique)."""
    if not classe:
        return
    HistoriqueClasse.objects.update_or_create(
        eleve=eleve, annee_scolaire=classe.annee_scolaire, defaults={"classe": classe},
    )


class EnseignantProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="enseignant_profile",
        limit_choices_to={"role": "teacher"},
    )
    matricule = models.CharField(max_length=30, unique=True)
    specialite = models.CharField(max_length=100, blank=True)
    date_embauche = models.DateField(null=True, blank=True)
    diplome = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["user__last_name", "user__first_name"]
        verbose_name = "Profil enseignant"
        verbose_name_plural = "Profils enseignants"

    def __str__(self):
        return f"{self.user.get_full_name()} ({self.matricule})"


class EleveBadge(models.Model):
    eleve = models.OneToOneField(EleveProfile, on_delete=models.CASCADE, related_name="badge")
    qr_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    actif = models.BooleanField(default=True)
    emis_le = models.DateTimeField(auto_now_add=True)


class EnseignantBadge(models.Model):
    enseignant = models.OneToOneField(EnseignantProfile, on_delete=models.CASCADE, related_name="badge")
    qr_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    actif = models.BooleanField(default=True)
    emis_le = models.DateTimeField(auto_now_add=True)


class PointageEnseignant(models.Model):
    class Statut(models.TextChoices):
        PRESENT = "present", "Présent"
        ABSENT = "absent", "Absent"
        RETARD = "retard", "Retard"

    enseignant = models.ForeignKey(EnseignantProfile, on_delete=models.CASCADE, related_name="pointages")
    date = models.DateField()
    heure_arrivee = models.TimeField(null=True, blank=True)
    heure_depart = models.TimeField(null=True, blank=True)
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.PRESENT)
    commentaire = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-date"]
        constraints = [models.UniqueConstraint(fields=["enseignant", "date"], name="unique_pointage_enseignant_jour")]


class PaieEnseignant(models.Model):
    class ModeCalcul(models.TextChoices):
        FIXE = "fixe", "Salaire fixe"
        HORAIRE = "horaire", "Taux horaire"

    enseignant = models.ForeignKey(EnseignantProfile, on_delete=models.CASCADE, related_name="paies")
    mois = models.DateField(help_text="Premier jour du mois concerné")
    mode_calcul = models.CharField(max_length=10, choices=ModeCalcul.choices, default=ModeCalcul.FIXE)
    salaire_base = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Utilisé si mode de calcul = salaire fixe",
    )
    nombre_heures = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        help_text="Nombre d'heures enseignées dans le mois (mode taux horaire)",
    )
    taux_horaire = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Montant payé par heure enseignée (mode taux horaire)",
    )
    primes = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    retenues = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payee = models.BooleanField(default=False)
    date_paiement = models.DateField(null=True, blank=True)
    commentaire = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-mois"]
        constraints = [models.UniqueConstraint(fields=["enseignant", "mois"], name="unique_paie_enseignant_mois")]

    @property
    def salaire_calcule(self):
        """Le salaire de base effectif : au taux horaire si ce mode est choisi, sinon le fixe."""
        if self.mode_calcul == self.ModeCalcul.HORAIRE and self.nombre_heures and self.taux_horaire:
            return self.nombre_heures * self.taux_horaire
        return self.salaire_base

    @property
    def net_a_payer(self):
        return self.salaire_calcule + self.primes - self.retenues


class GroupeRevision(models.Model):
    enseignant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="groupes_revision")
    nom = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    matiere = models.ForeignKey("academics.Matiere", on_delete=models.SET_NULL, null=True, blank=True)
    classe = models.ForeignKey("academics.Classe", on_delete=models.SET_NULL, null=True, blank=True)
    eleves = models.ManyToManyField(EleveProfile, blank=True, related_name="groupes_revision")
    lien = models.URLField(blank=True)
    actif = models.BooleanField(default=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-cree_le"]


class MessageIA(models.Model):
    """Historique de la discussion entre un élève et l'assistant IA de révision. Tant qu'aucune
    clé API n'est configurée côté serveur, les réponses sont simulées (voir grades/ia.py) —
    le format du stockage ne change pas quand une vraie IA est branchée."""

    class Role(models.TextChoices):
        USER = "user", "Élève"
        ASSISTANT = "assistant", "Assistant"

    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="messages_ia")
    role = models.CharField(max_length=10, choices=Role.choices)
    contenu = models.TextField()
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["cree_le"]
        verbose_name = "Message assistant IA"
        verbose_name_plural = "Messages assistant IA"


class AlerteParent(models.Model):
    parent = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="alertes_scolarite")
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="alertes_parent")
    type = models.CharField(max_length=40, default="absence_hebdomadaire")
    message = models.CharField(max_length=320)
    sms_envoye = models.BooleanField(default=False)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-cree_le"]
