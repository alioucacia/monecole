from rest_framework.permissions import BasePermission, SAFE_METHODS


def _role(request):
    return getattr(request.user, "role", None)


def _lecture_seule_directeur(request) -> bool:
    """Le Directeur Général (voir `User.Role.DIRECTEUR`) a un accès EN LECTURE SEULE à
    l'ensemble de son école — rôle de pure supervision, jamais d'écriture, sur tout ce que
    l'Administrateur peut voir. Centralisé ici plutôt que dupliqué dans chaque permission
    ci-dessous : les classes qui appellent cette fonction en tête de `has_permission` héritent
    automatiquement de cette règle, sans qu'il faille toucher les ViewSets qui les utilisent."""
    return bool(
        request.user and request.user.is_authenticated
        and _role(request) == "directeur"
        and request.method in SAFE_METHODS
    )


class IsSuperAdmin(BasePermission):
    """Accès réservé au Super Admin de la plateforme (gestion des établissements)."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request) == "superadmin")


class IsAdmin(BasePermission):
    """Accès réservé aux administrateurs (le Directeur Général y a un accès lecture seule —
    voir `_lecture_seule_directeur` ci-dessus)."""

    def has_permission(self, request, view):
        if _lecture_seule_directeur(request):
            return True
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
        if _lecture_seule_directeur(request):
            return True
        return bool(
            request.user
            and request.user.is_authenticated
            and _role(request) in ("admin", "teacher")
        )


class IsAdminOrComptabilite(BasePermission):
    """Accès réservé à l'administrateur et au service comptabilité (gestion financière) —
    le Directeur Général y a un accès lecture seule (voir `_lecture_seule_directeur`)."""

    def has_permission(self, request, view):
        if _lecture_seule_directeur(request):
            return True
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
    """Accès réservé à l'administrateur et à la surveillance générale (vie scolaire, discipline)
    — le Directeur Général y a un accès lecture seule (voir `_lecture_seule_directeur`)."""

    def has_permission(self, request, view):
        if _lecture_seule_directeur(request):
            return True
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


class IsAdminOrSurveillanceReadWriteNoDelete(BasePermission):
    """Lecture pour tous les authentifiés ; création/modification pour admin et surveillance
    générale ; suppression réservée à l'admin seul (Classes, Enseignants, Matières : le
    surveillant gère au quotidien mais ne doit pas pouvoir supprimer définitivement)."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method == "DELETE":
            return _role(request) == "admin"
        return _role(request) in ("admin", "surveillance")


class IsAdminOrComptabiliteReadWriteNoDelete(BasePermission):
    """Lecture pour tous les authentifiés ; création/modification pour admin et comptabilité ;
    suppression réservée à l'admin seul (Élèves : la comptabilité enregistre/modifie un dossier
    au quotidien — inscription, correction d'état civil... — mais ne doit pas pouvoir supprimer
    un élève définitivement)."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method == "DELETE":
            return _role(request) == "admin"
        return _role(request) in ("admin", "comptabilite")

# Le blocage "établissement suspendu / plateforme en maintenance" ne vit plus ici : voir
# accounts.authentication.PlateformeJWTAuthentication et son commentaire pour le pourquoi
# (chaque ViewSet de ce projet déclare son propre permission_classes, qui remplace plutôt
# que complète DEFAULT_PERMISSION_CLASSES — un contrôle placé dans une permission DRF
# classique ne s'exécuterait donc jamais).
