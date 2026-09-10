from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


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

        if user.role == "superadmin":
            return result

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
