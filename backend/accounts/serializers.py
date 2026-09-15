import secrets

from django.contrib.auth import password_validation
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from core.validators import EXTENSIONS_IMAGE, TAILLE_MAX_IMAGE, valider_taille_fichier

from .models import JournalUtilisateur, User


class UniqueLoginFieldsMixin:
    """L'e-mail et le téléphone servent aussi à se connecter (voir MultiFieldAuthBackend) :
    deux comptes ne peuvent pas partager la même valeur non vide, sous peine de rendre la
    connexion ambiguë. Les valeurs vides ne sont pas concernées."""

    def _validate_unique_login_field(self, field, value):
        if value:
            qs = User.objects.filter(**{field: value})
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError("Cette valeur est déjà utilisée par un autre compte.")
        return value

    def validate_email(self, value):
        return self._validate_unique_login_field("email", value)

    def validate_phone(self, value):
        return self._validate_unique_login_field("phone", value)


class UserSerializer(UniqueLoginFieldsMixin, serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    ecole_nom = serializers.CharField(source="ecole.nom", read_only=True, default=None)
    # Personnalisation (couleurs des documents) et fonctionnalités désactivées par le Super
    # Admin pour l'école de ce compte — portées ici (plutôt que dans un endpoint séparé) car
    # `/me/` est déjà chargé au démarrage de l'app pour tous les rôles : c'est ce qui permet au
    # frontend de masquer un module désactivé dans la navigation, quel que soit le rôle connecté.
    ecole_couleur_principale = serializers.CharField(source="ecole.couleur_principale", read_only=True, default=None)
    ecole_couleur_secondaire = serializers.CharField(source="ecole.couleur_secondaire", read_only=True, default=None)
    ecole_fonctionnalites_desactivees = serializers.ListField(
        source="ecole.fonctionnalites_desactivees", read_only=True, default=list,
    )
    # Logo + adresse de l'école, affichés en haut du tableau de bord — mêmes raisons que les
    # couleurs ci-dessus (porté par /me/, déjà chargé pour tous les rôles).
    ecole_logo = serializers.ImageField(source="ecole.logo", read_only=True, default=None)
    ecole_adresse = serializers.CharField(source="ecole.adresse", read_only=True, default=None)
    en_ligne = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "full_name",
            "role", "role_display", "ecole", "ecole_nom", "phone", "address", "photo",
            "sexe", "date_of_birth", "is_active", "date_joined", "last_login",
            "doit_changer_mot_de_passe", "otp_actif", "email_verifie", "telephone_verifie",
            "ecole_couleur_principale", "ecole_couleur_secondaire", "ecole_fonctionnalites_desactivees",
            "ecole_logo", "ecole_adresse", "en_ligne",
        ]
        # CRITIQUE : `role` doit rester en lecture seule ici. `UserSerializer` sert à la fois à
        # `UserViewSet` (réservé à IsAdmin — qui ne l'utilise de toute façon que pour
        # nom/email/téléphone/adresse/is_active, jamais pour changer un rôle, voir
        # ComptesEcolePage.tsx) et à `MeView` (accessible à TOUT utilisateur connecté, pour
        # éditer son propre profil — voir accounts.views.MeView.patch). Sans ce verrou,
        # n'importe quel compte (élève inclus) pouvait s'auto-promouvoir en envoyant simplement
        # `PATCH /api/auth/me/ {"role": "superadmin"}` — vérifié en conditions réelles avant ce
        # correctif : élévation de privilèges totale, faille de contrôle d'accès la plus critique
        # possible sur cette application. (`is_active` reste modifiable : c'est le bascule
        # activer/désactiver un compte utilisé par l'admin dans ComptesEcolePage — un
        # utilisateur ne peut de toute façon pas se réactiver lui-même une fois désactivé,
        # puisque son jeton cesse alors d'être accepté, voir SimpleJWT.)
        #
        # `email_verifie`/`telephone_verifie` sont AUSSI en lecture seule ici, pour la même
        # raison que `role` : ne se posent que via `ConfirmerVerificationView`, qui exige un
        # code OTP réellement reçu — sans ce verrou, n'importe qui aurait pu s'auto-déclarer
        # "vérifié" par un simple PATCH, rendant le badge de vérification totalement fictif.
        # `otp_actif`, lui, reste volontairement modifiable ici : c'est un choix personnel
        # (activer/désactiver son propre 2FA), pas une preuve à apporter.
        read_only_fields = [
            "id", "date_joined", "last_login", "ecole", "doit_changer_mot_de_passe", "role",
            "email_verifie", "telephone_verifie",
        ]

    def validate_photo(self, value):
        return valider_taille_fichier(value, TAILLE_MAX_IMAGE, EXTENSIONS_IMAGE)


class JournalUtilisateurSerializer(serializers.ModelSerializer):
    categorie_display = serializers.CharField(source="get_categorie_display", read_only=True)

    class Meta:
        model = JournalUtilisateur
        fields = ["id", "horodatage", "categorie", "categorie_display", "description", "adresse_ip", "appareil"]


class UserCreateSerializer(UniqueLoginFieldsMixin, serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[password_validation.validate_password])

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "password",
            "role", "phone", "address", "date_of_birth",
        ]

    def validate_role(self, value):
        # CRITIQUE : ce serializer sert à `UserViewSet.create`, réservé à IsAdmin — c'est-à-dire
        # l'administrateur d'UNE SEULE école, qui ne doit jamais pouvoir créer un compte
        # Super Admin (accès à TOUTE la plateforme, toutes les écoles). Sans ce verrou,
        # `POST /api/auth/users/ {"role": "superadmin", ...}` créait bel et bien un compte
        # Super Admin pleinement fonctionnel — vérifié en conditions réelles avant ce correctif.
        # La création d'un Super Admin reste possible, mais uniquement via
        # `SuperAdminAccountViewSet` (permission_classes = [IsSuperAdmin]).
        if value == User.Role.SUPERADMIN:
            raise serializers.ValidationError(
                "Impossible de créer un compte Super Administrateur depuis cet endpoint."
            )
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        # Le mot de passe est choisi par la personne qui crée le compte (admin/Super Admin),
        # pas par son titulaire : on le force à en définir un à lui dès sa première connexion.
        user.doit_changer_mot_de_passe = True
        user.save()
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[password_validation.validate_password])


class VerifierOtpConnexionSerializer(serializers.Serializer):
    """Second temps de la connexion quand `User.otp_actif` est activé (voir
    `CustomTokenObtainPairSerializer.validate` et `accounts.views.VerifierOtpConnexionView`) —
    le mot de passe a déjà été vérifié à l'étape précédente (`/auth/login/`), il ne reste qu'à
    confirmer le code reçu par e-mail/SMS."""

    identifiant = serializers.CharField()
    code = serializers.CharField(max_length=6, min_length=6)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetOtpVerifySerializer(serializers.Serializer):
    """1er temps de l'alternative au lien signé (`PasswordResetConfirmSerializer` ci-dessous) :
    un code à 6 chiffres à saisir directement dans l'app plutôt que de suivre un lien e-mail —
    utile quand ce lien n'aboutit pas (ex : navigateur/client mail qui bascule le lien en HTTPS
    alors que le site n'est pas encore servi en HTTPS, voir backend/DEPLOYMENT.md). Volontairement
    séparé de la saisie du nouveau mot de passe (voir PasswordResetOtpCompleteSerializer) — le
    code se confirme en premier, seul, sur son propre écran (voir ForgotPasswordPage.tsx)."""

    email = serializers.EmailField()
    code = serializers.CharField(max_length=6, min_length=6)


class PasswordResetOtpCompleteSerializer(serializers.Serializer):
    """2e temps : le jeton renvoyé par PasswordResetOtpVerifyView (pas le code OTP lui-même,
    déjà consommé) plus le nouveau mot de passe."""

    reset_ticket = serializers.CharField()
    new_password = serializers.CharField(write_only=True, validators=[password_validation.validate_password])


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, validators=[password_validation.validate_password])

    def validate(self, attrs):
        try:
            user_id = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=user_id)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            raise serializers.ValidationError({"uid": "Lien de réinitialisation invalide."})

        if not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError({"token": "Lien de réinitialisation invalide ou expiré."})

        attrs["user"] = user
        return attrs


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Ajoute les informations utilisateur (rôle, nom) directement dans la réponse du login."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["full_name"] = user.get_full_name() or user.username
        if user.role == User.Role.ADMIN:
            # Session unique pour le rôle admin (voir User.session_id) : chaque connexion
            # régénère cette valeur et invalide immédiatement toute session précédente, vérifiée
            # à chaque requête par PlateformeJWTAuthentication.
            user.session_id = secrets.token_urlsafe(24)
            user.save(update_fields=["session_id"])
            token["session_id"] = user.session_id
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        if user.role != User.Role.SUPERADMIN:
            from tenants.models import ParametresPlateforme

            parametres = ParametresPlateforme.charger()
            if parametres.maintenance_active:
                # Bloque aussi la CONNEXION (pas seulement les requêtes suivantes, déjà gérées
                # par `PlateformeJWTAuthentication`) — sinon un utilisateur pouvait encore se
                # connecter pendant la maintenance et n'échouait qu'à sa requête suivante.
                raise AuthenticationFailed(parametres.maintenance_message, code="maintenance")
            if user.ecole_id and not user.ecole.peut_se_connecter:
                raise AuthenticationFailed(
                    "Votre établissement doit régulariser son abonnement pour continuer à utiliser la plateforme. "
                    "Contactez l'administrateur de la plateforme.",
                    code="ecole_inactive",
                )

        if user.otp_actif:
            # Double authentification activée par CET utilisateur (voir User.otp_actif) : le mot
            # de passe vient d'être vérifié avec succès par `super().validate()` ci-dessus (et un
            # jeton déjà généré en interne, jeté sans être renvoyé) — mais on ne délivre PAS
            # encore l'accès : un code à usage unique part par e-mail/SMS, à confirmer via
            # `VerifierOtpConnexionView` (voir accounts.views) pour obtenir le vrai jeton.
            from .models import CodeOTP
            from .services import generer_otp

            resultat = generer_otp(user, CodeOTP.Objectif.CONNEXION)
            # `cree=False` ("trop_recent") : un code envoyé il y a moins d'une minute est encore
            # valable — on redemande quand même sa saisie plutôt que d'en émettre un nouveau.
            # `cree=True` mais ni e-mail ni SMS n'ont pu partir (aucun des deux renseigné, ou
            # échec des deux) : bloquer l'accès derrière un 2FA qui ne peut matériellement pas
            # arriver serait un verrou sans porte — on laisse passer cette fois-ci plutôt que de
            # coincer l'utilisateur hors de son propre compte.
            if not (resultat["cree"] and not (resultat["email_envoye"] or resultat["sms_envoye"])):
                raise AuthenticationFailed(
                    "Un code de vérification a été envoyé par e-mail/SMS — saisissez-le pour terminer la connexion.",
                    code="otp_requis",
                )

        from .services import journaliser

        journaliser(user, JournalUtilisateur.Categorie.CONNEXION, "Connexion à la plateforme", self.context.get("request"))

        data["user"] = UserSerializer(user).data
        return data


class DemanderVerificationSerializer(serializers.Serializer):
    """Déclenche l'envoi d'un OTP pour vérifier l'e-mail OU le téléphone COURANT de
    l'utilisateur connecté (voir accounts.views.DemanderVerificationView) — jamais une valeur
    arbitraire fournie ici : on vérifie ce qui est réellement enregistré sur le compte, pas ce
    que l'appelant prétend vouloir vérifier."""

    canal = serializers.ChoiceField(choices=["email", "telephone"])


class ConfirmerVerificationSerializer(serializers.Serializer):
    canal = serializers.ChoiceField(choices=["email", "telephone"])
    code = serializers.CharField(max_length=6, min_length=6)
