from datetime import date, time
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils.text import slugify


class PlanAbonnement(models.Model):
    """Tarif réutilisable proposé par la plateforme (ex: « Standard » à 500 000 GNF/mois).
    Un établissement peut s'y référer pour préremplir son propre montant d'abonnement, mais
    reste libre de le personnaliser ensuite : `Ecole.abonnement_mensuel` demeure la source de
    vérité utilisée pour la facturation, ce champ n'est donc jamais lu par `statut_abonnement`."""

    class Periodicite(models.TextChoices):
        MENSUEL = "mensuel", "Mensuel"
        TRIMESTRIEL = "trimestriel", "Trimestriel"
        ANNUEL = "annuel", "Annuel"

    nom = models.CharField(max_length=100)
    montant = models.DecimalField(max_digits=10, decimal_places=2)
    periodicite = models.CharField(max_length=15, choices=Periodicite.choices, default=Periodicite.MENSUEL)
    description = models.CharField(max_length=255, blank=True)
    limite_eleves = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Nombre maximal d'élèves actifs inclus dans ce plan — vide = illimité",
    )
    limite_enseignants = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Nombre maximal d'enseignants inclus dans ce plan — vide = illimité",
    )
    limite_administrateurs = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Nombre maximal de comptes administrateur inclus dans ce plan — vide = illimité",
    )
    actif = models.BooleanField(default=True)

    class Meta:
        ordering = ["montant"]
        verbose_name = "Plan d'abonnement"
        verbose_name_plural = "Plans d'abonnement"

    def __str__(self):
        return f"{self.nom} ({self.get_periodicite_display()})"


class Ecole(models.Model):
    """Un établissement (tenant) de la plateforme. Toutes les données scolaires d'une
    école lui sont rattachées, directement ou via la chaîne de relations."""

    class TypeEtablissement(models.TextChoices):
        PRIMAIRE = "primaire", "Primaire"
        COLLEGE = "college", "Collège"
        LYCEE = "lycee", "Lycée"
        UNIVERSITE = "universite", "Université"
        PRIVE = "prive", "Établissement privé"
        PUBLIC = "public", "Établissement public"

    nom = models.CharField(max_length=200)
    slug = models.SlugField(max_length=60, unique=True, blank=True)
    adresse = models.CharField(max_length=255, blank=True)
    ville = models.CharField(max_length=100, blank=True)
    pays = models.CharField(max_length=100, blank=True, default="Guinée")
    telephone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    logo = models.ImageField(upload_to="ecoles/logos/", blank=True, null=True)
    directeur_nom = models.CharField(
        max_length=150, blank=True,
        help_text="Nom du directeur/responsable de l'établissement (informatif — distinct du compte administrateur)",
    )
    # Codes de la hiérarchie administrative de l'Éducation nationale guinéenne, affichés en
    # en-tête du bulletin au format « Officiel » (voir Ecole.ModeleDocument.OFFICIEL) — modifiables
    # par l'admin de l'école lui-même (comme adresse/téléphone), pas seulement le Super Admin.
    ire = models.CharField("IRE", max_length=100, blank=True, help_text="Inspection Régionale de l'Éducation")
    dpe = models.CharField("DPE", max_length=100, blank=True, help_text="Direction Préfectorale de l'Éducation")
    dsee = models.CharField("DSEE", max_length=100, blank=True, help_text="Direction Sous-préfectorale de l'Enseignement Élémentaire")
    # Libellés institutionnels affichés au-dessus des codes IRE/DPE/DSEE et à côté du drapeau
    # sur le bulletin « Officiel » — préremplis avec les intitulés guinéens usuels mais modifiables
    # par l'admin de l'école (utile si le libellé exact du ministère change, ou pour un autre pays).
    entete_ministere_1 = models.CharField(
        max_length=150, blank=True, default="Ministère de l'Éducation Nationale",
        help_text="Première ligne de l'en-tête institutionnel du bulletin",
    )
    entete_ministere_2 = models.CharField(
        max_length=150, blank=True, default="Ministère de l'Enseignement Pré-Universitaire",
        help_text="Seconde ligne de l'en-tête institutionnel du bulletin (laisser vide pour la masquer)",
    )
    entete_republique = models.CharField(
        max_length=100, blank=True, default="République de Guinée",
        help_text="Nom du pays affiché en en-tête du bulletin",
    )
    entete_devise = models.CharField(
        max_length=100, blank=True, default="Travail - Justice - Solidarité",
        help_text="Devise nationale affichée en en-tête du bulletin (segments séparés par « - »)",
    )
    type_etablissement = models.CharField(max_length=20, choices=TypeEtablissement.choices, blank=True)

    plan = models.ForeignKey(
        PlanAbonnement, on_delete=models.SET_NULL, null=True, blank=True, related_name="ecoles",
        help_text="Plan tarifaire de référence (informatif — n'affecte pas la facturation)",
    )
    abonnement_mensuel = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    jour_echeance = models.PositiveSmallIntegerField(
        default=5, help_text="Jour du mois avant lequel le paiement du mois est dû"
    )
    jours_grace = models.PositiveSmallIntegerField(
        default=5, help_text="Nombre de jours de tolérance après l'échéance avant blocage de l'accès"
    )
    actif = models.BooleanField(
        default=True, help_text="Désactivation manuelle par le Super Admin, indépendante du statut de paiement"
    )
    date_creation = models.DateField(auto_now_add=True)

    # Personnalisation des documents PDF (bulletins, badges, reçus/fiches de paie) de cette
    # école, réglée par le Super Admin (EcoleDetailPage) — lue par les templates via
    # `ecole.couleur_principale` / `ecole.couleur_secondaire` à la place des couleurs
    # navy/gold codées en dur d'origine. Format hexadécimal (#rrggbb).
    couleur_principale = models.CharField(max_length=7, default="#14304f")
    couleur_secondaire = models.CharField(max_length=7, default="#b8860b")

    class ModeleDocument(models.IntegerChoices):
        CLASSIQUE = 1, "Classique"
        MODERNE = 2, "Moderne"
        ELEGANT = 3, "Élégant"
        COMPACT = 4, "Compact"
        # Réservé au bulletin (voir bulletin_pdf.html) : reproduit le format papier officiel
        # utilisé par certains établissements guinéens (IRE/DPE/DSEE en en-tête, tableau
        # SEM1/SEM2, bandeau « RESULTAT DE FIN D'ANNEES »). Techniquement sélectionnable pour
        # les 3 autres documents (mêmes choix partagés), qui n'ont simplement pas de branche
        # dédiée pour cette valeur et retombent alors sur leur rendu Classique.
        OFFICIEL = 5, "Officiel (IRE/DPE)"

    # Modèle de mise en page choisi par le Super Admin, indépendamment pour chacun de ces
    # documents (EcoleDetailPage, onglet Personnalisation) — lu par le template PDF concerné
    # via une variable `modele` (voir les blocs `{% if modele == ... %}` dans chaque gabarit).
    modele_recu = models.PositiveSmallIntegerField(choices=ModeleDocument.choices, default=ModeleDocument.CLASSIQUE)
    modele_badge = models.PositiveSmallIntegerField(choices=ModeleDocument.choices, default=ModeleDocument.CLASSIQUE)
    # Bulletin : "Officiel" par défaut (et non "Classique" comme les autres documents) — c'est le
    # format papier concrètement utilisé par l'établissement (voir migration 0019, qui bascule
    # aussi toutes les écoles déjà créées dessus).
    modele_bulletin = models.PositiveSmallIntegerField(choices=ModeleDocument.choices, default=ModeleDocument.OFFICIEL)
    modele_fiche_inscription = models.PositiveSmallIntegerField(
        choices=ModeleDocument.choices, default=ModeleDocument.CLASSIQUE
    )
    modele_certificat = models.PositiveSmallIntegerField(choices=ModeleDocument.choices, default=ModeleDocument.CLASSIQUE)

    # Fonctionnalités optionnelles désactivées par le Super Admin pour cette école (liste de
    # clés parmi `tenants.features.FONCTIONNALITES`) — voir `a_fonctionnalite()` ci-dessous et
    # `tenants.permissions.fonctionnalite_requise` pour l'application côté API.
    fonctionnalites_desactivees = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["nom"]
        verbose_name = "École"
        verbose_name_plural = "Écoles"

    def __str__(self):
        return self.nom

    def a_fonctionnalite(self, cle: str) -> bool:
        return cle not in (self.fonctionnalites_desactivees or [])

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.nom)[:50] or "ecole"
            slug, i = base, 1
            while Ecole.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                i += 1
                slug = f"{base}-{i}"
            self.slug = slug
        super().save(*args, **kwargs)

    def paiement_du_mois(self, mois: date | None = None):
        mois = (mois or date.today()).replace(day=1)
        return self.paiements.filter(mois=mois).first()

    @property
    def duree_periode_mois(self) -> int:
        """Nombre de mois couverts par UN paiement d'abonnement — dérivé de la périodicité du
        plan lié (voir `PlanAbonnement.periodicite`) : 1 pour Mensuel, 3 pour Trimestriel, 12
        pour Annuel. Par défaut Mensuel (1) si aucun plan n'est lié (`Ecole.plan` reste par
        ailleurs purement informatif pour le tarif, voir sa docstring — c'est le seul endroit où
        sa périodicité a un effet réel, sur le compte à rebours de l'abonnement)."""
        if self.plan_id and self.plan.periodicite == PlanAbonnement.Periodicite.TRIMESTRIEL:
            return 3
        if self.plan_id and self.plan.periodicite == PlanAbonnement.Periodicite.ANNUEL:
            return 12
        return 1

    @property
    def periodicite_abonnement_display(self) -> str:
        """Libellé de la périodicité effectivement appliquée au compte à rebours (voir
        `duree_periode_mois`) — toujours définie, même sans plan lié (« Mensuel » par défaut)."""
        return {1: "Mensuel", 3: "Trimestriel", 12: "Annuel"}[self.duree_periode_mois]

    def _mois_echeance_courante(self) -> date:
        """Premier jour du mois où le PROCHAIN paiement devient dû. Généralise le « mois en
        cours » vérifié par le système d'origine (toujours mensuel, un paiement attendu chaque
        mois) à une fenêtre de 1/3/12 mois selon `duree_periode_mois` : un paiement enregistré
        avec `mois=M` couvre M, M+1, ..., M+(N-1) — le mois suivant, M+N, est celui où
        l'échéance suivante tombe. Sans aucun paiement enregistré (école neuve), retombe sur le
        mois en cours — identique au comportement historique dans ce cas précis."""
        dernier = self.paiements.order_by("-mois").first()
        if not dernier:
            return date.today().replace(day=1)
        mois_index = dernier.mois.month - 1 + self.duree_periode_mois  # 0-indexé, pour l'arithmétique modulo 12
        return date(dernier.mois.year + mois_index // 12, mois_index % 12 + 1, 1)

    def _date_echeance_courante(self) -> date:
        """Date calendaire exacte de la prochaine échéance : le jour `jour_echeance` du mois
        renvoyé par `_mois_echeance_courante`."""
        return self._mois_echeance_courante().replace(day=min(self.jour_echeance, 28))

    @property
    def statut_abonnement(self) -> str:
        """'suspendu' | 'paye' | 'en_attente' | 'en_retard' | 'bloque'."""
        if not self.actif:
            return "suspendu"
        today = date.today()
        mois_echeance = self._mois_echeance_courante()
        if today < mois_echeance:
            # Encore dans un mois entièrement couvert par le dernier paiement — à jour, quelle
            # que soit la périodicité (1/3/12 mois).
            return "paye"
        date_echeance = mois_echeance.replace(day=min(self.jour_echeance, 28))
        if today <= date_echeance:
            return "en_attente"
        jours_retard = (today - date_echeance).days
        if jours_retard <= self.jours_grace:
            return "en_retard"
        return "bloque"

    @property
    def peut_se_connecter(self) -> bool:
        return self.statut_abonnement in ("paye", "en_attente", "en_retard")

    @property
    def jours_avant_blocage(self) -> int | None:
        """Nombre de jours restants avant le blocage automatique de l'accès — utile pour
        que le Super Admin relance les écoles en retard avant qu'elles ne soient bloquées.
        None si l'école n'est pas en situation de retard (à jour, bloquée ou suspendue)."""
        if self.statut_abonnement != "en_retard":
            return None
        jours_retard = (date.today() - self._date_echeance_courante()).days
        return max(self.jours_grace - jours_retard, 0)

    @property
    def jours_avant_echeance(self) -> int | None:
        """Jours restants avant l'échéance de paiement de la période en cours — permet à
        l'admin de l'école de voir le compte à rebours se décrémenter avant d'être en retard.
        None si la période est déjà payée d'avance, ou si l'échéance est déjà dépassée (voir
        alors `jours_avant_blocage`)."""
        if self.statut_abonnement != "en_attente":
            return None
        return (self._date_echeance_courante() - date.today()).days

    @property
    def jours_avant_prochaine_echeance(self) -> int | None:
        """Jours restants avant la PROCHAINE échéance, quel que soit le statut actuel —
        contrairement à `jours_avant_echeance` (qui vaut `None` dès que la période est déjà
        payée d'avance), c'est cette valeur qu'affiche le compte à rebours principal vu par
        l'administrateur de l'école ET par le Super Admin (voir `AbonnementBadge` côté
        frontend, EcolesPage/EcoleDetailPage) : pour un plan Trimestriel/Annuel payé d'avance,
        il doit pouvoir dépasser 30 jours (jusqu'à ~90/365) plutôt que d'être plafonné à un mois
        comme avant l'introduction de la périodicité. `None` uniquement si le compte est déjà
        bloqué ou suspendu (l'échéance est alors dépassée, un décompte n'a plus de sens)."""
        if self.statut_abonnement in ("bloque", "suspendu"):
            return None
        return (self._date_echeance_courante() - date.today()).days


class PaiementEcole(models.Model):
    class ModePaiement(models.TextChoices):
        ESPECES = "especes", "Espèces"
        VIREMENT = "virement", "Virement"
        MOBILE_MONEY = "mobile_money", "Mobile Money (autre)"
        ORANGE_MONEY = "orange_money", "Orange Money"
        MTN_MONEY = "mtn_money", "MTN Mobile Money"
        MOOV_MONEY = "moov_money", "Moov Money"
        CARTE_BANCAIRE = "carte_bancaire", "Carte bancaire"
        CHEQUE = "cheque", "Chèque"

    ecole = models.ForeignKey(Ecole, on_delete=models.CASCADE, related_name="paiements")
    mois = models.DateField(help_text="Premier jour du mois couvert par ce paiement")
    montant = models.DecimalField(max_digits=10, decimal_places=2)
    date_paiement = models.DateField(auto_now_add=True)
    mode_paiement = models.CharField(max_length=20, choices=ModePaiement.choices, default=ModePaiement.VIREMENT)
    reference = models.CharField(max_length=100, blank=True)
    # Attribué une fois à l'enregistrement (voir save()) puis figé — la facture doit garder
    # le même numéro même si l'année de `mois` ne correspond plus à l'année en cours.
    numero_facture = models.CharField(max_length=30, blank=True, unique=True)
    enregistre_par = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="paiements_ecoles_enregistres"
    )

    class Meta:
        ordering = ["-mois"]
        unique_together = ["ecole", "mois"]
        verbose_name = "Paiement d'abonnement"
        verbose_name_plural = "Paiements d'abonnement"

    def save(self, *args, **kwargs):
        if self.mois:
            self.mois = self.mois.replace(day=1)
        super().save(*args, **kwargs)
        if not self.numero_facture:
            # Le numéro dépend du pk : on ne peut le générer qu'après le premier INSERT.
            self.numero_facture = f"INV-{self.mois.year}-{self.pk:06d}"
            super().save(update_fields=["numero_facture"])

    def __str__(self):
        return f"{self.ecole} — {self.mois:%m/%Y}"


class TransactionAbonnement(models.Model):
    """Paiement d'abonnement initié en ligne par l'Administrateur d'une école via la
    passerelle Mobile Money Djomy (voir `djomy.services`) — distinct de `PaiementEcole`, qui
    reste réservé aux paiements CONFIRMÉS. Une transaction n'aboutit à un `PaiementEcole` que
    lorsque Djomy confirme le statut « réussi » (voir `tenants.views.VerifierPaiementDjomyView`) :
    tant qu'elle est en attente ou a échoué, elle n'affecte jamais `Ecole.statut_abonnement`."""

    class Statut(models.TextChoices):
        EN_ATTENTE = "en_attente", "En attente"
        REUSSI = "reussi", "Réussi"
        ECHOUE = "echoue", "Échoué"

    ecole = models.ForeignKey(Ecole, on_delete=models.CASCADE, related_name="transactions_djomy")
    mois = models.DateField(help_text="Premier jour du mois que ce paiement doit couvrir")
    montant = models.DecimalField(max_digits=10, decimal_places=2)
    nb_mois = models.PositiveSmallIntegerField(
        default=1, help_text="Nombre de mois couverts par ce paiement — 1 (Mensuel) ou 12 (Annuel), choisi par l'Administrateur au moment de payer"
    )
    payer_number = models.CharField(max_length=30)
    transaction_id = models.CharField(max_length=100, unique=True)
    redirect_url = models.URLField(blank=True)
    statut = models.CharField(max_length=15, choices=Statut.choices, default=Statut.EN_ATTENTE)
    cree_le = models.DateTimeField(auto_now_add=True)
    verifie_le = models.DateTimeField(null=True, blank=True)
    paiement = models.OneToOneField(
        "PaiementEcole", on_delete=models.SET_NULL, null=True, blank=True, related_name="transaction_djomy"
    )

    class Meta:
        ordering = ["-cree_le"]
        verbose_name = "Transaction Djomy"
        verbose_name_plural = "Transactions Djomy"

    def __str__(self):
        return f"{self.ecole} — {self.transaction_id} ({self.statut})"


class ParametresEcole(models.Model):
    """Paramètres pédagogiques et d'affichage propres à un établissement, réglables par
    son propre Administrateur (contrairement aux champs d'abonnement de `Ecole`, réservés
    au Super Admin de la plateforme)."""

    ecole = models.OneToOneField(Ecole, on_delete=models.CASCADE, related_name="parametres")

    devise = models.CharField(max_length=10, default="GNF")
    bareme_notation = models.PositiveSmallIntegerField(
        default=20, help_text="Note maximale utilisée pour la saisie des notes (ex: /20)"
    )
    moyenne_admission = models.DecimalField(
        max_digits=4, decimal_places=2, default=Decimal("10.00"),
        help_text="Moyenne minimale requise pour le passage en classe supérieure",
    )
    heure_limite_ponctualite = models.TimeField(
        default=time(8, 15), help_text="Heure au-delà de laquelle un pointage est considéré en retard"
    )
    message_bienvenue = models.CharField(
        max_length=300, blank=True, help_text="Message affiché sur le portail (accueil élèves/parents)"
    )
    reglement_interieur = models.TextField(blank=True)

    class Meta:
        verbose_name = "Paramètres de l'école"
        verbose_name_plural = "Paramètres des écoles"

    def __str__(self):
        return f"Paramètres — {self.ecole.nom}"


class ModeleMessage(models.Model):
    """Texte personnalisable par l'admin d'une école pour un type de notification donné (voir
    `tenants.messages_templates.MODELES_MESSAGE` pour la liste des clés, leurs jetons
    disponibles et leur texte par défaut) — remplace le message codé en dur envoyé par
    e-mail/SMS pour cet évènement. Un seul enregistrement par (école, clé) : voir
    `tenants.messages_templates.rendre_modele` pour la résolution + substitution des jetons."""

    ecole = models.ForeignKey(Ecole, on_delete=models.CASCADE, related_name="modeles_message")
    cle = models.CharField(max_length=30)
    sujet = models.CharField(max_length=200, blank=True, help_text="Objet de l'e-mail (le SMS n'a pas d'objet)")
    contenu = models.TextField(help_text="Texte envoyé — utilisez les jetons entre accolades proposés pour ce type")

    class Meta:
        unique_together = ["ecole", "cle"]
        verbose_name = "Modèle de message"
        verbose_name_plural = "Modèles de message"

    def __str__(self):
        return f"{self.cle} — {self.ecole.nom}"


class ParametresPlateforme(models.Model):
    """Réglages globaux de la plateforme, éditables uniquement par le Super Admin
    (section « Paramètres plateforme »). Singleton : une seule ligne (pk=1), chargée via
    `ParametresPlateforme.charger()`. Les secrets (mot de passe SMTP, clé API SMS...)
    restent dans les variables d'environnement du serveur — jamais en base, pour éviter
    qu'ils ne transitent par une API lisible même en lecture seule."""

    nom_plateforme = models.CharField(max_length=100, default="Taly-School")
    logo = models.ImageField(upload_to="plateforme/", blank=True, null=True)

    email_expediteur_nom = models.CharField(
        max_length=100, default="Taly-School",
        help_text="Nom affiché comme expéditeur des e-mails automatiques (le compte SMTP reste celui du .env)",
    )
    support_email = models.EmailField(blank=True, help_text="Adresse affichée aux écoles pour le support")
    support_telephone = models.CharField(max_length=30, blank=True)

    sms_actif = models.BooleanField(
        default=True, help_text="Coupe-circuit global : désactive l'envoi de SMS sur toute la plateforme"
    )

    maintenance_active = models.BooleanField(
        default=False,
        help_text="Bloque l'accès à l'application pour tout le monde sauf le Super Admin",
    )
    maintenance_message = models.CharField(
        max_length=255, blank=True,
        default="La plateforme est en maintenance. Merci de réessayer dans quelques instants.",
    )

    # Clé de cache de charger() ci-dessous.
    CACHE_KEY = "parametres_plateforme"

    class Meta:
        verbose_name = "Paramètres de la plateforme"
        verbose_name_plural = "Paramètres de la plateforme"

    def __str__(self):
        return "Paramètres de la plateforme"

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton
        super().save(*args, **kwargs)
        cache.delete(self.CACHE_KEY)

    @classmethod
    def charger(cls) -> "ParametresPlateforme":
        """Mis en cache (voir CACHES dans settings.py) : `PlateformeJWTAuthentication` appelle
        cette méthode sur QUASI CHAQUE requête authentifiée de la plateforme, juste pour lire
        `maintenance_active` — sans cache, ce serait une requête DB systématique rien que pour
        ça, sur l'endpoint le plus chaud de toute l'API. Invalidé par save() ci-dessus dès que
        le Super Admin modifie ces réglages (rare) ; le timeout est un filet de sécurité si
        l'invalidation était un jour contournée (ex: mise à jour en base hors de save())."""
        instance = cache.get(cls.CACHE_KEY)
        if instance is None:
            instance, _ = cls.objects.get_or_create(pk=1)
            cache.set(cls.CACHE_KEY, instance, timeout=300)
        return instance


@receiver(post_save, sender=Ecole)
def creer_parametres_ecole(sender, instance, created, **kwargs):
    """Chaque école dispose automatiquement d'une fiche de paramètres, créée avec des
    valeurs par défaut dès la création de l'établissement."""
    if created:
        ParametresEcole.objects.get_or_create(ecole=instance)


class JournalActivite(models.Model):
    """Journal des actions du Super Admin sur la plateforme (création/suspension d'école,
    encaissement...) — traçabilité pour la gouvernance multi-écoles."""

    class Action(models.TextChoices):
        ECOLE_CREEE = "ecole_creee", "École créée"
        ECOLE_MODIFIEE = "ecole_modifiee", "École modifiée"
        ECOLE_SUSPENDUE = "ecole_suspendue", "École suspendue"
        ECOLE_REACTIVEE = "ecole_reactivee", "École réactivée"
        PAIEMENT_ENREGISTRE = "paiement_enregistre", "Paiement enregistré"
        RELANCE_ENVOYEE = "relance_envoyee", "Relance envoyée"
        SUPERADMIN_CREE = "superadmin_cree", "Compte Super Admin créé"
        ECOLE_SUPPRIMEE = "ecole_supprimee", "École supprimée définitivement"
        CONNEXION_SUPPORT = "connexion_support", "Connexion en mode support"
        MOT_DE_PASSE_REINITIALISE = "mot_de_passe_reinitialise", "Mot de passe réinitialisé"

    horodatage = models.DateTimeField(auto_now_add=True)
    acteur = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="actions_journalisees"
    )
    action = models.CharField(max_length=30, choices=Action.choices)
    # SET_NULL (et non CASCADE) : la suppression d'une école ne doit jamais effacer la trace de
    # cette suppression elle-même, ni son historique — le nom reste dans `details`.
    ecole = models.ForeignKey(Ecole, on_delete=models.SET_NULL, null=True, related_name="journal")
    details = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-horodatage"]
        verbose_name = "Entrée du journal d'activité"
        verbose_name_plural = "Journal d'activité"

    def __str__(self):
        return f"{self.get_action_display()} — {self.ecole} ({self.horodatage:%d/%m/%Y %H:%M})"
