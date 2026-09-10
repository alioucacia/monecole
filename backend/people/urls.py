from rest_framework.routers import DefaultRouter

from django.urls import include, path

from .views import (
    AlerteParentViewSet, AssistantIAView, BadgeVerifyView, EleveBadgeViewSet, EleveProfileViewSet,
    EnseignantBadgeViewSet, EnseignantProfileViewSet, GroupeRevisionViewSet,
    PaieEnseignantViewSet, PointageEnseignantViewSet,
)

router = DefaultRouter()
router.register("eleves", EleveProfileViewSet, basename="eleve")
router.register("enseignants", EnseignantProfileViewSet, basename="enseignant")
router.register("badges", EleveBadgeViewSet, basename="badge")
router.register("badges-enseignants", EnseignantBadgeViewSet, basename="badge-enseignant")
router.register("pointages-enseignants", PointageEnseignantViewSet, basename="pointage-enseignant")
router.register("paies-enseignants", PaieEnseignantViewSet, basename="paie-enseignant")
router.register("groupes-revision", GroupeRevisionViewSet, basename="groupe-revision")
router.register("alertes-parents", AlerteParentViewSet, basename="alerte-parent")

urlpatterns = [
    path("badges/verify/<uuid:token>/", BadgeVerifyView.as_view(), name="badge-verify"),
    path("assistant-ia/", AssistantIAView.as_view(), name="assistant-ia"),
    path("", include(router.urls)),
]
