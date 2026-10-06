"""API de la page « Sécurité du compte » du Super Admin (voir accounts/securite.py et
frontend/src/pages/SecuritePage.tsx) : 2FA, sessions actives, appareils connus, historique des
connexions, journal de sécurité et alertes. Toutes les actions portent sur le compte CONNECTÉ —
un Super Admin ne gère jamais ici les sessions d'un autre."""

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.pagination import DefaultPagination

from . import securite
from .models import AppareilConnu, EvenementSecurite
from .permissions import IsSuperAdmin
from .serializers import (
    AppareilConnuSerializer,
    BasculerOtpSerializer,
    CodeTotpSerializer,
    DesactiverTotpSerializer,
    EvenementSecuriteSerializer,
    MotDePasseSerializer,
    SessionActiveSerializer,
)

T = EvenementSecurite.Type
N = EvenementSecurite.Niveau


class SecuriteViewSet(viewsets.ViewSet):
    permission_classes = [IsSuperAdmin]

    # -- utilitaires ---------------------------------------------------------

    def _sid(self):
        return securite.sid_de_requete(self.request)

    def _verifier_mot_de_passe(self, data, serializer_class=MotDePasseSerializer):
        serializer = serializer_class(data=data)
        serializer.is_valid(raise_exception=True)
        if not self.request.user.check_password(serializer.validated_data["mot_de_passe"]):
            raise ValidationError({"mot_de_passe": "Mot de passe incorrect."})
        return serializer.validated_data

    def _paginer(self, qs, serializer_class):
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(qs, self.request, view=self)
        return paginator.get_paginated_response(serializer_class(page, many=True).data)

    # -- résumé --------------------------------------------------------------

    def list(self, request):
        user = request.user
        # [0] = la connexion en cours ; on montre la précédente (« était-ce bien moi ? »).
        derniere = next(iter(user.evenements_securite.filter(type=T.CONNEXION_REUSSIE)[1:2]), None)
        return Response({
            "totp_actif": user.totp_actif,
            "otp_actif": user.otp_actif,
            "codes_secours_restants": len(user.codes_secours or []) if user.totp_actif else 0,
            "sessions_actives": securite.sessions_actives(user).count(),
            "appareils": user.appareils_connus.count(),
            "alertes_non_lues": user.evenements_securite.filter(lu=False).exclude(niveau=N.INFO).count(),
            "echecs_24h": user.evenements_securite.filter(
                type__in=EvenementSecurite.TYPES_ECHEC, horodatage__gte=timezone.now() - timezone.timedelta(hours=24),
            ).count(),
            "connexion_precedente": EvenementSecuriteSerializer(derniere).data if derniere else None,
            "politique": {
                "max_echecs": securite.MAX_ECHECS,
                "fenetre_minutes": int(securite.FENETRE_ECHECS.total_seconds() // 60),
                "duree_verrouillage_minutes": int(securite.DUREE_VERROUILLAGE.total_seconds() // 60),
            },
        })

    # -- sessions ------------------------------------------------------------

    @action(detail=False, methods=["get"])
    def sessions(self, request):
        qs = securite.sessions_actives(request.user)
        return Response(SessionActiveSerializer(qs, many=True, context={"sid": self._sid()}).data)

    @action(detail=False, methods=["post"], url_path=r"sessions/(?P<session_id>\d+)/revoquer")
    def revoquer_session(self, request, session_id=None):
        session = securite.sessions_actives(request.user).filter(pk=session_id).first()
        if session is None:
            raise ValidationError("Session introuvable ou déjà fermée.")
        session.revoquee_le = timezone.now()
        session.save(update_fields=["revoquee_le"])
        securite.evenement(
            request.user, T.SESSION_REVOQUEE,
            f"Session fermée : {session.appareil_libelle or 'appareil inconnu'} ({session.adresse_ip or 'IP inconnue'})",
            request,
        )
        return Response({"courante": session.sid == self._sid()})

    @action(detail=False, methods=["post"], url_path="sessions/revoquer-toutes")
    def revoquer_toutes(self, request):
        """`inclure_courante=false` (défaut) : toutes les AUTRES sessions ; `true` : partout, y
        compris celle-ci (le frontend se déconnecte alors aussitôt)."""
        inclure = bool(request.data.get("inclure_courante"))
        nb = securite.revoquer_sessions(request.user, sauf_sid=None if inclure else self._sid())
        securite.evenement(
            request.user, T.SESSIONS_REVOQUEES,
            f"{nb} session(s) fermée(s){' (y compris celle-ci)' if inclure else ' (toutes sauf celle-ci)'}",
            request, niveau=N.AVERTISSEMENT,
        )
        return Response({"revoquees": nb})

    # -- appareils -----------------------------------------------------------

    @action(detail=False, methods=["get"])
    def appareils(self, request):
        maintenant = timezone.now()
        qs = request.user.appareils_connus.annotate(
            sessions_actives=Count(
                "sessions", filter=Q(sessions__revoquee_le__isnull=True, sessions__expire_le__gt=maintenant),
            ),
        )
        session = securite.sessions_actives(request.user).filter(sid=self._sid()).first() if self._sid() else None
        contexte = {"appareil_courant": session.appareil_id if session else None}
        return Response(AppareilConnuSerializer(qs, many=True, context=contexte).data)

    @action(detail=False, methods=["post"], url_path=r"appareils/(?P<appareil_id>\d+)/retirer")
    def retirer_appareil(self, request, appareil_id=None):
        """Oublie l'appareil ET ferme ses sessions — une prochaine connexion depuis celui-ci sera
        de nouveau signalée comme inhabituelle."""
        appareil = AppareilConnu.objects.filter(user=request.user, pk=appareil_id).first()
        if appareil is None:
            raise ValidationError("Appareil introuvable.")
        courant = securite.sessions_actives(request.user).filter(sid=self._sid(), appareil=appareil).exists()
        nb = securite.revoquer_sessions(request.user, appareil=appareil)
        securite.evenement(
            request.user, T.APPAREIL_RETIRE,
            f"Appareil retiré : {appareil.libelle or 'inconnu'} — {nb} session(s) fermée(s)", request,
        )
        appareil.delete()
        return Response({"courant": courant})

    # -- historique / journal / alertes --------------------------------------

    @action(detail=False, methods=["get"])
    def connexions(self, request):
        qs = request.user.evenements_securite.filter(type__in=EvenementSecurite.TYPES_CONNEXION)
        resultat = request.query_params.get("resultat")
        if resultat == "succes":
            qs = qs.filter(type=T.CONNEXION_REUSSIE)
        elif resultat == "echec":
            qs = qs.exclude(type=T.CONNEXION_REUSSIE)
        return self._paginer(qs, EvenementSecuriteSerializer)

    @action(detail=False, methods=["get"])
    def journal(self, request):
        qs = request.user.evenements_securite.all()
        niveau = request.query_params.get("niveau")
        if niveau in N.values:
            qs = qs.filter(niveau=niveau)
        if request.query_params.get("alertes") == "1":
            qs = qs.exclude(niveau=N.INFO).filter(lu=False)
        return self._paginer(qs, EvenementSecuriteSerializer)

    @action(detail=False, methods=["post"], url_path="alertes/marquer-lues")
    def marquer_alertes_lues(self, request):
        nb = request.user.evenements_securite.filter(lu=False).update(lu=True)
        return Response({"marquees": nb})

    # -- double authentification ---------------------------------------------

    @action(detail=False, methods=["post"], url_path="totp/initialiser")
    def totp_initialiser(self, request):
        """Génère un nouveau secret (QR code à scanner) — sans encore l'exiger à la connexion :
        il ne le sera qu'après `totp/activer` avec un premier code valide."""
        user = request.user
        if user.totp_actif:
            raise ValidationError("L'application d'authentification est déjà activée. Désactivez-la d'abord pour en changer.")
        self._verifier_mot_de_passe(request.data)
        user.totp_secret = securite.generer_secret_totp()
        user.totp_dernier_pas = None
        user.save(update_fields=["totp_secret", "totp_dernier_pas"])
        uri = securite.uri_totp(user, user.totp_secret)
        return Response({"secret": user.totp_secret, "uri": uri, "qr_code": securite.qr_code_data_uri(uri)})

    @action(detail=False, methods=["post"], url_path="totp/activer")
    def totp_activer(self, request):
        user = request.user
        serializer = CodeTotpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if user.totp_actif:
            raise ValidationError("L'application d'authentification est déjà activée.")
        if not user.totp_secret:
            raise ValidationError("Scannez d'abord le QR code (étape précédente).")
        if not securite.verifier_code_totp(user, serializer.validated_data["code"]):
            raise ValidationError({"code": "Code incorrect — vérifiez l'heure de votre téléphone et réessayez."})
        user.totp_actif = True
        user.save(update_fields=["totp_actif"])
        codes = securite.generer_codes_secours(user)
        securite.evenement(user, T.TOTP_ACTIVE, "Application d'authentification activée", request)
        return Response({"codes_secours": codes})

    @action(detail=False, methods=["post"], url_path="totp/desactiver")
    def totp_desactiver(self, request):
        user = request.user
        donnees = self._verifier_mot_de_passe(request.data, DesactiverTotpSerializer)
        if not user.totp_actif:
            raise ValidationError("L'application d'authentification n'est pas activée.")
        if not securite.verifier_second_facteur_totp(user, donnees["code"], request):
            raise ValidationError({"code": "Code incorrect."})
        securite.desactiver_totp(user)
        securite.evenement(user, T.TOTP_DESACTIVE, "Application d'authentification désactivée", request,
                           niveau=N.AVERTISSEMENT, alerte=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="codes-secours/regenerer")
    def codes_secours_regenerer(self, request):
        user = request.user
        self._verifier_mot_de_passe(request.data)
        if not user.totp_actif:
            raise ValidationError("Activez d'abord l'application d'authentification.")
        codes = securite.generer_codes_secours(user)
        securite.evenement(user, T.CODES_SECOURS_REGENERES, "Codes de secours régénérés (anciens codes invalidés)", request)
        return Response({"codes_secours": codes})

    @action(detail=False, methods=["post"], url_path="otp")
    def basculer_otp(self, request):
        """Code par e-mail/SMS à la connexion — pour le Super Admin, exige le mot de passe (voir
        MeView.patch, qui refuse ce réglage pour ce rôle)."""
        user = request.user
        donnees = self._verifier_mot_de_passe(request.data, BasculerOtpSerializer)
        actif = donnees["actif"]
        if actif and not (user.email or user.phone):
            raise ValidationError("Renseignez d'abord un e-mail ou un téléphone dans votre profil.")
        user.otp_actif = actif
        user.save(update_fields=["otp_actif"])
        if actif:
            securite.evenement(user, T.OTP_ACTIVE, "Code par e-mail/SMS activé", request)
        else:
            securite.evenement(user, T.OTP_DESACTIVE, "Code par e-mail/SMS désactivé", request,
                               niveau=N.AVERTISSEMENT, alerte=True)
        return Response({"otp_actif": user.otp_actif})
