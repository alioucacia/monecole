from rest_framework.permissions import BasePermission

from .features import FONCTIONNALITES


def fonctionnalite_requise(cle):
    """Fabrique une classe de permission DRF qui bloque l'accès si le Super Admin a désactivé
    la fonctionnalité `cle` pour l'établissement de l'utilisateur connecté (voir
    `Ecole.fonctionnalites_desactivees` / `tenants.features.FONCTIONNALITES`).

    À ajouter dans `permission_classes`, EN PLUS des permissions existantes du ViewSet (pas à
    leur place) : `permission_classes = [IsAdminOrReadOnly, fonctionnalite_requise("transport")]`.
    Les entrées de cette liste sont combinées en ET par DRF, donc les deux contrôles s'appliquent.

    Un compte sans école (Super Admin) n'est jamais concerné : il gère la configuration des
    écoles, il n'utilise pas leurs modules métier au quotidien."""

    assert cle in FONCTIONNALITES, f"Fonctionnalité inconnue : {cle!r} (voir tenants/features.py)"

    class _FonctionnaliteRequise(BasePermission):
        message = f"La fonctionnalité « {FONCTIONNALITES[cle]} » est désactivée pour votre établissement."

        def has_permission(self, request, view):
            ecole = getattr(request.user, "ecole", None)
            if ecole is None:
                return True
            return ecole.a_fonctionnalite(cle)

    _FonctionnaliteRequise.__name__ = f"FonctionnaliteRequise_{cle}"
    return _FonctionnaliteRequise
