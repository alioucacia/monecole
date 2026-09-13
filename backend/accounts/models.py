from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Utilisateur unique pour tous les rôles de l'école."""

    class Role(models.TextChoices):
        SUPERADMIN = "superadmin", "Super Administrateur"
        ADMIN = "admin", "Administrateur"
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
    connexions. Volontairement PAS un journal exhaustif de chaque requête API
    (voir `accounts.services.journaliser`, appelé explicitement aux points qui comptent plutôt
    que via un signal générique). Distinct de `tenants.JournalActivite`, réservé aux actions du
    Super Admin sur la plateforme elle-même (écoles, paiements d'abonnement...) — mauvaise
    portée et mauvais choix d'actions pour ce besoin-ci."""

    class Categorie(models.TextChoices):
        CONNEXION = "connexion", "Connexion"
        COMPTE = "compte", "Gestion de compte"
        ELEVE = "eleve", "Élève"
        ENSEIGNANT = "enseignant", "Enseignant"
        NOTE = "note", "Notes"
        PAIEMENT = "paiement", "Paiement"

    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="journal_activite",
    )
    horodatage = models.DateTimeField(auto_now_add=True)
    categorie = models.CharField(max_length=20, choices=Categorie.choices)
    description = models.CharField(max_length=255)
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

    def __str__(self):
        return f"{self.utilisateur} — {self.description} ({self.horodatage:%d/%m/%Y %H:%M})"
