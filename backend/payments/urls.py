from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CaissePdfView, CaisseView, CategorieDepenseViewSet, DepenseViewSet, FraisViewSet, PaiementViewSet, TarifClasseViewSet, TypeFraisViewSet

router = DefaultRouter()
router.register("types-frais", TypeFraisViewSet, basename="type-frais")
router.register("tarifs-classe", TarifClasseViewSet, basename="tarif-classe")
router.register("frais", FraisViewSet, basename="frais")
router.register("paiements", PaiementViewSet, basename="paiement")
router.register("depenses", DepenseViewSet, basename="depense")
router.register("categories-depense", CategorieDepenseViewSet, basename="categorie-depense")

urlpatterns = router.urls + [
    path("caisse/", CaisseView.as_view(), name="caisse"),
    path("caisse/pdf/", CaissePdfView.as_view(), name="caisse-pdf"),
]
