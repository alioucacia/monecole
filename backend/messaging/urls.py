from rest_framework.routers import DefaultRouter

from django.urls import include, path

from .views import ContactsView, MessageViewSet

router = DefaultRouter()
router.register("messages", MessageViewSet, basename="message")

urlpatterns = [
    path("contacts/", ContactsView.as_view(), name="contacts"),
    path("", include(router.urls)),
]
