from rest_framework.routers import DefaultRouter

from django.urls import include, path

from .views import (
    ChangePasswordView,
    ConfirmerVerificationView,
    CustomTokenRefreshView,
    DemanderVerificationView,
    LoginView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetOtpConfirmView,
    PasswordResetRequestView,
    SuperAdminAccountViewSet,
    UserViewSet,
    VerifierOtpConnexionView,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("comptes-superadmin", SuperAdminAccountViewSet, basename="compte-superadmin")

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("verifier-otp-connexion/", VerifierOtpConnexionView.as_view(), name="verifier_otp_connexion"),
    path("refresh/", CustomTokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("change-password/", ChangePasswordView.as_view(), name="change_password"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password_reset"),
    path("password-reset-confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("password-reset-otp-confirm/", PasswordResetOtpConfirmView.as_view(), name="password_reset_otp_confirm"),
    path("demander-verification/", DemanderVerificationView.as_view(), name="demander_verification"),
    path("confirmer-verification/", ConfirmerVerificationView.as_view(), name="confirmer_verification"),
    path("", include(router.urls)),
]
