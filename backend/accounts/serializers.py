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

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "full_name",
            "role", "role_display", "ecole", "ecole_nom", "phone", "address", "photo",
            "sexe", "date_of_birth", "is_active", "date_joined", "last_login",
            "doit_changer_mot_de_passe",
            "ecole_couleur_principale", "ecole_couleur_secondaire", "ecole_fonctionnalites_desactivees",
        ]
        read_only_fields = ["id", "date_joined", "last_login", "ecole", "doit_changer_mot_de_passe"]

    def validate_photo(self, value):
        return valider_taille_fichier(value, TAILLE_MAX_IMAGE, EXTENSIONS_IMAGE)


class JournalUtilisateurSerializer(serializers.ModelSerializer):
    categorie_display = serializers.CharField(source="get_categorie_display", read_only=True)

    class Meta:
        model = JournalUtilisateur
        fields = ["id", "horodatage", "categorie", "categorie_display", "description", "adresse_ip"]


class UserCreateSerializer(UniqueLoginFieldsMixin, serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[password_validation.validate_password])

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "password",
            "role", "phone", "address", "date_of_birth",
        ]

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


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


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
        from .services import journaliser

        journaliser(user, JournalUtilisateur.Categorie.CONNEXION, "Connexion à la plateforme", self.context.get("request"))

        data["user"] = UserSerializer(user).data
        return data
