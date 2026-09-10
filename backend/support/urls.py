from rest_framework.routers import DefaultRouter

from .views import MessageTicketViewSet, TicketViewSet

router = DefaultRouter()
router.register("tickets", TicketViewSet, basename="ticket")
router.register("messages", MessageTicketViewSet, basename="message-ticket")

urlpatterns = router.urls
