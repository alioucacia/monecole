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
    PasswordResetOtpCompleteSerializer,
    PasswordResetOtpVerifySerializer,
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


class MonActiviteView(APIView):
    """Historique d'activité du compte CONNECTÉ (dernières entrées) — pendant de
    `ComptesEcoleViewSet.journal` (réservé à l'admin sur les comptes de son école) mais en
    self-service pour la page Profil, tous rôles confondus : chacun peut voir ses propres
    connexions/actions, sans droit particulier requis au-delà d'être authentifié."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        entrees = request.user.journal_activite.all()[:20]
        return Response(JournalUtilisateurSerializer(entrees, many=True).data)


class SupprimerPhotoView(APIView):
    """Retire la photo de profil du compte connecté — pendant de `MeView.patch` pour ce seul
    champ : un fichier uploadé (`ImageField`) ne peut pas être effacé via un simple PATCH JSON
    (`photo: null` serait ignoré par DRF sur un champ fichier), il faut un endpoint dédié qui
    appelle explicitement `photo.delete()`."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if request.user.photo:
            request.user.photo.delete(save=False)
            request.user.photo = None
            request.user.save(update_fields=["photo"])
        return Response(UserSerializer(request.user).data)


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
            # En plus du lien ci-dessus : un code à 6 chiffres, par e-mail ET SMS — un
            # deuxième chemin pour réinitialiser qui ne dépend pas du lien (utile si le client
            # mail/navigateur bascule le lien en HTTPS avant que le site ne soit servi en HTTPS,
            # voir backend/DEPLOYMENT.md). Voir PasswordResetOtpConfirmView pour la suite.
            from .models import CodeOTP
            from .services import generer_otp

            generer_otp(user, CodeOTP.Objectif.REINITIALISATION)

        return Response(
            {"detail": "Si un compte existe avec cet e-mail, un lien ET un code de réinitialisation viennent d'être envoyés."}
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


_TICKET_SALT = "password-reset-otp-verifie"
_TICKET_MAX_AGE = 5 * 60  # 5 minutes pour saisir le nouveau mot de passe après la vérification du code


class PasswordResetOtpVerifyView(APIView):
    """1er des deux temps du chemin OTP de réinitialisation (voir PasswordResetRequestView, qui
    envoie ce code en plus du lien signé habituel) : ne vérifie QUE le code, séparément de la
    saisie du nouveau mot de passe — l'un se fait en carreaux sur son propre écran, l'autre
    n'apparaît qu'une fois le code confirmé (voir ForgotPasswordPage.tsx). En cas de succès,
    renvoie un jeton signé de courte durée (5 minutes) à présenter à
    `PasswordResetOtpCompleteView` — le code OTP lui-même reste à usage unique (consommé ici,
    comme pour tout autre usage de `verifier_otp`), ce jeton est ce qui porte la preuve de
    vérification jusqu'à l'étape suivante."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        from django.core import signing

        from .models import CodeOTP
        from .services import verifier_otp

        serializer = PasswordResetOtpVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        # Même prudence que PasswordResetRequestView : ne jamais confirmer si le compte existe
        # via le message d'erreur (un code toujours "invalide" pour un e-mail inconnu, jamais
        # "compte introuvable").
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user or not verifier_otp(user, CodeOTP.Objectif.REINITIALISATION, serializer.validated_data["code"]):
            raise ValidationError({"code": "Code invalide ou expiré."})

        ticket = signing.dumps({"user_id": user.id}, salt=_TICKET_SALT)
        return Response({"reset_ticket": ticket})


class PasswordResetOtpCompleteView(APIView):
    """2e temps : applique le nouveau mot de passe, à partir du jeton renvoyé par
    `PasswordResetOtpVerifyView` — jamais du code OTP directement (déjà consommé à l'étape
    précédente)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        from django.core import signing

        serializer = PasswordResetOtpCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = signing.loads(serializer.validated_data["reset_ticket"], salt=_TICKET_SALT, max_age=_TICKET_MAX_AGE)
            user = User.objects.get(pk=payload["user_id"], is_active=True)
        except (signing.BadSignature, User.DoesNotExist):
            raise ValidationError({"reset_ticket": "Session de réinitialisation expirée — recommencez depuis le code reçu."})

        user.set_password(serializer.validated_data["new_password"])
        user.doit_changer_mot_de_passe = False
        user.save()
        return Response({"detail": "Mot de passe réinitialisé avec succès."})


class VerifierOtpConnexionView(APIView):
    """Second temps de la connexion quand `User.otp_actif` est activé — voir
    `CustomTokenObtainPairSerializer.validate`, qui a déjà vérifié le mot de passe et envoyé le
    code à cette étape. Délivre le vrai jeton JWT une fois le code confirmé, avec exactement la
    même forme de réponse que `/auth/login/` (access/refresh/user)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        from django.db.models import Q

        from .models import CodeOTP
        from .serializers import CustomTokenObtainPairSerializer, VerifierOtpConnexionSerializer
        from .services import journaliser, verifier_otp

        serializer = VerifierOtpConnexionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifiant = serializer.validated_data["identifiant"]

        try:
            user = User.objects.get(
                Q(username__iexact=identifiant) | Q(email__iexact=identifiant) | Q(phone=identifiant)
            )
        except (User.DoesNotExist, User.MultipleObjectsReturned):
            raise AuthenticationFailed("Code invalide ou expiré.")

        if not verifier_otp(user, CodeOTP.Objectif.CONNEXION, serializer.validated_data["code"]):
            raise AuthenticationFailed("Code invalide ou expiré.")

        token = CustomTokenObtainPairSerializer.get_token(user)
        journaliser(user, JournalUtilisateur.Categorie.CONNEXION, "Connexion à la plateforme (2FA)", request)
        return Response({
            "access": str(token.access_token), "refresh": str(token),
            "user": UserSerializer(user).data,
        })


class DemanderVerificationView(APIView):
    """Envoie un OTP pour vérifier l'e-mail ou le téléphone ACTUEL de l'utilisateur connecté
    (voir `DemanderVerificationSerializer` — jamais une valeur arbitraire soumise par
    l'appelant)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .models import CodeOTP
        from .serializers import DemanderVerificationSerializer
        from .services import generer_otp

        serializer = DemanderVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        canal = serializer.validated_data["canal"]

        cible = request.user.email if canal == "email" else request.user.phone
        if not cible:
            raise ValidationError(f"Aucun{'e' if canal == 'email' else ''} {'adresse' if canal == 'email' else 'numéro'} renseigné{'e' if canal == 'email' else ''} sur ce compte.")

        generer_otp(request.user, CodeOTP.Objectif.VERIFICATION, cible=cible)
        return Response({"detail": f"Code envoyé à {cible}."})


class ConfirmerVerificationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .models import CodeOTP
        from .serializers import ConfirmerVerificationSerializer
        from .services import verifier_otp

        serializer = ConfirmerVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        canal = serializer.validated_data["canal"]

        if not verifier_otp(request.user, CodeOTP.Objectif.VERIFICATION, serializer.validated_data["code"]):
            raise ValidationError({"code": "Code invalide ou expiré."})

        if canal == "email":
            request.user.email_verifie = True
            request.user.save(update_fields=["email_verifie"])
        else:
            request.user.telephone_verifie = True
            request.user.save(update_fields=["telephone_verifie"])
        return Response(UserSerializer(request.user).data)


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
        # Lu AVANT serializer.save() : UserCreateSerializer.create() le retire de
        # validated_data et le hache immédiatement — c'est la seule occasion de le voir en
        # clair pour pouvoir le communiquer au titulaire du compte ci-dessous (voir
        # accounts.notifications.notifier_creation_compte — sans cet appel, un compte créé ici
        # — Comptabilité, Surveillance, Directeur Général... via PersonnelAdminPage — n'était
        # jamais notifié de ses identifiants par aucun canal).
        mot_de_passe_clair = serializer.validated_data.get("password")
        utilisateur = serializer.save(ecole=ecole)
        from accounts.notifications import notifier_creation_compte

        notifier_creation_compte(utilisateur, mot_de_passe_clair, expediteur=self.request.user)

    def perform_update(self, serializer):
        from accounts.services import journaliser

        statut_avant = serializer.instance.is_active
        utilisateur = serializer.save()
        if utilisateur.is_active != statut_avant:
            description = "Compte réactivé" if utilisateur.is_active else "Compte désactivé"
            journaliser(utilisateur, JournalUtilisateur.Categorie.COMPTE, description, self.request)

    def perform_destroy(self, instance):
        from rest_framework.exceptions import ValidationError

        from accounts.services import journaliser

        if instance.id == self.request.user.id:
            raise ValidationError("Vous ne pouvez pas supprimer votre propre compte.")
        if instance.role == User.Role.ADMIN:
            autres_admins_actifs = User.objects.filter(
                ecole_id=instance.ecole_id, role=User.Role.ADMIN, is_active=True,
            ).exclude(pk=instance.pk).exists()
            if not autres_admins_actifs:
                raise ValidationError(
                    "Impossible de supprimer le dernier compte Administrateur actif de l'école — "
                    "désactivez-le plutôt, ou créez d'abord un autre administrateur."
                )
        description = f"Compte « {instance.get_full_name() or instance.username} » ({instance.get_role_display()}) supprimé"
        instance.delete()
        journaliser(self.request.user, JournalUtilisateur.Categorie.COMPTE, description, self.request)

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
