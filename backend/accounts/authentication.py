from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

# Fréquence maximale d'écriture de `User.derniere_activite` — sans ce plancher, chaque requête
# authentifiée (potentiellement plusieurs par seconde par utilisateur actif) déclencherait un
# UPDATE, alors que la seule chose qui compte est de savoir si quelqu'un s'est manifesté dans
# les dernières minutes (voir `User.en_ligne`).
_DELAI_MAJ_ACTIVITE = timezone.timedelta(minutes=1)


class PlateformeJWTAuthentication(JWTAuthentication):
    """Comme `JWTAuthentication`, mais bloque en plus l'accès si la plateforme entière est
    en maintenance, ou si l'établissement de l'utilisateur n'est plus à jour de son
    abonnement (au-delà du délai de grâce) / a été suspendu par le Super Admin.

    Ce contrôle doit vivre ici plutôt que dans une permission DRF classique : chaque
    ViewSet de ce projet déclare son propre `permission_classes`, ce qui REMPLACE (et ne
    complète pas) `DEFAULT_PERMISSION_CLASSES` — un contrôle placé uniquement là ne
    s'exécuterait donc jamais (vérifié : aucune vue ne l'incluait explicitement).
    `authentication_classes`, lui, n'est surchargé nulle part dans ce projet : ce point
    d'entrée s'applique donc bien à toutes les requêtes authentifiées, sans exception."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result

        maintenant = timezone.now()
        if not user.derniere_activite or maintenant - user.derniere_activite >= _DELAI_MAJ_ACTIVITE:
            type(user).objects.filter(pk=user.pk).update(derniere_activite=maintenant)
            user.derniere_activite = maintenant

        if user.role == "superadmin":
            return result

        if user.role == "admin":
            # Session unique (voir User.session_id / CustomTokenObtainPairSerializer.get_token) :
            # un jeton dont la revendication "session_id" ne correspond plus à la valeur courante
            # a été invalidé par une connexion plus récente ailleurs — on ne peut jamais avoir
            # deux sessions admin valides en même temps.
            if token.get("session_id") != user.session_id:
                raise AuthenticationFailed(
                    "Votre session a été fermée car une connexion a été détectée ailleurs avec ce compte.",
                    code="session_expiree",
                )

        from tenants.models import ParametresPlateforme

        parametres = ParametresPlateforme.charger()
        if parametres.maintenance_active:
            raise AuthenticationFailed(parametres.maintenance_message, code="maintenance")

        if user.ecole_id and not user.ecole.peut_se_connecter:
            raise AuthenticationFailed(
                "Votre établissement doit régulariser son abonnement pour continuer à utiliser la plateforme.",
                code="ecole_inactive",
            )
        return result
