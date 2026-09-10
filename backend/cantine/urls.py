from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AgentCantineInfoView,
    AgentCantinePointageView,
    FormuleViewSet,
    InscriptionCantineViewSet,
    TicketCantineViewSet,
)

router = DefaultRouter()
router.register("formules", FormuleViewSet, basename="formule-cantine")
router.register("inscriptions", InscriptionCantineViewSet, basename="inscription-cantine")
router.register("tickets", TicketCantineViewSet, basename="ticket-cantine")

urlpatterns = [
    path("agent/<uuid:token>/", AgentCantineInfoView.as_view(), name="agent-cantine-info"),
    path("agent/<uuid:token>/pointage/", AgentCantinePointageView.as_view(), name="agent-cantine-pointage"),
] + router.urls
