from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AnnuaireUtilisateursViewSet,
    EcoleViewSet,
    FonctionnalitesDisponiblesView,
    JournalActiviteViewSet,
    ModeleMessageViewSet,
    MonEcoleView,
    PaiementEcoleViewSet,
    ParametresPlateformeView,
    PlanAbonnementViewSet,
    PlateformeBrandingView,
    RechercheGlobaleView,
)

router = DefaultRouter()
router.register("ecoles", EcoleViewSet, basename="ecole")
router.register("paiements-ecoles", PaiementEcoleViewSet, basename="paiement-ecole")
router.register("journal-activite", JournalActiviteViewSet, basename="journal-activite")
router.register("plans-abonnement", PlanAbonnementViewSet, basename="plan-abonnement")
router.register("annuaire-utilisateurs", AnnuaireUtilisateursViewSet, basename="annuaire-utilisateur")
router.register("modeles-message", ModeleMessageViewSet, basename="modele-message")

urlpatterns = [
    path("mon-ecole/", MonEcoleView.as_view(), name="mon-ecole"),
    path("recherche-globale/", RechercheGlobaleView.as_view(), name="recherche-globale"),
    path("parametres-plateforme/", ParametresPlateformeView.as_view(), name="parametres-plateforme"),
    path("plateforme-branding/", PlateformeBrandingView.as_view(), name="plateforme-branding"),
    path("fonctionnalites-disponibles/", FonctionnalitesDisponiblesView.as_view(), name="fonctionnalites-disponibles"),
] + router.urls
