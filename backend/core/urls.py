from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DashboardView, SauvegardeViewSet, SupervisionView

router = DefaultRouter()
router.register("sauvegardes", SauvegardeViewSet, basename="sauvegarde")

urlpatterns = [
    path("", DashboardView.as_view(), name="dashboard"),
    path("supervision/", SupervisionView.as_view(), name="supervision"),
] + router.urls
