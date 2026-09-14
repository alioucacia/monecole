import csv
from datetime import date

from django.db.models import Sum
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdmin, IsSuperAdmin
from accounts.serializers import UserSerializer

from .features import FONCTIONNALITES
from .messages_templates import MODELES_MESSAGE
from .models import Ecole, JournalActivite, ModeleMessage, ParametresPlateforme, PaiementEcole, PlanAbonnement
from .serializers import (
    EcoleCreateSerializer,
    EcoleSerializer,
    EcoleUtilisateurSerializer,
    JournalActiviteSerializer,
    ModeleMessageSerializer,
    MonEcoleSerializer,
    PaiementEcoleSerializer,
    ParametresPlateformeSerializer,
    PlanAbonnementSerializer,
    PlateformeBrandingSerializer,
    RechercheGlobaleResultSerializer,
)


def _journaliser(request, action_key, ecole=None, details=""):
    JournalActivite.objects.create(acteur=request.user, action=action_key, ecole=ecole, details=details)


def _premier_du_mois_il_y_a(n_mois: int, depuis: date) -> date:
    """Premier jour du mois situé `n_mois` mois avant `depuis` — sans dépendance externe."""
    mois_total = (depuis.year * 12 + (depuis.month - 1)) - n_mois
    return date(mois_total // 12, mois_total % 12 + 1, 1)


class PlanAbonnementViewSet(viewsets.ModelViewSet):
    """Plans tarifaires proposés aux établissements — gestion réservée au Super Admin."""

    queryset = PlanAbonnement.objects.all()
    serializer_class = PlanAbonnementSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["actif"]


class EcoleViewSet(viewsets.ModelViewSet):
    """Gestion des établissements — réservée au Super Admin de la plateforme."""

    queryset = Ecole.objects.all().prefetch_related("paiements")
    permission_classes = [IsSuperAdmin]
    search_fields = ["nom", "email"]

    def get_serializer_class(self):
        if self.action == "create":
            return EcoleCreateSerializer
        return EcoleSerializer

    def perform_create(self, serializer):
        ecole = serializer.save()
        _journaliser(self.request, JournalActivite.Action.ECOLE_CREEE, ecole, f"Création de « {ecole.nom} »")

    def perform_update(self, serializer):
        etait_actif = serializer.instance.actif
        ecole = serializer.save()
        if etait_actif and not ecole.actif:
            _journaliser(self.request, JournalActivite.Action.ECOLE_SUSPENDUE, ecole)
        elif not etait_actif and ecole.actif:
            _journaliser(self.request, JournalActivite.Action.ECOLE_REACTIVEE, ecole)
        else:
            _journaliser(self.request, JournalActivite.Action.ECOLE_MODIFIEE, ecole, "Profil ou abonnement modifié")

    def perform_destroy(self, instance):
        nom = instance.nom
        # On journalise avant la suppression : le FK `ecole` de cette entrée passera à NULL
        # (SET_NULL) au moment du DELETE, mais le nom reste conservé dans `details`.
        _journaliser(self.request, JournalActivite.Action.ECOLE_SUPPRIMEE, instance, f"Suppression définitive de « {nom} »")
        instance.delete()

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        ecoles = list(self.get_queryset())
        aujourdhui = date.today()

        historique_revenu = []
        for i in range(5, -1, -1):
            mois = _premier_du_mois_il_y_a(i, aujourdhui)
            total = PaiementEcole.objects.filter(mois=mois).aggregate(t=Sum("montant"))["t"] or 0
            historique_revenu.append({"mois": mois.strftime("%Y-%m"), "total": total})

        ecoles_a_surveiller = sorted(
            (
                {"id": e.id, "nom": e.nom, "jours_avant_blocage": e.jours_avant_blocage}
                for e in ecoles if e.statut_abonnement == "en_retard"
            ),
            key=lambda x: x["jours_avant_blocage"],
        )

        revenu_total_encaisse = PaiementEcole.objects.aggregate(t=Sum("montant"))["t"] or 0

        # Croissance de la plateforme : nombre d'écoles inscrites, cumulé mois par mois.
        historique_croissance = []
        for i in range(11, -1, -1):
            mois_libelle = _premier_du_mois_il_y_a(i, aujourdhui)
            fin_du_mois = _premier_du_mois_il_y_a(i - 1, aujourdhui)  # premier jour du mois suivant
            cumul = sum(1 for e in ecoles if e.date_creation < fin_du_mois)
            historique_croissance.append({"mois": mois_libelle.strftime("%Y-%m"), "total": cumul})

        return Response({
            "total_ecoles": len(ecoles),
            "ecoles_actives": sum(1 for e in ecoles if e.actif),
            "ecoles_a_jour": sum(1 for e in ecoles if e.statut_abonnement in ("paye", "en_attente")),
            "ecoles_en_retard": sum(1 for e in ecoles if e.statut_abonnement == "en_retard"),
            "ecoles_bloquees": sum(1 for e in ecoles if e.statut_abonnement in ("bloque", "suspendu")),
            "revenu_mensuel_attendu": sum((e.abonnement_mensuel for e in ecoles if e.actif), start=0),
            "revenu_total_encaisse": revenu_total_encaisse,
            "historique_revenu": historique_revenu,
            "historique_croissance": historique_croissance,
            "ecoles_a_surveiller": ecoles_a_surveiller,
        })

    @action(detail=False, methods=["post"], url_path="relancer-retard")
    def relancer_retard(self, request):
        """Envoie un rappel (email + SMS) à l'administrateur de chaque école en retard de
        paiement, avant qu'elle ne soit bloquée. Retourne le nombre d'écoles relancées."""
        from django.conf import settings
        from django.core.mail import send_mail

        from accounts.models import User
        from people.sms import send_sms

        nb_relances = 0
        for ecole in self.get_queryset():
            if ecole.statut_abonnement != "en_retard":
                continue
            admin = ecole.users.filter(role=User.Role.ADMIN).first()
            if not admin:
                continue
            message = (
                f"Taly-School : l'abonnement de « {ecole.nom} » est en retard de paiement. "
                f"Accès suspendu dans {ecole.jours_avant_blocage} jour(s) sans régularisation. Merci de nous contacter."
            )
            if admin.email:
                send_mail(
                    subject="Taly-School — Abonnement en retard",
                    message=message, from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[admin.email], fail_silently=True,
                )
            if admin.phone:
                send_sms(admin.phone, message)
            _journaliser(request, JournalActivite.Action.RELANCE_ENVOYEE, ecole, f"Relance envoyée à {admin.get_full_name()}")
            nb_relances += 1

        return Response({"relances": nb_relances})

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """Export CSV de toutes les écoles inscrites (utilisable dans Excel)."""
        queryset = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8-sig")
        response["Content-Disposition"] = 'attachment; filename="ecoles.csv"'
        writer = csv.writer(response, delimiter=";")
        writer.writerow(["École", "Email", "Téléphone", "Abonnement mensuel", "Statut", "Utilisateurs", "Date de création"])
        for ecole in queryset:
            writer.writerow([
                ecole.nom, ecole.email, ecole.telephone, ecole.abonnement_mensuel,
                ecole.statut_abonnement, ecole.users.count(), ecole.date_creation,
            ])
        return response

    @action(detail=True, methods=["get"], url_path="stats-detail")
    def stats_detail(self, request, pk=None):
        """Statistiques d'usage propres à une école (élèves, enseignants, classes, finances
        internes) — permet au Super Admin de superviser l'activité réelle, pas seulement
        l'abonnement plateforme."""
        from academics.models import Classe
        from payments.models import Frais, Paiement
        from people.models import EleveProfile, EnseignantProfile

        ecole = self.get_object()
        total_eleves = EleveProfile.objects.filter(user__ecole=ecole, actif=True).count()
        total_enseignants = EnseignantProfile.objects.filter(user__ecole=ecole).count()
        total_classes = Classe.objects.filter(annee_scolaire__ecole=ecole).count()
        total_attendu = Frais.objects.filter(eleve__user__ecole=ecole).aggregate(t=Sum("montant"))["t"] or 0
        total_encaisse = Paiement.objects.filter(frais__eleve__user__ecole=ecole).aggregate(t=Sum("montant"))["t"] or 0

        return Response({
            "total_eleves": total_eleves,
            "total_enseignants": total_enseignants,
            "total_classes": total_classes,
            "total_frais_attendu": total_attendu,
            "total_frais_encaisse": total_encaisse,
        })

    @action(detail=True, methods=["get"], url_path="utilisateurs")
    def utilisateurs(self, request, pk=None):
        """Liste (lecture seule) des comptes d'une école — supervision par le Super Admin."""
        from django.utils import timezone

        from accounts.models import User

        ecole = self.get_object()
        role_labels = dict(User.Role.choices)
        maintenant = timezone.now()
        seuil_en_ligne = maintenant - timezone.timedelta(minutes=User.DELAI_EN_LIGNE_MINUTES)
        utilisateurs = ecole.users.order_by("role", "last_name").values(
            "id", "username", "first_name", "last_name", "role", "is_active", "date_joined",
            "last_login", "derniere_activite",
        )
        data = [
            {
                "id": u["id"], "username": u["username"],
                "full_name": f"{u['first_name']} {u['last_name']}".strip() or u["username"],
                "role": u["role"], "role_display": role_labels.get(u["role"], u["role"]),
                "is_active": u["is_active"], "date_joined": u["date_joined"], "last_login": u["last_login"],
                "en_ligne": bool(u["derniere_activite"] and u["derniere_activite"] >= seuil_en_ligne),
            }
            for u in utilisateurs
        ]
        return Response(EcoleUtilisateurSerializer(data, many=True).data)

    @action(detail=True, methods=["post"], url_path="creer-admin")
    def creer_admin(self, request, pk=None):
        """Crée un compte Administrateur supplémentaire pour cette école — la création d'une
        école (EcoleCreateSerializer) n'en crée qu'un seul au départ ; utile ensuite si l'école
        a besoin d'un second admin, ou pour remplacer un admin dont le compte a été supprimé."""
        from django.contrib.auth import password_validation
        from rest_framework.exceptions import ValidationError

        from tenants.quotas import verifier_quota_plan

        ecole = self.get_object()
        verifier_quota_plan(
            ecole, "limite_administrateurs",
            User.objects.filter(ecole=ecole, role=User.Role.ADMIN).count(),
            "administrateurs",
        )

        champs_requis = ["username", "first_name", "last_name", "password"]
        manquants = [c for c in champs_requis if not request.data.get(c)]
        if manquants:
            raise ValidationError({c: "Ce champ est requis." for c in manquants})

        username = request.data["username"]
        email = request.data.get("email", "")
        # Réutilise les mêmes règles d'unicité (identifiant/email/téléphone) que la création
        # d'un compte classique (UserCreateSerializer), plutôt que les réimplémenter ici.
        erreurs = {}
        if User.objects.filter(username=username).exists():
            erreurs["username"] = "Cet identifiant est déjà utilisé."
        if email and User.objects.filter(email=email).exclude(email="").exists():
            erreurs["email"] = "Cet e-mail est déjà utilisé."
        if erreurs:
            raise ValidationError(erreurs)
        try:
            password_validation.validate_password(request.data["password"])
        except Exception as exc:  # noqa: BLE001 — django.core.exceptions.ValidationError, messages déjà en français
            raise ValidationError({"password": list(getattr(exc, "messages", [str(exc)]))})

        admin = User(
            username=username, email=email,
            first_name=request.data["first_name"], last_name=request.data["last_name"],
            phone=request.data.get("phone", ""), role=User.Role.ADMIN, ecole=ecole,
        )
        admin.set_password(request.data["password"])
        admin.doit_changer_mot_de_passe = True
        admin.save()

        _journaliser(
            request, JournalActivite.Action.ECOLE_MODIFIEE, ecole,
            f"Compte Administrateur « {admin.get_full_name()} » créé pour l'école",
        )
        return Response(UserSerializer(admin).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="se-connecter-comme-admin")
    def se_connecter_comme_admin(self, request, pk=None):
        """Génère des jetons de connexion pour l'administrateur de cette école, afin que le
        Super Admin puisse voir l'application exactement comme lui (support technique).
        L'action est journalisée pour la traçabilité ; le frontend garde de son côté le moyen
        de revenir à la session Super Admin (jetons d'origine conservés côté client)."""
        from accounts.models import User
        from accounts.serializers import UserSerializer
        from rest_framework_simplejwt.tokens import RefreshToken

        ecole = self.get_object()
        admin = ecole.users.filter(role=User.Role.ADMIN, is_active=True).first()
        if not admin:
            from rest_framework.exceptions import NotFound
            raise NotFound("Aucun administrateur actif trouvé pour cette école.")

        refresh = RefreshToken.for_user(admin)
        _journaliser(
            request, JournalActivite.Action.CONNEXION_SUPPORT, ecole,
            f"Connexion en mode support en tant que {admin.get_full_name() or admin.username}",
        )
        return Response({
            "access": str(refresh.access_token), "refresh": str(refresh),
            "user": UserSerializer(admin).data,
        })


class RechercheGlobaleView(APIView):
    """Recherche un compte (élève, enseignant, parent, admin...) par nom, identifiant ou
    email, tous établissements confondus — outil de support pour le Super Admin."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        from django.db.models import Q

        from accounts.models import User

        q = request.query_params.get("q", "").strip()
        if len(q) < 2:
            return Response([])

        role_labels = dict(User.Role.choices)
        resultats = (
            User.objects.filter(
                Q(first_name__icontains=q) | Q(last_name__icontains=q)
                | Q(username__icontains=q) | Q(email__icontains=q)
            )
            .exclude(role=User.Role.SUPERADMIN)
            .select_related("ecole")
            .order_by("last_name", "first_name")[:25]
        )
        data = [
            {
                "id": u.id, "full_name": u.get_full_name() or u.username, "username": u.username,
                "email": u.email, "role": u.role, "role_display": role_labels.get(u.role, u.role),
                "ecole_id": u.ecole_id, "ecole_nom": u.ecole.nom if u.ecole_id else None,
                "is_active": u.is_active, "last_login": u.last_login,
            }
            for u in resultats
        ]
        return Response(RechercheGlobaleResultSerializer(data, many=True).data)


class PaiementEcoleViewSet(viewsets.ModelViewSet):
    """Historique des transactions d'abonnement de toutes les écoles inscrites — réservé
    au Super Admin, qui peut ainsi tracer chaque paiement encaissé, tous établissements confondus."""

    queryset = PaiementEcole.objects.select_related("ecole", "enregistre_par")
    serializer_class = PaiementEcoleSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["ecole", "mode_paiement"]
    ordering_fields = ["mois", "date_paiement", "montant"]

    def perform_create(self, serializer):
        paiement = serializer.save(enregistre_par=self.request.user)
        _journaliser(
            self.request, JournalActivite.Action.PAIEMENT_ENREGISTRE, paiement.ecole,
            f"{paiement.montant} GNF pour {paiement.mois:%m/%Y}",
        )

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """Export CSV de l'historique des transactions (toutes écoles, ou filtré via ?ecole=)."""
        queryset = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8-sig")
        response["Content-Disposition"] = 'attachment; filename="transactions_ecoles.csv"'
        writer = csv.writer(response, delimiter=";")
        writer.writerow(["École", "Mois", "Montant", "Mode de paiement", "Référence", "Date d'encaissement", "Enregistré par"])
        for p in queryset:
            writer.writerow([
                p.ecole.nom, p.mois.strftime("%m/%Y"), p.montant, p.get_mode_paiement_display(),
                p.reference, p.date_paiement, p.enregistre_par.get_full_name() if p.enregistre_par else "",
            ])
        return response

    @action(detail=True, methods=["get"], url_path="facture")
    def facture(self, request, pk=None):
        """Facture/reçu imprimable (PDF) d'un paiement d'abonnement plateforme — pour la
        comptabilité de l'école cliente."""
        from io import BytesIO

        from django.template.loader import render_to_string
        from xhtml2pdf import pisa

        from people.views import _image_data_uri, _mm_px

        paiement = self.get_object()
        plateforme = ParametresPlateforme.charger()
        html = render_to_string("tenants/facture_abonnement_pdf.html", {
            "p": paiement,
            "plateforme_nom": plateforme.nom_plateforme,
            "plateforme_logo_data_uri": _image_data_uri(plateforme.logo, _mm_px(14, 14), mode="contain") if plateforme.logo else None,
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="facture_{paiement.ecole.slug}_{paiement.mois:%Y-%m}.pdf"'
        return response


class JournalActiviteViewSet(viewsets.ReadOnlyModelViewSet):
    """Historique des actions du Super Admin (création/suspension d'école, encaissements...)."""

    queryset = JournalActivite.objects.select_related("acteur", "ecole")
    serializer_class = JournalActiviteSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["ecole", "action"]


class MonEcoleView(APIView):
    """Permet à l'Administrateur d'une école de consulter et paramétrer son propre
    établissement (profil, contact, notation, message d'accueil...). Les champs liés à
    l'abonnement plateforme restent en lecture seule ici (gérés par le Super Admin)."""

    permission_classes = [IsAdmin]

    def get_ecole(self, request):
        if request.user.ecole_id is None:
            from rest_framework.exceptions import NotFound
            raise NotFound("Aucun établissement rattaché à ce compte.")
        return Ecole.objects.select_related("parametres").get(pk=request.user.ecole_id)

    def get(self, request):
        return Response(MonEcoleSerializer(self.get_ecole(request)).data)

    def patch(self, request):
        ecole = self.get_ecole(request)
        serializer = MonEcoleSerializer(ecole, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ModeleMessageViewSet(viewsets.ModelViewSet):
    """Les 5 modèles de message personnalisables de l'école de l'Administrateur connecté (voir
    `tenants.messages_templates.MODELES_MESSAGE`) — créés à la volée avec leur texte par défaut
    au premier accès, pour que la liste soit toujours complète même si rien n'a encore été
    personnalisé. Pas de création/suppression manuelle : les 5 clés sont fixes, seul leur texte
    se modifie (`PATCH`)."""

    serializer_class = ModeleMessageSerializer
    permission_classes = [IsAdmin]
    lookup_field = "cle"
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        ecole = self.request.user.ecole
        existantes = set(ModeleMessage.objects.filter(ecole=ecole).values_list("cle", flat=True))
        manquantes = [
            ModeleMessage(ecole=ecole, cle=cle, sujet=info["sujet_defaut"], contenu=info["contenu_defaut"])
            for cle, info in MODELES_MESSAGE.items() if cle not in existantes
        ]
        if manquantes:
            ModeleMessage.objects.bulk_create(manquantes)
        return ModeleMessage.objects.filter(ecole=ecole).order_by("cle")


class ParametresPlateformeView(APIView):
    """Réglages globaux de la plateforme (section « Paramètres plateforme ») — réservés
    au Super Admin. Un seul enregistrement (singleton), chargé/créé à la volée."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        return Response(ParametresPlateformeSerializer(ParametresPlateforme.charger(), context={"request": request}).data)

    def patch(self, request):
        parametres = ParametresPlateforme.charger()
        serializer = ParametresPlateformeSerializer(parametres, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PlateformeBrandingView(APIView):
    """Nom + logo de la plateforme, publics (aucune authentification requise) — utilisés par la
    page de connexion et la barre latérale de toute l'app, contrairement au reste des réglages
    plateforme (`ParametresPlateformeView`) réservé au Super Admin. Avant l'ajout de cette vue,
    changer le « Nom de la plateforme » n'avait aucun effet visible nulle part : le frontend
    affichait toujours « École Manager » codé en dur, faute d'un moyen de lire ce réglage sans
    être Super Admin."""

    permission_classes = [AllowAny]

    def get(self, request):
        # `context` : sans lui, `logo` (ImageField) sérialise en chemin relatif ("/media/...") au
        # lieu d'une URL absolue — invisible dès que le frontend est servi depuis un autre domaine
        # que l'API (cas de la prod : frontend et api.<domaine> séparés).
        return Response(PlateformeBrandingSerializer(ParametresPlateforme.charger(), context={"request": request}).data)


class FonctionnalitesDisponiblesView(APIView):
    """Registre des fonctionnalités optionnelles activables/désactivables par école (voir
    `tenants.features.FONCTIONNALITES`) — lu par l'écran « Fonctionnalités » d'EcoleDetailPage
    pour construire ses cases à cocher sans dupliquer la liste côté frontend."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        return Response([{"cle": cle, "label": label} for cle, label in FONCTIONNALITES.items()])


class AnnuaireUtilisateursViewSet(viewsets.ReadOnlyModelViewSet):
    """Annuaire de tous les comptes de la plateforme, toutes écoles confondues — pour que
    le Super Admin retrouve/filtre n'importe quel utilisateur (rôle, école, statut...)
    sans avoir à ouvrir la fiche de chaque établissement."""

    queryset = User.objects.select_related("ecole").all()
    serializer_class = UserSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["role", "ecole", "is_active"]
    search_fields = ["username", "first_name", "last_name", "email"]
    ordering_fields = ["date_joined", "last_login", "last_name"]

    def get_queryset(self):
        # `en_ligne` est dérivé de `derniere_activite` (voir User.en_ligne), pas une colonne —
        # non filtrable par `filterset_fields` (django-filter), d'où ce filtre manuel.
        qs = super().get_queryset()
        if self.request.query_params.get("en_ligne") == "true":
            from django.utils import timezone

            seuil = timezone.now() - timezone.timedelta(minutes=User.DELAI_EN_LIGNE_MINUTES)
            qs = qs.filter(derniere_activite__gte=seuil)
        return qs

    @action(detail=True, methods=["post"], url_path="reinitialiser-mot-de-passe")
    def reinitialiser_mot_de_passe(self, request, pk=None):
        """Génère un nouveau mot de passe temporaire pour ce compte, le lui envoie par
        e-mail s'il en a un, et le renvoie au Super Admin (seule occasion de le voir en
        clair — il n'est jamais stocké ni consultable ensuite)."""
        from accounts.services import reinitialiser_mot_de_passe as reinitialiser

        utilisateur = self.get_object()
        if utilisateur.role == User.Role.SUPERADMIN and utilisateur.id != request.user.id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Utilisez « Comptes Super Admin » pour réinitialiser un autre Super Admin.")

        resultat = reinitialiser(utilisateur)

        _journaliser(
            request, JournalActivite.Action.MOT_DE_PASSE_REINITIALISE, utilisateur.ecole,
            f"Mot de passe réinitialisé pour « {utilisateur.get_full_name() or utilisateur.username} » ({utilisateur.get_role_display()})",
        )

        return Response(resultat)
