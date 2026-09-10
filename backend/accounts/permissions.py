from rest_framework.permissions import BasePermission, SAFE_METHODS


def _role(request):
    return getattr(request.user, "role", None)


class IsSuperAdmin(BasePermission):
    """Accès réservé au Super Admin de la plateforme (gestion des établissements)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "superadmin")


class IsAdmin(BasePermission):
    """Accès réservé aux administrateurs."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "admin")


class IsTeacher(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "teacher")


class IsStudent(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "student")


class IsParent(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "parent")


class IsComptabilite(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "comptabilite")


class IsSurveillance(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "surveillance")


class IsAdminOrTeacher(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and _role(request) in ("admin", "teacher")
        )


class IsAdminOrComptabilite(BasePermission):
    """Accès réservé à l'administrateur et au service comptabilité (gestion financière)."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and _role(request) in ("admin", "comptabilite")
        )


class IsAdminOrComptabiliteOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) in ("admin", "comptabilite")


class IsAdminOrSurveillance(BasePermission):
    """Accès réservé à l'administrateur et à la surveillance générale (vie scolaire, discipline)."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and _role(request) in ("admin", "surveillance")
        )


class IsAdminOrSurveillanceOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) in ("admin", "surveillance")


class IsAdminOrTeacherOrSurveillanceOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) in ("admin", "teacher", "surveillance")


class IsAdminOrReadOnly(BasePermission):
    """Tout le monde peut lire, seul l'admin peut modifier."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) == "admin"


class IsAdminOrTeacherOrReadOnly(BasePermission):
    """Lecture pour tous les authentifiés, écriture pour admin/enseignant."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request) in ("admin", "teacher")

# Le blocage "établissement suspendu / plateforme en maintenance" ne vit plus ici : voir
# accounts.authentication.PlateformeJWTAuthentication et son commentaire pour le pourquoi
# (chaque ViewSet de ce projet déclare son propre permission_classes, qui remplace plutôt
# que complète DEFAULT_PERMISSION_CLASSES — un contrôle placé dans une permission DRF
# classique ne s'exécuterait donc jamais).
