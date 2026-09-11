from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from rest_framework.exceptions import AuthenticationFailed, ValidationError

from tenants.quotas import verifier_quota_plan

from .models import JournalUtilisateur, User
from .permissions import IsAdmin, IsSuperAdmin
from .serializers import (
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    JournalUtilisateurSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    UserCreateSerializer,
    UserSerializer,
)


class LoginView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    # Limite dédiée (voir DEFAULT_THROTTLE_RATES["login"]) — sans ça, seule la limite "anon"
    # générique s'appliquait (partagée avec toutes les routes anonymes), ce qui laissait un
    # budget bien trop large pour du brute-force ciblé sur un seul compte.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class CustomTokenRefreshView(TokenRefreshView):
    """Comme `TokenRefreshView`, mais applique aussi le blocage maintenance/école suspendue.

    Sans ce contrôle, un utilisateur déjà bloqué pouvait quand même renouveler indéfiniment
    son access token : `TokenRefreshView` ne passe jamais par `PlateformeJWTAuthentication`
    (il valide le refresh token directement, sans authentifier la requête). Le frontend,
    voyant un 401 sur sa requête, rafraîchissait alors "avec succès" puis réessayait — pour
    échouer à nouveau silencieusement, sans jamais déconnecter l'utilisateur ni afficher le
    message de maintenance."""

    def post(self, request, *args, **kwargs):
        refresh_str = request.data.get("refresh")
        if refresh_str:
            try:
                user = User.objects.select_related("ecole").get(pk=RefreshToken(refresh_str)["user_id"])
            except Exception:
                user = None
            if user and user.role != User.Role.SUPERADMIN:
                from tenants.models import ParametresPlateforme

                parametres = ParametresPlateforme.charger()
                if parametres.maintenance_active:
                    raise AuthenticationFailed(parametres.maintenance_message, code="maintenance")
                if user.ecole_id and not user.ecole.peut_se_connecter:
                    raise AuthenticationFailed(
                        "Votre établissement doit régulariser son abonnement pour continuer à utiliser la plateforme.",
                        code="ecole_inactive",
                    )
        return super().post(request, *args, **kwargs)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            return Response({"old_password": "Mot de passe incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["new_password"])
        user.doit_changer_mot_de_passe = False
        user.save()
        return Response({"detail": "Mot de passe mis à jour."})


class PasswordResetRequestView(APIView):
    """Déclenche l'envoi d'un e-mail de réinitialisation si le compte existe.

    La réponse est volontairement identique que l'e-mail existe ou non,
    afin de ne pas révéler quels comptes sont enregistrés.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_link = f"{settings.FRONTEND_URL}/reinitialiser-mot-de-passe/{uid}/{token}"
            send_mail(
                subject="Réinitialisation de votre mot de passe — Taly-School",
                message=(
                    f"Bonjour {user.get_full_name() or user.username},\n\n"
                    "Vous avez demandé la réinitialisation de votre mot de passe.\n"
                    f"Cliquez sur ce lien pour en choisir un nouveau :\n{reset_link}\n\n"
                    "Ce lien expire dans 3 jours. Si vous n'êtes pas à l'origine de cette "
                    "demande, ignorez simplement cet e-mail.\n\n"
                    "— L'équipe Taly-School"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )

        return Response(
            {"detail": "Si un compte existe avec cet e-mail, un lien de réinitialisation vient d'être envoyé."}
        )


class PasswordResetConfirmView(APIView):
    """Valide le token reçu par e-mail et applique le nouveau mot de passe."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        user.set_password(serializer.validated_data["new_password"])
        user.doit_changer_mot_de_passe = False
        user.save()
        return Response({"detail": "Mot de passe réinitialisé avec succès."})


class UserViewSet(viewsets.ModelViewSet):
    """Gestion des comptes utilisateurs — réservée aux administrateurs de l'établissement
    (chacun ne voit et ne gère que les comptes de sa propre école)."""

    queryset = User.objects.all()
    permission_classes = [IsAdmin]
    filterset_fields = ["role", "is_active"]
    search_fields = ["username", "first_name", "last_name", "email"]
    ordering_fields = ["last_name", "date_joined"]

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def perform_create(self, serializer):
        ecole = self.request.user.ecole
        if serializer.validated_data.get("role") == User.Role.ADMIN:
            verifier_quota_plan(
                ecole, "limite_administrateurs",
                User.objects.filter(ecole_id=ecole.id if ecole else None, role=User.Role.ADMIN).count(),
                "administrateurs",
            )
        serializer.save(ecole=ecole)

    def perform_update(self, serializer):
        from accounts.services import journaliser

        statut_avant = serializer.instance.is_active
        utilisateur = serializer.save()
        if utilisateur.is_active != statut_avant:
            description = "Compte réactivé" if utilisateur.is_active else "Compte désactivé"
            journaliser(utilisateur, JournalUtilisateur.Categorie.COMPTE, description, self.request)

    @action(detail=True, methods=["post"], url_path="reinitialiser-mot-de-passe")
    def reinitialiser_mot_de_passe(self, request, pk=None):
        """Génère un nouveau mot de passe temporaire pour ce compte de son école (élève,
        enseignant, parent, comptabilité, surveillance ou un autre admin) et le renvoie à
        l'Administrateur — seule occasion de le voir en clair."""
        from accounts.services import journaliser
        from accounts.services import reinitialiser_mot_de_passe as reinitialiser

        utilisateur = self.get_object()  # déjà filtré sur l'école de l'admin par get_queryset()
        resultat = reinitialiser(utilisateur)
        journaliser(
            utilisateur, JournalUtilisateur.Categorie.COMPTE,
            "Mot de passe réinitialisé par un administrateur", request,
        )
        return Response(resultat)

    @action(detail=True, methods=["get"], url_path="journal")
    def journal(self, request, pk=None):
        """Historique d'activité de ce compte (connexions + actions clés) — voir
        `JournalUtilisateur`. `get_object()` applique déjà le filtrage par école de l'admin
        connecté (get_queryset), donc aucune fuite inter-écoles possible ici."""
        utilisateur = self.get_object()
        entrees = utilisateur.journal_activite.all()
        page = self.paginate_queryset(entrees)
        serializer = JournalUtilisateurSerializer(page if page is not None else entrees, many=True)
        return self.get_paginated_response(serializer.data) if page is not None else Response(serializer.data)


class SuperAdminAccountViewSet(viewsets.ModelViewSet):
    """Gestion des comptes Super Admin de la plateforme (aucune école rattachée) —
    permet de déléguer l'administration de la plateforme à plusieurs personnes."""

    queryset = User.objects.filter(role=User.Role.SUPERADMIN)
    permission_classes = [IsSuperAdmin]
    ordering_fields = ["last_name", "date_joined"]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def perform_create(self, serializer):
        from tenants.models import JournalActivite

        compte = serializer.save(role=User.Role.SUPERADMIN, ecole=None)
        JournalActivite.objects.create(
            acteur=self.request.user, action=JournalActivite.Action.SUPERADMIN_CREE,
            details=f"Compte « {compte.get_full_name() or compte.username} » créé",
        )

    def perform_destroy(self, instance):
        if instance.id == self.request.user.id:
            raise ValidationError("Vous ne pouvez pas supprimer votre propre compte.")
        if User.objects.filter(role=User.Role.SUPERADMIN).count() <= 1:
            raise ValidationError("Impossible de supprimer le dernier compte Super Admin.")
        instance.delete()
