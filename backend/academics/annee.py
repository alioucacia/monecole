"""Année scolaire « affichée » : l'application montre les données d'UNE année à la fois.

Par défaut, c'est l'année active de l'établissement. Seul l'administrateur peut consulter une
autre année : le frontend envoie alors son choix dans le paramètre `annee_vue` de chaque requête
(voir frontend/src/context/AnneeContext.tsx) — ignoré pour tous les autres rôles, qui restent
toujours sur l'année active.
"""

from django.db.models import Q
from rest_framework.filters import BaseFilterBackend

from .models import AnneeScolaire

PARAM_ANNEE_VUE = "annee_vue"
# Paramètre explicite « toutes les années » (ex: filtre « Toutes les années » d'une page).
PARAM_TOUTES_ANNEES = "toutes_annees"


def annee_active(user):
    if not getattr(user, "ecole_id", None):
        return None
    return AnneeScolaire.objects.filter(ecole_id=user.ecole_id, active=True).first()


def annee_courante(request):
    """Année affichée pour cette requête : celle choisie par l'administrateur (`annee_vue`),
    sinon l'année active. Mémorisée sur la requête (appelée plusieurs fois par réponse)."""
    django_request = getattr(request, "_request", request)
    if hasattr(django_request, "_annee_courante"):
        return django_request._annee_courante
    user = request.user
    annee = None
    choix = request.GET.get(PARAM_ANNEE_VUE, "")
    if choix.isdigit() and getattr(user, "role", None) == "admin" and user.ecole_id:
        annee = AnneeScolaire.objects.filter(ecole_id=user.ecole_id, pk=int(choix)).first()
    if annee is None:
        annee = annee_active(user)
    django_request._annee_courante = annee
    return annee


def filtre_eleves_annee(annee, prefixe=""):
    """Élèves scolarisés pendant `annee` : classe de cette année (actuelle ou dans l'historique
    des classes) — plus, pour l'année active, les élèves pas encore affectés à une classe."""
    q = Q(**{f"{prefixe}classe__annee_scolaire": annee}) | Q(**{f"{prefixe}historique_classes__annee_scolaire": annee})
    if annee.active:
        q |= Q(**{f"{prefixe}classe__isnull": True})
    return q


class AnneeScolaireFilterBackend(BaseFilterBackend):
    """Restreint les listes (pas les accès à un objet précis) à l'année affichée. La vue déclare :

    - `annee_scolaire_field` : chemin vers l'année (ex: "annee_scolaire", "periode__annee_scolaire") ;
    - ou `annee_date_field` : champ date, borné par les dates de début/fin de l'année ;
    - ou `annee_eleve_prefix` : chemin vers l'élève ("" pour EleveProfile, "eleve__"...).

    Sans effet si la requête précise déjà `annee_scolaire` (filtre explicite d'une page),
    `toutes_annees=1`, ou l'un des paramètres de `annee_params_explicites` de la vue (ex: une
    `classe` précise, qui appartient déjà à une année)."""

    def filter_queryset(self, request, queryset, view):
        if getattr(view, "detail", False):
            return queryset
        params = request.query_params
        if params.get("annee_scolaire") or params.get(PARAM_TOUTES_ANNEES) in ("1", "true"):
            return queryset
        if any(params.get(p) for p in getattr(view, "annee_params_explicites", ())):
            return queryset
        champ = getattr(view, "annee_scolaire_field", None)
        champ_date = getattr(view, "annee_date_field", None)
        prefixe_eleve = getattr(view, "annee_eleve_prefix", None)
        if not (champ or champ_date or prefixe_eleve is not None):
            return queryset
        annee = annee_courante(request)
        if annee is None:
            return queryset
        if champ:
            return queryset.filter(**{champ: annee})
        if champ_date:
            return queryset.filter(**{f"{champ_date}__gte": annee.date_debut, f"{champ_date}__lte": annee.date_fin})
        return queryset.filter(filtre_eleves_annee(annee, prefixe_eleve)).distinct()
