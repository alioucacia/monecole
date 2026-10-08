from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Utilisateur unique pour tous les rôles de l'école."""

    class Role(models.TextChoices):
        SUPERADMIN = "superadmin", "Super Administrateur"
        ADMIN = "admin", "Administrateur"
        # Rôle de supervision pure, créé PAR un Administrateur (voir UserCreateSerializer) : accès
        # en LECTURE SEULE à l'ensemble de son école (comme un Administrateur y voit tout), mais
        # ne peut jamais créer/modifier/supprimer quoi que ce soit — voir
        # accounts.permissions._lecture_seule_directeur, appliqué aux permissions partagées avec
        # l'Administrateur (IsAdmin, IsAdminOrTeacher, IsAdminOrComptabilite, IsAdminOrSurveillance).
        DIRECTEUR = "directeur", "Directeur Général"
        TEACHER = "teacher", "Enseignant"
        STUDENT = "student", "Élève"
        PARENT = "parent", "Parent"
        COMPTABILITE = "comptabilite", "Comptabilité"
        SURVEILLANCE = "surveillance", "Surveillance Générale"

    class Sexe(models.TextChoices):
        MASCULIN = "M", "Masculin"
        FEMININ = "F", "Féminin"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STUDENT)
    sexe = models.CharField(max_length=1, choices=Sexe.choices, blank=True)
    ecole = models.ForeignKey(
        "tenants.Ecole", on_delete=models.CASCADE, null=True, blank=True, related_name="users",
        help_text="Établissement auquel appartient ce compte. Vide uniquement pour le Super Admin.",
    )
    # Ni l'e-mail ni le téléphone ne sont marqués unique=True en base : de nombreux comptes
    # existants ont ces champs vides (une contrainte unique refuserait plusieurs valeurs
    # vides sous SQLite/Postgres). L'unicité des valeurs non vides est donc appliquée au
    # niveau des serializers (voir validate_email / validate_phone) — l'e-mail et le
    # téléphone servent tous deux à se connecter (voir accounts.backends.MultiFieldAuthBackend),
    # une connexion ambiguë ferait simplement échouer l'authentification.
    phone = models.CharField(max_length=20, blank=True)
    address = models.CharField(max_length=255, blank=True)
    photo = models.ImageField(upload_to="avatars/", blank=True, null=True)
    date_of_birth = models.DateField(null=True, blank=True)
    doit_changer_mot_de_passe = models.BooleanField(
        default=False,
        help_text="Force le changement de mot de passe à la prochaine connexion — "
                   "activé à la création du compte ou après une réinitialisation par un administrateur.",
    )
    # Session unique (actuellement appliqué au seul rôle admin — voir CustomTokenObtainPairSerializer
    # et PlateformeJWTAuthentication) : régénéré à chaque connexion et embarqué comme revendication
    # dans le jeton JWT. Un jeton dont la revendication ne correspond plus à cette valeur (parce
    # qu'une connexion plus récente a eu lieu ailleurs, régénérant ce champ) est rejeté — un admin
    # ne peut donc jamais avoir deux sessions valides en même temps, la plus récente invalide
    # automatiquement toute session précédente.
    session_id = models.CharField(max_length=64, blank=True, editable=False)
    # Mise à jour à chaque requête authentifiée (voir PlateformeJWTAuthentication), au plus
    # une fois toutes les DELAI_MAJ_ACTIVITE minutes pour ne pas écrire en base à chaque appel
    # API — sert à estimer qui est "en ligne" (voir `en_ligne` ci-dessous) sans infrastructure
    # temps réel (websockets, présence...), qu'aucune autre partie du projet n'a.
    derniere_activite = models.DateTimeField(null=True, blank=True, editable=False)

    # Double authentification (OTP par e-mail/SMS) — opt-in, réglé par l'utilisateur lui-même
    # depuis son profil (jamais imposé d'office : de nombreux comptes, en particulier élèves,
    # n'ont ni e-mail ni téléphone renseigné, ce qui rendrait un 2FA obligatoire bloquant pour
    # eux). Quand activé, `CustomTokenObtainPairSerializer.validate()` ne délivre plus de jeton
    # directement après le mot de passe : un code à usage unique doit d'abord être vérifié
    # (voir accounts.models.CodeOTP / accounts.services.generer_otp/verifier_otp).
    otp_actif = models.BooleanField(
        default=False,
        help_text="Double authentification (code à usage unique par e-mail/SMS) à chaque connexion.",
    )
    # Vérification ponctuelle de l'adresse/du numéro (pas liée au 2FA ci-dessus) : confirme que
    # la valeur saisie appartient bien à la personne — voir CodeOTP.Objectif.VERIFICATION.
    email_verifie = models.BooleanField(default=False)
    telephone_verifie = models.BooleanField(default=False)

    # Code secret de suppression définitive — concerne uniquement le Super Admin (voir
    # tenants.views.EcoleViewSet.destroy) : exigé en plus de la confirmation habituelle (taper le
    # nom de l'école) avant de supprimer TOUTES les données d'un établissement, pour qu'une simple
    # session ouverte/volée ne suffise pas à déclencher cette action irréversible. Haché comme un
    # mot de passe (voir accounts.services.definir_code_suppression/verifier_code_suppression) —
    # jamais stocké ni renvoyé en clair. Vide tant que le Super Admin ne l'a pas défini lui-même
    # depuis son profil ; la suppression d'école reste alors bloquée (voir la vue), plutôt que de
    # l'autoriser sans ce filet de sécurité simplement parce qu'il n'a rien configuré.
    code_suppression = models.CharField(max_length=128, blank=True, editable=False)

    # Compte élève dont l'accès à la plateforme a été supprimé par l'administrateur de l'école
    # (voir UserViewSet.perform_destroy/supprimer_comptes) : le dossier scolaire (fiche, notes,
    # paiements) est CONSERVÉ — il dépend de ce compte, qui porte le nom de l'élève — mais le
    # compte est désactivé, son mot de passe invalidé, et il n'apparaît plus dans la liste des
    # comptes. Un nouveau mot de passe (« Réinitialiser le mot de passe ») lui rend l'accès.
    acces_supprime = models.BooleanField(default=False)

    # Sécurité avancée du Super Admin (voir accounts/securite.py) — sans objet pour les autres
    # rôles. Application d'authentification (TOTP, RFC 6238) : `totp_secret` est rempli dès
    # l'initialisation (QR code affiché), mais n'est exigé à la connexion qu'une fois
    # `totp_actif` confirmé par un premier code valide — un secret scanné à moitié ne doit jamais
    # pouvoir bloquer le compte. `totp_dernier_pas` empêche de rejouer un code déjà utilisé
    # pendant sa fenêtre de validité (30 s).
    totp_secret = models.CharField(max_length=64, blank=True, editable=False)
    totp_actif = models.BooleanField(default=False)
    totp_dernier_pas = models.BigIntegerField(null=True, blank=True, editable=False)
    # Codes de secours à usage unique (empreintes HMAC, jamais en clair) — permettent de se
    # connecter si le téléphone portant l'application d'authentification est perdu.
    codes_secours = models.JSONField(default=list, blank=True, editable=False)
    # Verrouillage temporaire après trop d'échecs de connexion (voir
    # securite.enregistrer_echec_connexion) — le mot de passe n'est même plus vérifié tant que
    # cette date n'est pas passée.
    verrouille_jusqu_a = models.DateTimeField(null=True, blank=True, editable=False)

    # Une session est considérée active si une requête authentifiée a eu lieu dans ce délai —
    # au-delà, l'utilisateur est considéré hors ligne même si son jeton reste valide (JWT
    # stateless : rien ne prévient le serveur d'une fermeture d'onglet/déconnexion réseau).
    DELAI_EN_LIGNE_MINUTES = 5

    class Meta:
        ordering = ["last_name", "first_name"]

    def __str__(self):
        full_name = self.get_full_name() or self.username
        return f"{full_name} ({self.get_role_display()})"

    @property
    def is_superadmin_role(self):
        return self.role == self.Role.SUPERADMIN

    @property
    def en_ligne(self) -> bool:
        if not self.derniere_activite:
            return False
        from django.utils import timezone
        return timezone.now() - self.derniere_activite < timezone.timedelta(minutes=self.DELAI_EN_LIGNE_MINUTES)

    @property
    def is_admin_role(self):
        return self.role == self.Role.ADMIN

    @property
    def is_directeur_role(self):
        return self.role == self.Role.DIRECTEUR

    @property
    def is_teacher_role(self):
        return self.role == self.Role.TEACHER

    @property
    def is_student_role(self):
        return self.role == self.Role.STUDENT

    @property
    def is_parent_role(self):
        return self.role == self.Role.PARENT

    @property
    def is_comptabilite_role(self):
        return self.role == self.Role.COMPTABILITE

    @property
    def is_surveillance_role(self):
        return self.role == self.Role.SURVEILLANCE


class CodeOTP(models.Model):
    """Code à usage unique (6 chiffres), envoyé par e-mail et/ou SMS — trois usages distincts
    (voir `Objectif`), tous gérés par les mêmes fonctions `accounts.services.generer_otp` /
    `verifier_otp` : double authentification à la connexion, vérification lors de la
    réinitialisation de mot de passe, et vérification ponctuelle d'un e-mail/téléphone.

    Toujours rattaché à un `User` déjà identifié (par mot de passe correct, ou par e-mail lors
    d'une demande de réinitialisation) — il n'existe aucun flux d'auto-inscription dans cette
    application (tous les comptes sont créés par un administrateur), donc pas besoin de générer
    un OTP pour un e-mail qui ne correspond encore à personne."""

    class Objectif(models.TextChoices):
        CONNEXION = "connexion", "Double authentification à la connexion"
        REINITIALISATION = "reinitialisation", "Réinitialisation de mot de passe"
        VERIFICATION = "verification", "Vérification d'e-mail/téléphone"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="codes_otp")
    code = models.CharField(max_length=6)
    objectif = models.CharField(max_length=20, choices=Objectif.choices)
    # Ce que ce code vérifie concrètement pour VERIFICATION (l'e-mail ou le téléphone au moment
    # de l'envoi) — sans objet pour les deux autres `objectif`, où c'est toujours `user` lui-même
    # qui s'authentifie/se réinitialise.
    cible = models.CharField(max_length=255, blank=True)
    expire_le = models.DateTimeField()
    utilise = models.BooleanField(default=False)
    # Nombre de tentatives de saisie ratées — au-delà de `MAX_TENTATIVES`, le code est rejeté
    # même s'il est correct (protège contre un essai par force brute des 10⁶ codes possibles
    # depuis un même code encore valide, sans devoir bloquer tout le compte).
    tentatives = models.PositiveSmallIntegerField(default=0)
    cree_le = models.DateTimeField(auto_now_add=True)

    MAX_TENTATIVES = 5

    class Meta:
        ordering = ["-cree_le"]
        indexes = [models.Index(fields=["user", "objectif", "utilise"])]

    def __str__(self):
        return f"OTP {self.get_objectif_display()} — {self.user} ({'utilisé' if self.utilise else 'en attente'})"

    @property
    def expire(self) -> bool:
        from django.utils import timezone
        return timezone.now() >= self.expire_le


class JournalUtilisateur(models.Model):
    """Historique d'activité d'un compte, consultable par l'Administrateur de son école
    (ComptesEcolePage, action « Historique ») — connexions et actions clés (créations/
    modifications/suppressions d'éléments importants : élèves, enseignants, notes, paiements,
    gestion du compte lui-même). Chaque entrée est rattachée au compte qu'elle raconte le mieux :
    le compte lui-même pour une connexion ou un changement de son propre statut (désactivé/
    réactivé, mot de passe réinitialisé), mais l'AUTEUR de l'action pour un geste métier fait sur
    une fiche tierce (ex: la création d'une fiche élève apparaît dans le journal de l'admin qui
    l'a créée, pas dans celui de l'élève) — c'est ce qui permet de suivre l'activité d'un membre
    du personnel (élèves créés, notes saisies, paiements enregistrés...), pas seulement ses
    connexions. En plus des appels explicites à `accounts.services.journaliser` aux points clés,
    TOUTE création/modification/suppression faite via l'API est enregistrée automatiquement
    (voir `accounts.audit`) : qui a fait quoi, sur quel élément, et quels champs ont changé
    (`details`). Distinct de `tenants.JournalActivite`, réservé aux actions du Super Admin sur
    la plateforme elle-même (écoles, paiements d'abonnement...)."""

    class Categorie(models.TextChoices):
        CONNEXION = "connexion", "Connexion"
        COMPTE = "compte", "Gestion de compte"
        ELEVE = "eleve", "Élève"
        ENSEIGNANT = "enseignant", "Enseignant"
        NOTE = "note", "Notes"
        PAIEMENT = "paiement", "Paiement"
        ACADEMIQUE = "academique", "Classes & matières"
        PRESENCE = "presence", "Présences"
        COMMUNICATION = "communication", "Communication"
        BIBLIOTHEQUE = "bibliotheque", "Bibliothèque"
        TRANSPORT = "transport", "Transport"
        CANTINE = "cantine", "Cantine"
        ACCES = "acces", "Contrôle d'accès"
        PARAMETRES = "parametres", "Paramètres & données"
        AUTRE = "autre", "Autre"

    class Action(models.TextChoices):
        CREATION = "creation", "Création"
        MODIFICATION = "modification", "Modification"
        SUPPRESSION = "suppression", "Suppression"
        CONNEXION = "connexion", "Connexion"
        EXPORT = "export", "Export"
        AUTRE = "autre", "Autre action"

    # SET_NULL (et non CASCADE) : supprimer un compte ne doit pas effacer la trace de ce qu'il a
    # fait — son nom et son rôle restent dans `utilisateur_nom`/`utilisateur_role`.
    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="journal_activite",
    )
    utilisateur_nom = models.CharField(max_length=255, blank=True, default="")
    utilisateur_role = models.CharField(max_length=20, blank=True, default="")
    # École concernée, copiée à l'enregistrement (le compte peut disparaître ensuite) — c'est elle
    # qui délimite ce que l'Administrateur voit dans l'historique global de son établissement.
    ecole = models.ForeignKey(
        "tenants.Ecole", on_delete=models.CASCADE, null=True, blank=True, related_name="journal_utilisateurs",
    )
    horodatage = models.DateTimeField(auto_now_add=True, db_index=True)
    categorie = models.CharField(max_length=20, choices=Categorie.choices)
    action = models.CharField(max_length=20, choices=Action.choices, default=Action.AUTRE)
    description = models.CharField(max_length=255)
    # Éléments touchés par l'action : [{"modele", "id", "libelle", "operation", "champs": [{"champ",
    # "avant", "apres"}]}] — voir accounts.audit. Les champs sensibles (mots de passe, codes...)
    # n'y figurent jamais.
    details = models.JSONField(default=list, blank=True)
    methode = models.CharField(max_length=10, blank=True, default="")
    chemin = models.CharField(max_length=255, blank=True, default="")
    # Renseignées pour les connexions et actions déclenchées par une requête (voir
    # accounts.services.journaliser/_adresse_ip/_resumer_appareil) ; vides pour les actions
    # déclenchées côté serveur sans requête explicite associable.
    adresse_ip = models.GenericIPAddressField(null=True, blank=True)
    appareil = models.CharField(
        max_length=255, blank=True,
        help_text="Résumé lisible du navigateur/appareil (ex: « Chrome sur Windows »), déduit du User-Agent.",
    )

    class Meta:
        ordering = ["-horodatage"]
        verbose_name = "Entrée du journal utilisateur"
        verbose_name_plural = "Journal utilisateur"
        indexes = [models.Index(fields=["ecole", "-horodatage"])]

    def __str__(self):
        return f"{self.utilisateur_nom or self.utilisateur} — {self.description} ({self.horodatage:%d/%m/%Y %H:%M})"


class SessionActive(models.Model):
    """Session ouverte par un Super Admin (une par connexion réussie) — identifiée par la
    revendication `sid` embarquée dans ses jetons JWT (voir securite.emettre_jetons) et vérifiée
    à chaque requête par `PlateformeJWTAuthentication` ainsi qu'au rafraîchissement du jeton.
    Révoquer une session (`revoquee_le`) rend donc ses jetons inutilisables immédiatement, alors
    qu'un JWT seul resterait valable jusqu'à son expiration."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sessions_actives")
    sid = models.CharField(max_length=64, unique=True)
    appareil = models.ForeignKey(
        "AppareilConnu", on_delete=models.SET_NULL, null=True, blank=True, related_name="sessions",
    )
    adresse_ip = models.GenericIPAddressField(null=True, blank=True)
    appareil_libelle = models.CharField(max_length=255, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    cree_le = models.DateTimeField(auto_now_add=True)
    derniere_activite = models.DateTimeField(auto_now_add=True)
    expire_le = models.DateTimeField()
    revoquee_le = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-derniere_activite"]

    def __str__(self):
        return f"Session {self.user} — {self.appareil_libelle or '?'} ({self.adresse_ip or '?'})"

    @property
    def active(self) -> bool:
        from django.utils import timezone
        return self.revoquee_le is None and self.expire_le > timezone.now()


class AppareilConnu(models.Model):
    """Appareil (navigateur) depuis lequel un Super Admin s'est déjà connecté — reconnu par
    l'empreinte de l'identifiant aléatoire que le frontend garde dans le navigateur (en-tête
    `X-Device-Id`). Une connexion depuis un appareil absent de cette liste (ou depuis une adresse
    IP jamais vue) déclenche une alerte de connexion inhabituelle."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="appareils_connus")
    empreinte = models.CharField(max_length=64)
    libelle = models.CharField(max_length=255, blank=True)
    premiere_connexion = models.DateTimeField(auto_now_add=True)
    derniere_connexion = models.DateTimeField(auto_now_add=True)
    derniere_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-derniere_connexion"]
        constraints = [models.UniqueConstraint(fields=["user", "empreinte"], name="appareil_unique_par_user")]

    def __str__(self):
        return f"{self.user} — {self.libelle or self.empreinte[:8]}"


class EvenementSecurite(models.Model):
    """Journal de sécurité du Super Admin : connexions réussies/échouées (= historique des
    connexions), verrouillages, changements de 2FA, révocations de sessions, alertes de connexion
    inhabituelle... Distinct de `JournalUtilisateur` (activité métier, consultable par l'admin
    d'école) : celui-ci n'est visible que par les Super Admins."""

    class Type(models.TextChoices):
        CONNEXION_REUSSIE = "connexion_reussie", "Connexion réussie"
        ECHEC_MOT_DE_PASSE = "echec_mot_de_passe", "Échec de connexion (mot de passe)"
        ECHEC_2FA = "echec_2fa", "Échec de connexion (code 2FA)"
        CONNEXION_BLOQUEE = "connexion_bloquee", "Tentative sur compte verrouillé"
        COMPTE_VERROUILLE = "compte_verrouille", "Compte verrouillé"
        COMPTE_DEVERROUILLE = "compte_deverrouille", "Compte déverrouillé"
        CONNEXION_INHABITUELLE = "connexion_inhabituelle", "Connexion inhabituelle"
        DECONNEXION = "deconnexion", "Déconnexion"
        SESSION_REVOQUEE = "session_revoquee", "Session révoquée"
        SESSIONS_REVOQUEES = "sessions_revoquees", "Toutes les sessions révoquées"
        APPAREIL_RETIRE = "appareil_retire", "Appareil retiré"
        TOTP_ACTIVE = "totp_active", "Application d'authentification activée"
        TOTP_DESACTIVE = "totp_desactive", "Application d'authentification désactivée"
        OTP_ACTIVE = "otp_active", "Code par e-mail/SMS activé"
        OTP_DESACTIVE = "otp_desactive", "Code par e-mail/SMS désactivé"
        CODES_SECOURS_REGENERES = "codes_secours_regeneres", "Codes de secours régénérés"
        CODE_SECOURS_UTILISE = "code_secours_utilise", "Code de secours utilisé"
        MOT_DE_PASSE_CHANGE = "mot_de_passe_change", "Mot de passe changé"

    class Niveau(models.TextChoices):
        INFO = "info", "Information"
        AVERTISSEMENT = "avertissement", "Avertissement"
        CRITIQUE = "critique", "Critique"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="evenements_securite",
    )
    type = models.CharField(max_length=30, choices=Type.choices)
    niveau = models.CharField(max_length=15, choices=Niveau.choices, default=Niveau.INFO)
    description = models.CharField(max_length=255)
    adresse_ip = models.GenericIPAddressField(null=True, blank=True)
    appareil = models.CharField(max_length=255, blank=True)
    horodatage = models.DateTimeField(auto_now_add=True)
    # Alertes (niveau ≠ info) à signaler tant qu'elles n'ont pas été consultées.
    lu = models.BooleanField(default=False)

    TYPES_CONNEXION = [
        Type.CONNEXION_REUSSIE, Type.ECHEC_MOT_DE_PASSE, Type.ECHEC_2FA, Type.CONNEXION_BLOQUEE,
    ]
    TYPES_ECHEC = [Type.ECHEC_MOT_DE_PASSE, Type.ECHEC_2FA]

    class Meta:
        ordering = ["-horodatage"]
        indexes = [models.Index(fields=["user", "type", "horodatage"])]

    def __str__(self):
        return f"{self.user} — {self.get_type_display()} ({self.horodatage:%d/%m/%Y %H:%M})"
