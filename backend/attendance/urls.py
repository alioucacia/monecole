from rest_framework.routers import DefaultRouter

from .views import JustificatifAbsenceViewSet, PresenceViewSet

router = DefaultRouter()
router.register("presences", PresenceViewSet, basename="presence")
router.register("justificatifs", JustificatifAbsenceViewSet, basename="justificatif")

urlpatterns = router.urls
