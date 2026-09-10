from rest_framework.routers import DefaultRouter

from django.urls import include, path

from .views import (
    ChangePasswordView,
    CustomTokenRefreshView,
    LoginView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    SuperAdminAccountViewSet,
    UserViewSet,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("comptes-superadmin", SuperAdminAccountViewSet, basename="compte-superadmin")

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("refresh/", CustomTokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("change-password/", ChangePasswordView.as_view(), name="change_password"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password_reset"),
    path("password-reset-confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("", include(router.urls)),
]
