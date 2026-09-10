from rest_framework.routers import DefaultRouter

from .views import EmpruntViewSet, LivreViewSet

router = DefaultRouter()
router.register("livres", LivreViewSet, basename="livre")
router.register("emprunts", EmpruntViewSet, basename="emprunt")

urlpatterns = router.urls
