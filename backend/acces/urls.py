from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CarteAccesViewSet, EquipementPassageView, EquipementPingView, EquipementViewSet, PassageViewSet

router = DefaultRouter()
router.register("equipements", EquipementViewSet, basename="equipement-acces")
router.register("cartes", CarteAccesViewSet, basename="carte-acces")
router.register("passages", PassageViewSet, basename="passage")

urlpatterns = [
    # API appelée par les équipements eux-mêmes (authentification par clé, pas de session).
    path("equipement/passage/", EquipementPassageView.as_view(), name="equipement-passage"),
    path("equipement/ping/", EquipementPingView.as_view(), name="equipement-ping"),
] + router.urls
