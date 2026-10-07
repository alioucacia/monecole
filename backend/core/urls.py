from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DashboardView, RapportAnnuelPdfView, RapportsAnnuelsView, SauvegardeEcoleViewSet, SauvegardeViewSet, SupervisionView

router = DefaultRouter()
router.register("sauvegardes", SauvegardeViewSet, basename="sauvegarde")
router.register("sauvegardes-ecole", SauvegardeEcoleViewSet, basename="sauvegarde-ecole")

urlpatterns = [
    path("", DashboardView.as_view(), name="dashboard"),
    path("supervision/", SupervisionView.as_view(), name="supervision"),
    path("rapports-annuels/", RapportsAnnuelsView.as_view(), name="rapports-annuels"),
    path("rapports-annuels/<int:annee_id>/pdf/", RapportAnnuelPdfView.as_view(), name="rapport-annuel-pdf"),
] + router.urls
