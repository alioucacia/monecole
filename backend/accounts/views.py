from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db.models import Q
from django.utils.dateparse import parse_date
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
from .permissions import IsAdmin, IsAdminOrComptabiliteReadOnly, IsSuperAdmin
from .serializers import (
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    DefinirCodeSuppressionSerializer,
    JournalUtilisateurSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetOtpCompleteSerializer,
    PasswordResetOtpVerifySerializer,
    PasswordResetRequestSerializer,
    UserCreateSerializer,
    UserSerializer,
)
from .services import definir_code_suppression


class LoginView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    # Limite dédiée (voir DEFAULT_THROTTLE_RATES["login"]) — sans ça, seule la limite "anon"
    # générique s'appliquait (partagée avec toutes les routes anonymes), ce qui laissait un
    # budget bien trop large pour du brute-force ciblé sur un seul compte.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        from .serializers import SecondFacteurRequis

        try:
            return super().post(request, *args, **kwargs)
        except SecondFacteurRequis as exc:
            # Réponse dédiée plutôt que le gestionnaire d'erreurs générique : le frontend a
            # besoin de la méthode attendue et du ticket pour l'étape suivante.
            return Response(
                {"detail": str(exc.detail), "message": str(exc.detail), "code": "otp_requis",
                 "methode": exc.methode, "ticket": exc.ticket},
                status=status.HTTP_401_UNAUTHORIZED,
            )


class LogoutView(APIView):
    """Ferme la session côté serveur (Super Admin : la `SessionActive` du jeton est révoquée,
    ses jetons deviennent aussitôt inutilisables). Sans effet pour les autres rôles, dont les
    jetons restent sans état — le frontend les efface de toute façon."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from . import securite
        from .models import EvenementSecurite

        sid = securite.sid_de_requete(request)
        if securite.est_protege(request.user) and sid:
            from django.utils import timezone

            securite.sessions_actives(request.user).filter(sid=sid).update(revoquee_le=timezone.now())
            securite.evenement(request.user, EvenementSecurite.Type.DECONNEXION, "Déconnexion", request)
        return Response(status=status.HTTP_204_NO_CONTENT)


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
            if user and user.role == User.Role.SUPERADMIN:
                # Une session révoquée ne doit pas pouvoir se « ressusciter » en rafraîchissant
                # son jeton — et une session encore valide voit son expiration repoussée, comme
                # la rotation du refresh token le fait côté SimpleJWT.
                from .securite import session_valide

                session_valide(user, RefreshToken(refresh_str).get("sid"), request, prolonger=True)
            elif user:
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
        if request.user.role == User.Role.SUPERADMIN and "otp_actif" in request.data:
            # Super Admin : la double authentification se règle depuis la page Sécurité, qui
            # exige le mot de passe — une session détournée ne doit pas pouvoir la couper.
            raise ValidationError({"otp_actif": "Réglez la double authentification depuis la page « Sécurité du compte »."})
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


class JournalEcoleView(generics.ListAPIView):
    """Historique de TOUTES les actions faites dans l'école (qui a fait quoi, quand, depuis quel
    appareil, et quels champs ont changé) — voir `accounts.audit`. Réservé à l'Administrateur
    (et au Directeur Général, en lecture). Filtres : `utilisateur`, `categorie`, `action`,
    `role`, `date_debut`/`date_fin` (AAAA-MM-JJ) et `search` (description ou nom de l'auteur)."""

    permission_classes = [IsAdmin]
    serializer_class = JournalUtilisateurSerializer

    def get_queryset(self):
        qs = JournalUtilisateur.objects.filter(ecole_id=self.request.user.ecole_id)
        params = self.request.query_params
        if params.get("utilisateur", "").isdigit():
            qs = qs.filter(utilisateur_id=params["utilisateur"])
        for champ, parametre in (("categorie", "categorie"), ("action", "action"), ("utilisateur_role", "role")):
            if params.get(parametre):
                qs = qs.filter(**{champ: params[parametre]})
        try:
            date_debut, date_fin = parse_date(params.get("date_debut", "")), parse_date(params.get("date_fin", ""))
        except ValueError:
            raise ValidationError("Date invalide.")
        if date_debut:
            qs = qs.filter(horodatage__date__gte=date_debut)
        if date_fin:
            qs = qs.filter(horodatage__date__lte=date_fin)
        terme = params.get("search", "").strip()
        if terme:
            qs = qs.filter(Q(description__icontains=terme) | Q(utilisateur_nom__icontains=terme))
        return qs.order_by("-horodatage")


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
        from .securite import apres_changement_mot_de_passe, sid_de_requete

        apres_changement_mot_de_passe(user, request, garder_sid=sid_de_requete(request))
        return Response({"detail": "Mot de passe mis à jour."})


class DefinirCodeSuppressionView(APIView):
    """Définit/remplace le code secret de suppression d'école du Super Admin connecté — voir
    User.code_suppression et EcoleViewSet.destroy (tenants/views.py), qui l'exige. Réservée au
    Super Admin : ce code n'a de sens pour aucun autre rôle."""

    permission_classes = [IsSuperAdmin]

    def post(self, request):
        serializer = DefinirCodeSuppressionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not request.user.check_password(serializer.validated_data["mot_de_passe_actuel"]):
            return Response({"mot_de_passe_actuel": "Mot de passe incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        definir_code_suppression(request.user, serializer.validated_data["nouveau_code"])
        return Response({"detail": "Code de suppression enregistré."})


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
        from .securite import apres_changement_mot_de_passe

        apres_changement_mot_de_passe(user, request, reinitialisation=True)
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
        from .securite import apres_changement_mot_de_passe

        apres_changement_mot_de_passe(user, request, reinitialisation=True)
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

        from . import securite
        from .models import CodeOTP, EvenementSecurite
        from .serializers import VerifierOtpConnexionSerializer
        from .services import verifier_otp

        # Erreurs en 400 (ValidationError) et non 401 : un 401 ferait croire à l'intercepteur du
        # frontend (api/client.ts) à une session expirée, qui redirigerait alors vers /login au
        # lieu d'afficher « code invalide » sur l'écran de saisie.
        invalide = ValidationError({"code": "Code invalide ou expiré."})

        serializer = VerifierOtpConnexionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = serializer.validated_data.get("ticket")
        code = serializer.validated_data["code"].strip()

        if ticket:
            user = securite.lire_ticket_2fa(ticket)
            if user is None:
                raise ValidationError({"code": "Délai de saisie dépassé — reconnectez-vous avec votre mot de passe."})
        else:
            identifiant = serializer.validated_data.get("identifiant", "")
            try:
                user = User.objects.get(
                    Q(username__iexact=identifiant) | Q(email__iexact=identifiant) | Q(phone=identifiant)
                )
            except (User.DoesNotExist, User.MultipleObjectsReturned):
                raise invalide

        protege = securite.est_protege(user)
        if protege:
            try:
                securite.verifier_verrou(user, request)
            except AuthenticationFailed as exc:
                raise ValidationError({"code": str(exc.detail)})

        if protege and user.totp_actif:
            # Le ticket est obligatoire ici (voir securite.creer_ticket_2fa).
            valide = bool(ticket) and securite.verifier_second_facteur_totp(user, code, request)
        else:
            valide = verifier_otp(user, CodeOTP.Objectif.CONNEXION, code)

        if not valide:
            if protege and securite.enregistrer_echec_connexion(user, request, EvenementSecurite.Type.ECHEC_2FA):
                raise ValidationError({"code": "Trop de tentatives échouées : compte temporairement verrouillé."})
            raise invalide

        jetons = securite.finaliser_connexion(user, request, "Connexion à la plateforme (2FA)")
        return Response({**jetons, "user": UserSerializer(user).data})


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


def _supprimer_compte(utilisateur):
    """Supprime le compte d'un utilisateur de l'école. Pour un ÉLÈVE, seul l'accès est retiré
    (compte désactivé, mot de passe invalidé, masqué des listes) : sa fiche, ses notes et
    l'historique de ses paiements dépendent de ce compte et sont conservés. Les autres comptes
    (parent, personnel) sont réellement supprimés — un parent supprimé laisse le dossier de
    ses enfants intact (lien remis à vide)."""
    if utilisateur.role == User.Role.STUDENT:
        utilisateur.acces_supprime = True
        utilisateur.is_active = False
        utilisateur.set_unusable_password()
        utilisateur.save(update_fields=["acces_supprime", "is_active", "password"])
    else:
        utilisateur.delete()


class UserViewSet(viewsets.ModelViewSet):
    """Gestion des comptes utilisateurs — réservée aux administrateurs de l'établissement
    (chacun ne voit et ne gère que les comptes de sa propre école)."""

    queryset = User.objects.all()
    permission_classes = [IsAdminOrComptabiliteReadOnly]
    filterset_fields = ["role", "is_active"]
    search_fields = ["username", "first_name", "last_name", "email", "phone"]
    ordering_fields = ["last_name", "date_joined"]

    def get_queryset(self):
        qs = super().get_queryset().filter(ecole_id=self.request.user.ecole_id)
        if self.action == "list":
            # Comptes élèves dont l'accès a été supprimé : plus affichés (voir User.acces_supprime),
            # mais toujours accessibles individuellement pour leur rendre un mot de passe.
            qs = qs.filter(acces_supprime=False)
        return qs

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
        _supprimer_compte(instance)
        journaliser(self.request.user, JournalUtilisateur.Categorie.COMPTE, description, self.request)

    @action(detail=False, methods=["post"], url_path="supprimer-comptes")
    def supprimer_comptes(self, request):
        """Suppression en masse des comptes ÉLÈVES et PARENTS cochés (`ids`) de l'école — les
        autres rôles (personnel) restent à supprimer un par un. Même règle que la suppression
        individuelle : le dossier scolaire d'un élève est conservé (voir `_supprimer_compte`)."""
        from rest_framework.exceptions import ValidationError

        from accounts.services import journaliser

        ids = request.data.get("ids")
        if not isinstance(ids, list) or not ids:
            raise ValidationError("Sélectionnez au moins un compte.")
        comptes = list(self.get_queryset().filter(
            pk__in=[i for i in ids if str(i).isdigit()], role__in=[User.Role.STUDENT, User.Role.PARENT],
        ))
        eleves = sum(1 for c in comptes if c.role == User.Role.STUDENT)
        for compte in comptes:
            _supprimer_compte(compte)
        journaliser(
            request.user, JournalUtilisateur.Categorie.COMPTE,
            f"Suppression en masse : {eleves} compte(s) élève, {len(comptes) - eleves} compte(s) parent", request,
        )
        return Response({"supprimes": len(comptes), "eleves": eleves, "parents": len(comptes) - eleves, "ignores": len(ids) - len(comptes)})

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

    @action(detail=True, methods=["post"])
    def deverrouiller(self, request, pk=None):
        """Lève le verrouillage temporaire (trop d'échecs de connexion) d'un compte Super Admin —
        sans attendre la fin du délai, par un autre Super Admin qui a vérifié que c'était bien
        son titulaire qui s'était trompé."""
        from .securite import deverrouiller

        compte = self.get_object()
        deverrouiller(compte, par=request.user, request=request)
        return Response(UserSerializer(compte).data)
