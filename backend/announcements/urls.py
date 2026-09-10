from rest_framework.routers import DefaultRouter

from .views import AnnoncePlateformeViewSet, AnnonceViewSet

router = DefaultRouter()
router.register("annonces", AnnonceViewSet, basename="annonce")
router.register("plateforme", AnnoncePlateformeViewSet, basename="annonce-plateforme")

urlpatterns = router.urls
