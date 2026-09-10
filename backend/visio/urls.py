from rest_framework.routers import DefaultRouter

from .views import ReunionViewSet

router = DefaultRouter()
router.register("reunions", ReunionViewSet, basename="reunion")

urlpatterns = router.urls
