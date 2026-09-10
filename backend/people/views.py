import base64
import csv
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal
from io import BytesIO

import qrcode
from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from xhtml2pdf import pisa

from academics.models import Classe
from accounts.permissions import (
    IsAdmin,
    IsAdminOrComptabilite,
    IsAdminOrReadOnly,
    IsAdminOrSurveillance,
    IsAdminOrSurveillanceOrReadOnly,
    IsAdminOrTeacherOrReadOnly,
    IsStudent,
)
from tenants.permissions import fonctionnalite_requise

from . import assistant_ia
from .models import (
    AlerteParent, EleveBadge, EleveProfile, EnseignantBadge, EnseignantProfile,
    GroupeRevision, MessageIA, PaieEnseignant, PointageEnseignant,
)
from .serializers import (
    AlerteParentSerializer,
    CategoriePaiementSerializer,
    EleveBadgeSerializer,
    EleveProfileSerializer,
    EleveProfileWriteSerializer,
    EnseignantBadgeSerializer,
    EnseignantProfileSerializer,
    EnseignantProfileWriteSerializer,
    GroupeRevisionSerializer,
    MarquerNonReinscritSerializer,
    MessageIACreateSerializer,
    MessageIASerializer,
    PaieEnseignantSerializer,
    PointageEnseignantSerializer,
    ReinscriptionSerializer,
)


class EleveProfileViewSet(viewsets.ModelViewSet):
    queryset = EleveProfile.objects.select_related("user", "classe", "parent")
    permission_classes = [IsAdminOrReadOnly]
    filterset_fields = ["classe", "actif"]
    search_fields = ["user__first_name", "user__last_name", "matricule"]

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return EleveProfileWriteSerializer
        return EleveProfileSerializer

    def get_queryset(self):
        qs = super().get_queryset().filter(user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student":
            qs = qs.filter(user=user)
        elif user.role == "parent":
            qs = qs.filter(parent=user)
        elif user.role == "teacher":
            qs = qs.filter(classe__enseignements__enseignant=user).distinct()
        cycle = self.request.query_params.get("cycle")
        if cycle:
            qs = qs.filter(classe__cycle=cycle)
        return qs

    def perform_create(self, serializer):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        eleve = serializer.save()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.ELEVE,
            f"Fiche élève créée : {eleve.user.get_full_name()}", self.request,
        )

    def perform_update(self, serializer):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        eleve = serializer.save()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.ELEVE,
            f"Fiche élève modifiée : {eleve.user.get_full_name()}", self.request,
        )

    def perform_destroy(self, instance):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        nom = instance.user.get_full_name()
        instance.delete()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.ELEVE,
            f"Fiche élève supprimée : {nom}", self.request,
        )

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """Export CSV de la liste des élèves (filtrable par classe, comme la liste normale)."""
        queryset = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8-sig")
        response["Content-Disposition"] = 'attachment; filename="eleves.csv"'
        writer = csv.writer(response, delimiter=";")
        writer.writerow(["Matricule", "Nom", "Prénom", "Classe", "Parent", "Email", "Téléphone"])
        for eleve in queryset:
            writer.writerow([
                eleve.matricule, eleve.user.last_name, eleve.user.first_name,
                eleve.classe.nom if eleve.classe else "", eleve.parent.get_full_name() if eleve.parent else "",
                eleve.user.email, eleve.user.phone,
            ])
        return response

    @action(detail=False, methods=["get"], url_path="export-pdf")
    def export_pdf(self, request):
        """Version imprimable (PDF) de la liste des élèves (mêmes filtres que la liste)."""
        queryset = self.filter_queryset(self.get_queryset())

        classe_nom = None
        classe_id = request.query_params.get("classe")
        if classe_id:
            classe = Classe.objects.filter(pk=classe_id).first()
            classe_nom = classe.nom if classe else None

        html = render_to_string("people/eleves_pdf.html", {
            "eleves": queryset,
            "total": queryset.count(),
            "classe_nom": classe_nom,
            "date_generation": timezone.now(),
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")

        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = 'attachment; filename="eleves.pdf"'
        return response

    @action(detail=True, methods=["patch"], url_path="categorie-paiement", permission_classes=[IsAdminOrComptabilite])
    def categorie_paiement(self, request, pk=None):
        """Modifie uniquement la catégorie de paiement (mensualité) et la réduction fidélité d'un
        élève — accessible à la comptabilité sans lui donner un accès en écriture à toute la fiche
        élève (le reste de `EleveProfileViewSet` est réservé à l'admin, voir `IsAdminOrReadOnly`)."""
        eleve = self.get_object()
        serializer = CategoriePaiementSerializer(eleve, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(EleveProfileSerializer(eleve).data)

    @action(detail=True, methods=["get"], url_path="recu-inscription")
    def recu_inscription(self, request, pk=None):
        """Fiche d'inscription (PDF), générée automatiquement à la création d'un élève et
        réimprimable à tout moment. Reprend le(s) frais d'inscription déjà enregistré(s), s'il y en a."""
        eleve = self.get_object()
        ecole = eleve.user.ecole
        frais_inscription = list(
            eleve.frais.select_related("type_frais")
            .filter(type_frais__nom__icontains="inscription")
            .prefetch_related("paiements")
        )
        html = render_to_string("people/recu_inscription_pdf.html", {
            "eleve": eleve,
            "ecole_nom": _ecole_nom(eleve.user),
            "ecole_logo_data_uri": _image_data_uri(ecole.logo) if ecole else None,
            "annee_scolaire": _annee_active_libelle(eleve.user),
            "photo_data_uri": _image_data_uri(eleve.user.photo),
            **_couleurs_ecole(ecole, ecole.modele_fiche_inscription if ecole else 1),
            "frais_inscription": frais_inscription,
            "date_edition": timezone.localdate(),
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="recu_inscription_{eleve.matricule}.pdf"'
        return response

    @action(detail=False, methods=["post"], url_path="reinscription", permission_classes=[IsAdmin])
    def reinscription(self, request):
        """Réinscrit en masse une sélection d'élèves dans une classe (généralement l'année
        suivante), avec création optionnelle d'un frais de réinscription pour chacun."""
        from payments.models import Frais, TypeFrais  # import différé pour éviter une dépendance circulaire

        serializer = ReinscriptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        classe_destination = Classe.objects.select_related("annee_scolaire").filter(
            pk=payload["classe_destination"], annee_scolaire__ecole_id=request.user.ecole_id,
        ).first()
        if not classe_destination:
            raise ValidationError("Classe de destination introuvable dans votre établissement.")

        eleves = list(EleveProfile.objects.filter(
            pk__in=payload["eleves"], user__ecole_id=request.user.ecole_id, actif=True,
        ))
        if len(eleves) != len(set(payload["eleves"])):
            raise ValidationError("Un ou plusieurs élèves sont introuvables ou déjà inactifs.")

        type_frais = None
        if payload.get("type_frais"):
            type_frais = TypeFrais.objects.filter(pk=payload["type_frais"], ecole_id=request.user.ecole_id).first()
            if not type_frais:
                raise ValidationError("Type de frais introuvable dans votre établissement.")

        frais_crees = 0
        for eleve in eleves:
            eleve.classe = classe_destination
            eleve.save(update_fields=["classe"])
            if type_frais and payload.get("montant_frais"):
                Frais.objects.create(
                    eleve=eleve, type_frais=type_frais, annee_scolaire=classe_destination.annee_scolaire,
                    montant=payload["montant_frais"],
                    date_echeance=payload.get("date_echeance_frais") or (date.today() + timedelta(days=30)),
                )
                frais_crees += 1

        return Response({
            "reinscrits": len(eleves), "frais_crees": frais_crees,
            "classe_destination": classe_destination.nom,
        })

    @action(detail=True, methods=["post"], url_path="marquer-non-reinscrit", permission_classes=[IsAdmin])
    def marquer_non_reinscrit(self, request, pk=None):
        """Marque un élève comme ne se réinscrivant pas (parti, changement d'école...)."""
        eleve = self.get_object()
        serializer = MarquerNonReinscritSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        eleve.actif = False
        eleve.date_sortie = date.today()
        eleve.motif_sortie = serializer.validated_data.get("motif", "")
        eleve.save(update_fields=["actif", "date_sortie", "motif_sortie"])
        return Response(EleveProfileSerializer(eleve).data)

    @action(detail=True, methods=["post"], url_path="reactiver", permission_classes=[IsAdmin])
    def reactiver(self, request, pk=None):
        """Réactive un élève précédemment marqué comme non réinscrit."""
        eleve = self.get_object()
        eleve.actif = True
        eleve.date_sortie = None
        eleve.motif_sortie = ""
        eleve.save(update_fields=["actif", "date_sortie", "motif_sortie"])
        return Response(EleveProfileSerializer(eleve).data)


class EnseignantProfileViewSet(viewsets.ModelViewSet):
    queryset = EnseignantProfile.objects.select_related("user")
    permission_classes = [IsAdminOrReadOnly]
    search_fields = ["user__first_name", "user__last_name", "matricule", "specialite"]

    def get_queryset(self):
        return super().get_queryset().filter(user__ecole_id=self.request.user.ecole_id)

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return EnseignantProfileWriteSerializer
        return EnseignantProfileSerializer

    def perform_create(self, serializer):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        enseignant = serializer.save()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.ENSEIGNANT,
            f"Fiche enseignant créée : {enseignant.user.get_full_name()}", self.request,
        )

    def perform_update(self, serializer):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        enseignant = serializer.save()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.ENSEIGNANT,
            f"Fiche enseignant modifiée : {enseignant.user.get_full_name()}", self.request,
        )

    def perform_destroy(self, instance):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        nom = instance.user.get_full_name()
        instance.delete()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.ENSEIGNANT,
            f"Fiche enseignant supprimée : {nom}", self.request,
        )


# ---------------------------------------------------------------------------
# Badges (élèves + enseignants) : carte imprimable (photo + QR) et vérification
# publique du QR par un tiers (ex: agent d'accueil scannant le badge).
# ---------------------------------------------------------------------------

def _qr_png_bytes(text):
    image = qrcode.make(text)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _qr_data_uri(text):
    return f"data:image/png;base64,{base64.b64encode(_qr_png_bytes(text)).decode()}"


def _barcode_data_uri(value):
    """Code128 (scannable) du matricule, affiché sous forme de code-barres sur la carte élève —
    comme sur une carte d'identité scolaire imprimée classique."""
    import barcode
    from barcode.writer import ImageWriter

    code = barcode.get("code128", value, writer=ImageWriter())
    buffer = BytesIO()
    code.write(buffer, options={"write_text": False, "module_height": 9.0, "quiet_zone": 1.0})
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}"


def _image_data_uri(image_field):
    """Convertit un ImageField en data URI base64 pour l'incruster dans un PDF
    (plus fiable que de laisser xhtml2pdf résoudre une URL MEDIA relative)."""
    if not image_field:
        return None
    try:
        image_field.open("rb")
        data = image_field.read()
    except (FileNotFoundError, ValueError):
        return None
    finally:
        try:
            image_field.close()
        except Exception:
            pass
    ext = (image_field.name.rsplit(".", 1)[-1] or "png").lower()
    mime = "jpeg" if ext in ("jpg", "jpeg") else ext
    return f"data:image/{mime};base64,{base64.b64encode(data).decode()}"


def _initials(name):
    parts = [p for p in name.strip().split() if p]
    if not parts:
        return "?"
    return (parts[0][0] + (parts[1][0] if len(parts) > 1 else "")).upper()


def _ecole_nom(user):
    return user.ecole.nom if user.ecole_id else "École Manager"


def _couleurs_ecole(ecole, modele=1):
    """Couleurs + modèle de mise en page personnalisés par le Super Admin pour les documents
    PDF de cette école — voir `Ecole.couleur_principale`/`couleur_secondaire` et les 4 champs
    `Ecole.modele_*` (EcoleDetailPage, onglet Personnalisation). `modele` est un entier 1-4
    (voir `Ecole.ModeleDocument`) déjà résolu par l'appelant pour le document concerné — passer
    `ecole.modele_badge`, `ecole.modele_bulletin`, etc. selon le document généré. Reprend les
    mêmes valeurs par défaut que le modèle quand `ecole` est None."""
    return {
        "couleur_principale": ecole.couleur_principale if ecole else "#14304f",
        "couleur_secondaire": ecole.couleur_secondaire if ecole else "#b8860b",
        "modele": modele,
    }


def _annee_active(user):
    from academics.models import AnneeScolaire
    return AnneeScolaire.objects.filter(ecole_id=user.ecole_id, active=True).first()


def _annee_active_libelle(user):
    annee = _annee_active(user)
    return annee.libelle if annee else ""


def _age(date_naissance):
    if not date_naissance:
        return None
    aujourdhui = date.today()
    age = aujourdhui.year - date_naissance.year
    if (aujourdhui.month, aujourdhui.day) < (date_naissance.month, date_naissance.day):
        age -= 1
    return age


def _sans_accents(texte):
    """Normalise une chaîne (minuscules, sans accents) pour des comparaisons souples,
    ex: détecter un niveau 'Préscolaire' / 'Maternelle' quelle que soit sa saisie exacte."""
    normalise = unicodedata.normalize("NFKD", texte or "")
    return "".join(c for c in normalise if not unicodedata.combining(c)).lower()


def _badge_verify_url(token):
    return f"{settings.FRONTEND_URL}/verifier-badge/{token}"


_CARTES_PAR_LIGNE = 2
_CARTES_PAR_PAGE = 8  # 2 colonnes x 4 lignes


def _grille_badges_html(cartes_html: list[str]) -> str:
    """Arrange des cartes déjà rendues (HTML de `_badge_eleve_card.html`) en pages A4 de
    8 (2 colonnes x 4 lignes), avec un saut de page entre chaque page pleine — voir les
    classes `.grille`/`.carte-cell`/... dans `_badge_eleve_style.html`."""
    pages = []
    for debut_page in range(0, len(cartes_html), _CARTES_PAR_PAGE):
        cartes_page = cartes_html[debut_page:debut_page + _CARTES_PAR_PAGE]
        lignes = ['<tr><td colspan="5" class="marge-haut"></td></tr>']
        for debut_ligne in range(0, len(cartes_page), _CARTES_PAR_LIGNE):
            cartes_ligne = cartes_page[debut_ligne:debut_ligne + _CARTES_PAR_LIGNE]
            # La dernière page peut être incomplète : on complète la ligne avec des
            # cellules vides pour garder la grille alignée (rien n'est imprimé dedans).
            while len(cartes_ligne) < _CARTES_PAR_LIGNE:
                cartes_ligne = [*cartes_ligne, "&nbsp;"]
            cellule_1, cellule_2 = cartes_ligne
            lignes.append(
                f'<tr><td class="marge-page"></td>'
                f'<td class="carte-cell">{cellule_1}</td>'
                f'<td class="colonne-gap"></td>'
                f'<td class="carte-cell">{cellule_2}</td>'
                f'<td class="marge-page"></td></tr>'
                f'<tr><td colspan="5" class="ligne-gap"></td></tr>'
            )
        style = ' style="page-break-before: always;"' if pages else ""
        pages.append(f'<table class="grille"{style}>{"".join(lignes)}</table>')
    return "".join(pages)


def _contexte_badge_eleve(badge):
    """Variables du template de carte élève (badge_eleve_pdf.html / badges_classe_pdf.html)
    pour un badge donné — centralisé pour que le PDF individuel et le PDF groupé par
    classe restent toujours identiques, carte par carte."""
    eleve = badge.eleve
    nom_complet = eleve.user.get_full_name()
    annee = _annee_active(eleve.user)
    ecole = eleve.user.ecole
    return {
        "nom_complet": nom_complet,
        "initiales": _initials(nom_complet),
        "matricule": eleve.matricule,
        "nom_pere": eleve.nom_pere,
        "nom_mere": eleve.nom_mere,
        "date_naissance": eleve.user.date_of_birth.strftime("%d/%m/%Y") if eleve.user.date_of_birth else None,
        "age": _age(eleve.user.date_of_birth),
        "classe": eleve.classe.nom if eleve.classe else None,
        "ecole_nom": _ecole_nom(eleve.user),
        "ecole_adresse": ecole.adresse if ecole else "",
        "ecole_initiale": _initials(_ecole_nom(eleve.user)),
        "logo_data_uri": _image_data_uri(ecole.logo) if ecole else None,
        "annee_scolaire": annee.libelle if annee else "",
        "valid_upto": annee.date_fin.strftime("%d/%m/%Y") if annee else None,
        "photo_data_uri": _image_data_uri(eleve.user.photo),
        "qr_data_uri": _qr_data_uri(_badge_verify_url(badge.qr_token)),
        "barcode_data_uri": _barcode_data_uri(eleve.matricule),
        **_couleurs_ecole(ecole, ecole.modele_badge if ecole else 1),
    }


class EleveBadgeViewSet(viewsets.ModelViewSet):
    queryset = EleveBadge.objects.select_related("eleve__user", "eleve__classe")
    serializer_class = EleveBadgeSerializer
    permission_classes = [IsAdminOrSurveillanceOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset().filter(eleve__user__ecole_id=self.request.user.ecole_id)
        if self.request.user.role == "student":
            return qs.filter(eleve__user=self.request.user)
        if self.request.user.role == "parent":
            return qs.filter(eleve__parent=self.request.user)
        return qs

    @action(detail=True, methods=["get"], url_path="qr")
    def qr(self, request, pk=None):
        badge = self.get_object()
        return HttpResponse(_qr_png_bytes(_badge_verify_url(badge.qr_token)), content_type="image/png")

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        """Badge imprimable au format carte d'identité scolaire (photo, filiation, code-barres
        du matricule, QR de vérification et validité liée à l'année scolaire active)."""
        badge = self.get_object()
        html = render_to_string("people/badge_eleve_pdf.html", _contexte_badge_eleve(badge))
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="badge_{badge.eleve.matricule}.pdf"'
        return response

    @action(detail=False, methods=["get"], url_path="pdf-classe", permission_classes=[IsAdminOrSurveillance])
    def pdf_classe(self, request):
        """Émet en une seule fois (crée le badge s'il manque) puis renvoie en un seul PDF
        imprimable — une carte par page — les badges de tous les élèves actifs d'une classe."""
        classe_id = request.query_params.get("classe")
        if not classe_id:
            raise ValidationError("Le paramètre 'classe' est requis.")
        classe = get_object_or_404(Classe, pk=classe_id, annee_scolaire__ecole_id=request.user.ecole_id)

        eleves = list(
            EleveProfile.objects.filter(classe=classe, actif=True)
            .select_related("user")
            .order_by("user__last_name", "user__first_name")
        )
        if not eleves:
            raise ValidationError("Cette classe n'a aucun élève actif.")

        cartes = []
        for eleve in eleves:
            badge, _created = EleveBadge.objects.get_or_create(eleve=eleve)
            cartes.append(render_to_string("people/_badge_eleve_card.html", _contexte_badge_eleve(badge)))

        html = render_to_string(
            "people/badges_classe_pdf.html",
            {
                "corps": _grille_badges_html(cartes),
                **_couleurs_ecole(classe.annee_scolaire.ecole, classe.annee_scolaire.ecole.modele_badge),
            },
        )
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="badges_{classe.nom}.pdf"'
        return response

    @action(detail=True, methods=["get"], url_path="autorisation-recuperation")
    def autorisation_recuperation(self, request, pk=None):
        """Autorisation de récupération (PDF) — réservée aux élèves du préscolaire/maternelle :
        présentée par le parent/tuteur pour venir chercher l'enfant à l'école."""
        badge = self.get_object()
        eleve = badge.eleve
        niveau = _sans_accents(eleve.classe.niveau if eleve.classe else "")
        if not any(mot in niveau for mot in ("presco", "maternelle", "creche", "garderie")):
            raise ValidationError("Cette autorisation est réservée aux élèves du préscolaire/maternelle.")

        html = render_to_string("people/autorisation_recuperation_pdf.html", {
            "eleve": eleve,
            "parent": eleve.parent,
            "photo_data_uri": _image_data_uri(eleve.user.photo),
            "qr_data_uri": _qr_data_uri(_badge_verify_url(badge.qr_token)),
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="autorisation_recuperation_{eleve.matricule}.pdf"'
        return response


class EnseignantBadgeViewSet(viewsets.ModelViewSet):
    queryset = EnseignantBadge.objects.select_related("enseignant__user")
    serializer_class = EnseignantBadgeSerializer
    permission_classes = [IsAdminOrSurveillanceOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset().filter(enseignant__user__ecole_id=self.request.user.ecole_id)
        if self.request.user.role == "teacher":
            return qs.filter(enseignant__user=self.request.user)
        return qs

    @action(detail=True, methods=["get"], url_path="qr")
    def qr(self, request, pk=None):
        badge = self.get_object()
        return HttpResponse(_qr_png_bytes(_badge_verify_url(badge.qr_token)), content_type="image/png")

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        badge = self.get_object()
        enseignant = badge.enseignant
        nom_complet = enseignant.user.get_full_name()
        html = render_to_string("people/badge_pdf.html", {
            "role_label": "ENSEIGNANT",
            "accent": "enseignant",
            "nom_complet": nom_complet,
            "initiales": _initials(nom_complet),
            "matricule": enseignant.matricule,
            "sous_titre2": enseignant.specialite or "Enseignant",
            "ecole_nom": _ecole_nom(enseignant.user),
            "annee_scolaire": _annee_active_libelle(enseignant.user),
            "photo_data_uri": _image_data_uri(enseignant.user.photo),
            "qr_data_uri": _qr_data_uri(_badge_verify_url(badge.qr_token)),
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="badge_{enseignant.matricule}.pdf"'
        return response


class BadgeVerifyView(APIView):
    """Vérification publique d'un badge à partir du QR scanné (aucune authentification requise)."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        eleve_badge = EleveBadge.objects.select_related("eleve__user", "eleve__classe").filter(qr_token=token).first()
        if eleve_badge:
            eleve = eleve_badge.eleve
            return Response({
                "valide": eleve_badge.actif,
                "type": "eleve",
                "role_label": "Élève",
                "nom_complet": eleve.user.get_full_name(),
                "matricule": eleve.matricule,
                "detail": eleve.classe.nom if eleve.classe else "Classe non assignée",
                "emis_le": eleve_badge.emis_le,
            })

        enseignant_badge = EnseignantBadge.objects.select_related("enseignant__user").filter(qr_token=token).first()
        if enseignant_badge:
            enseignant = enseignant_badge.enseignant
            return Response({
                "valide": enseignant_badge.actif,
                "type": "enseignant",
                "role_label": "Enseignant",
                "nom_complet": enseignant.user.get_full_name(),
                "matricule": enseignant.matricule,
                "detail": enseignant.specialite or "École Manager",
                "emis_le": enseignant_badge.emis_le,
            })

        return Response({"valide": False, "detail": "Badge introuvable."}, status=404)


# ---------------------------------------------------------------------------
# Pointage enseignant : auto-pointage depuis le portail (arrivée / départ).
# ---------------------------------------------------------------------------

class PointageEnseignantViewSet(viewsets.ModelViewSet):
    queryset = PointageEnseignant.objects.select_related("enseignant__user")
    serializer_class = PointageEnseignantSerializer

    def get_permissions(self):
        # Seul un admin ou la surveillance générale peut créer/modifier/supprimer un pointage
        # "à la main" (correction). Les enseignants pointent uniquement via les actions dédiées.
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAdminOrSurveillance()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = super().get_queryset().filter(enseignant__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        # La comptabilité voit les pointages de tous les enseignants (lecture seule — voir
        # get_permissions ci-dessus, seuls admin/surveillance peuvent créer/corriger un pointage)
        # : elle en a besoin pour la paie au taux horaire, calculée sur ces pointages réels.
        if user.role in ("admin", "surveillance", "comptabilite"):
            return qs
        if user.role == "teacher":
            return qs.filter(enseignant__user=user)
        return qs.none()

    @staticmethod
    def _own_profile_or_403(request):
        profile = getattr(request.user, "enseignant_profile", None)
        if not profile:
            raise PermissionDenied("Réservé aux enseignants.")
        return profile

    @action(detail=False, methods=["get"], url_path="today")
    def today(self, request):
        """Renvoie le pointage du jour de l'enseignant connecté (ou null)."""
        profile = self._own_profile_or_403(request)
        pointage = PointageEnseignant.objects.filter(enseignant=profile, date=timezone.localdate()).first()
        return Response(PointageEnseignantSerializer(pointage).data if pointage else None)

    @action(detail=False, methods=["post"], url_path="check-in")
    def check_in(self, request):
        """Pointage d'arrivée : un clic depuis le portail enseignant."""
        profile = self._own_profile_or_403(request)
        now = timezone.localtime()
        statut = (
            PointageEnseignant.Statut.RETARD
            if now.time() > settings.HEURE_LIMITE_PONCTUALITE
            else PointageEnseignant.Statut.PRESENT
        )
        pointage, _ = PointageEnseignant.objects.update_or_create(
            enseignant=profile, date=now.date(),
            defaults={"heure_arrivee": now.time(), "statut": statut},
        )
        return Response(PointageEnseignantSerializer(pointage).data)

    @action(detail=False, methods=["post"], url_path="check-out")
    def check_out(self, request):
        """Pointage de départ."""
        profile = self._own_profile_or_403(request)
        pointage = PointageEnseignant.objects.filter(enseignant=profile, date=timezone.localdate()).first()
        if not pointage:
            raise ValidationError("Aucun pointage d'arrivée n'a été enregistré aujourd'hui.")
        pointage.heure_depart = timezone.localtime().time()
        pointage.save(update_fields=["heure_depart"])
        return Response(PointageEnseignantSerializer(pointage).data)


# ---------------------------------------------------------------------------
# Paie enseignant : fiches mensuelles gérées par l'administration.
# ---------------------------------------------------------------------------

def _mois_bounds(mois):
    """(premier jour, dernier jour) du mois de `mois` (une date quelconque du mois suffit)."""
    debut = mois.replace(day=1)
    fin = date(debut.year + 1, 1, 1) if debut.month == 12 else date(debut.year, debut.month + 1, 1)
    return debut, fin - timedelta(days=1)


def _heures_pointees(enseignant, mois):
    """Total d'heures effectivement travaillées par cet enseignant sur le mois de `mois`,
    calculé à partir de ses pointages réels (arrivée/départ) — utilisé pour la paie au taux
    horaire : les enseignants sans salaire fixe sont payés selon le temps réellement passé à
    l'école, pas une estimation. Les jours sans arrivée ET départ enregistrés (pointage oublié,
    absence...) ne comptent pas — ils devront être ajustés manuellement si besoin (via `primes`/
    `retenues`, ou en corrigeant le nombre d'heures avant d'enregistrer la fiche)."""
    debut, fin = _mois_bounds(mois)
    pointages = PointageEnseignant.objects.filter(
        enseignant=enseignant, date__gte=debut, date__lte=fin,
        heure_arrivee__isnull=False, heure_depart__isnull=False,
    )
    total = Decimal("0")
    jours_comptes = 0
    for p in pointages:
        delta = datetime.combine(date.min, p.heure_depart) - datetime.combine(date.min, p.heure_arrivee)
        heures = Decimal(delta.total_seconds()) / Decimal(3600)
        if heures > 0:
            total += heures
            jours_comptes += 1
    return round(total, 2), jours_comptes


class PaieEnseignantViewSet(viewsets.ModelViewSet):
    queryset = PaieEnseignant.objects.select_related("enseignant__user")
    serializer_class = PaieEnseignantSerializer

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAdminOrComptabilite()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = super().get_queryset().filter(enseignant__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role in ("admin", "comptabilite"):
            return qs
        if user.role == "teacher":
            return qs.filter(enseignant__user=user)
        return qs.none()

    def _appliquer_heures_pointees(self, serializer, is_create):
        """Si le mode de calcul est « taux horaire » et qu'aucun nombre d'heures n'a été saisi à
        la main dans CETTE requête, le calcule à partir des pointages réels — filet de sécurité
        côté serveur, en plus du calcul déjà proposé au frontend au moment de la saisie.

        `"nombre_heures" not in data` (plutôt que `not data.get(...)`) est important : sur une
        mise à jour partielle qui ne touche ni le mode de calcul ni les heures (ex: cocher
        « payée »), `nombre_heures` est absent de `validated_data` — il ne faut alors surtout
        pas recalculer et écraser silencieusement une valeur déjà saisie/ajustée à la main."""
        data = serializer.validated_data
        veut_auto_calc = (
            data.get("mode_calcul") == PaieEnseignant.ModeCalcul.HORAIRE
            and "nombre_heures" not in data
            and (is_create or "mode_calcul" in data)
        )
        if veut_auto_calc:
            enseignant = data.get("enseignant") or serializer.instance.enseignant
            mois = data.get("mois") or serializer.instance.mois
            heures, _ = _heures_pointees(enseignant, mois)
            serializer.save(nombre_heures=heures)
        else:
            serializer.save()

    def perform_create(self, serializer):
        self._appliquer_heures_pointees(serializer, is_create=True)

    def perform_update(self, serializer):
        self._appliquer_heures_pointees(serializer, is_create=False)

    @action(detail=False, methods=["get"], url_path="heures-pointees")
    def heures_pointees(self, request):
        """Total d'heures pointées par un enseignant sur un mois donné — utilisé par le
        formulaire de fiche de paie pour pré-remplir « Heures enseignées » à partir des vrais
        pointages plutôt que de laisser la comptabilité les compter à la main."""
        enseignant_id = request.query_params.get("enseignant")
        mois_str = request.query_params.get("mois")
        if not (enseignant_id and mois_str):
            raise ValidationError("Les paramètres 'enseignant' et 'mois' (AAAA-MM-JJ) sont requis.")

        enseignant = get_object_or_404(
            EnseignantProfile, pk=enseignant_id, user__ecole_id=request.user.ecole_id,
        )
        if request.user.role == "teacher" and enseignant.user_id != request.user.id:
            raise ValidationError("Vous ne pouvez consulter que vos propres heures pointées.")
        try:
            mois = date.fromisoformat(mois_str)
        except ValueError:
            raise ValidationError("Format de 'mois' invalide — attendu AAAA-MM-JJ.")

        heures, jours_comptes = _heures_pointees(enseignant, mois)
        return Response({"heures": heures, "jours_pointes": jours_comptes})

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        """Fiche de paie imprimable (PDF)."""
        paie = self.get_object()
        ecole = paie.enseignant.user.ecole
        context = {
            "paie": paie,
            "ecole_nom": ecole.nom if ecole else "École Manager",
            "ecole_adresse": ecole.adresse if ecole else "",
            "ecole_telephone": ecole.telephone if ecole else "",
            "ecole_logo_data_uri": _image_data_uri(ecole.logo) if ecole else None,
            **_couleurs_ecole(ecole),
        }
        html = render_to_string("people/fiche_paie_pdf.html", context)
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        filename = f"paie_{paie.enseignant.matricule}_{paie.mois:%Y-%m}.pdf"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


# ---------------------------------------------------------------------------
# Groupes de révision : créés par un enseignant, visibles par ses élèves.
# ---------------------------------------------------------------------------

class GroupeRevisionViewSet(viewsets.ModelViewSet):
    queryset = GroupeRevision.objects.select_related("enseignant", "matiere", "classe").prefetch_related("eleves")
    serializer_class = GroupeRevisionSerializer
    permission_classes = [IsAdminOrTeacherOrReadOnly, fonctionnalite_requise("groupes_revision")]

    def get_queryset(self):
        qs = super().get_queryset().filter(enseignant__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student":
            return qs.filter(actif=True).filter(Q(eleves__user=user) | Q(classe__eleves__user=user)).distinct()
        if user.role == "parent":
            return qs.filter(actif=True, eleves__parent=user).distinct()
        if user.role == "teacher":
            return qs.filter(enseignant=user)
        return qs  # admin : voit tout, y compris les groupes archivés

    def perform_create(self, serializer):
        serializer.save(enseignant=self.request.user)


class AlerteParentViewSet(viewsets.ReadOnlyModelViewSet):
    """Journal des alertes d'absences répétées — consultable par le parent concerné,
    l'élève concerné, les enseignants de sa classe, et l'administration."""

    queryset = AlerteParent.objects.select_related("parent", "eleve__user")
    serializer_class = AlerteParentSerializer

    def get_queryset(self):
        qs = super().get_queryset().filter(eleve__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "admin":
            return qs
        if user.role == "parent":
            return qs.filter(parent=user)
        if user.role == "student":
            return qs.filter(eleve__user=user)
        if user.role == "teacher":
            return qs.filter(eleve__classe__enseignements__enseignant=user).distinct()
        return qs.none()


# ---------------------------------------------------------------------------
# Assistant IA élève : discussion pour aider l'élève à s'améliorer là où il
# est en difficulté (voir people/assistant_ia.py pour le détail simulé/réel).
# ---------------------------------------------------------------------------

class AssistantIAView(APIView):
    """Réservé à l'élève lui-même : consulte et alimente sa propre conversation avec
    l'assistant IA de révision."""

    permission_classes = [IsStudent, fonctionnalite_requise("assistant_ia")]

    def _own_profile(self, request):
        profile = getattr(request.user, "eleve_profile", None)
        if not profile:
            raise PermissionDenied("Aucun profil élève associé à ce compte.")
        return profile

    def get(self, request):
        eleve = self._own_profile(request)
        historique = MessageIA.objects.filter(eleve=eleve).order_by("cree_le")[:100]
        return Response(MessageIASerializer(historique, many=True).data)

    def post(self, request):
        eleve = self._own_profile(request)
        serializer = MessageIACreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.validated_data["message"]

        message_user = MessageIA.objects.create(eleve=eleve, role=MessageIA.Role.USER, contenu=message)
        reponse = assistant_ia.repondre(eleve, message)
        message_assistant = MessageIA.objects.create(eleve=eleve, role=MessageIA.Role.ASSISTANT, contenu=reponse)

        return Response({
            "message": MessageIASerializer(message_user).data,
            "reponse": MessageIASerializer(message_assistant).data,
        }, status=201)
