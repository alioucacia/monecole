from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AffectationTransportViewSet,
    ChauffeurInfoView,
    ChauffeurPointageView,
    ChauffeurPositionView,
    TicketBusViewSet,
    TrajetViewSet,
)

router = DefaultRouter()
router.register("trajets", TrajetViewSet, basename="trajet")
router.register("affectations", AffectationTransportViewSet, basename="affectation-transport")
router.register("tickets", TicketBusViewSet, basename="ticket-bus")

urlpatterns = [
    path("chauffeur/<uuid:token>/", ChauffeurInfoView.as_view(), name="chauffeur-info"),
    path("chauffeur/<uuid:token>/pointage/", ChauffeurPointageView.as_view(), name="chauffeur-pointage"),
    path("chauffeur/<uuid:token>/position/", ChauffeurPositionView.as_view(), name="chauffeur-position"),
] + router.urls
