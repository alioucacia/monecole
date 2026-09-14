import csv
from decimal import Decimal, InvalidOperation
from io import BytesIO

from django.conf import settings
from django.core import signing
from django.core.mail import EmailMessage
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.html import format_html_join
from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from xhtml2pdf import pisa

from academics.models import AnneeScolaire, Classe
from accounts.permissions import IsAdminOrTeacherOrReadOnly
from attendance.models import Presence
from people.models import EleveProfile
from people.sms import send_sms, send_whatsapp
from people.views import _classe_pour_annee, _image_data_uri, _mm_px

from .models import Note, Periode
from .serializers import NoteSerializer, PeriodeSerializer


class PeriodeViewSet(viewsets.ModelViewSet):
    """Trimestres/semestres d'une année scolaire (ex: « Trimestre 1 »), gérés depuis
    ParametresEcolePage — libres en nom et en nombre (le modèle n'impose ni 2, ni 3 périodes)."""

    queryset = Periode.objects.select_related("annee_scolaire")
    serializer_class = PeriodeSerializer
    permission_classes = [IsAdminOrTeacherOrReadOnly]
    filterset_fields = ["annee_scolaire"]

    def get_queryset(self):
        return super().get_queryset().filter(annee_scolaire__ecole_id=self.request.user.ecole_id)

    def _valider_annee(self, annee):
        if annee.ecole_id != self.request.user.ecole_id:
            raise ValidationError({"annee_scolaire": "Cette année scolaire n'appartient pas à votre établissement."})

    def perform_create(self, serializer):
        self._valider_annee(serializer.validated_data["annee_scolaire"])
        serializer.save()

    def perform_update(self, serializer):
        annee = serializer.validated_data.get("annee_scolaire") or serializer.instance.annee_scolaire
        self._valider_annee(annee)
        serializer.save()

    def perform_destroy(self, instance):
        nb_notes = instance.notes.count()
        if nb_notes:
            raise ValidationError(
                f"Impossible de supprimer « {instance.nom} » : {nb_notes} note(s) y sont déjà "
                "enregistrées (leur suppression en cascade ferait perdre ces notes définitivement)."
            )
        instance.delete()


class NoteViewSet(viewsets.ModelViewSet):
    queryset = Note.objects.select_related("eleve__user", "matiere", "enseignant", "periode")
    serializer_class = NoteSerializer
    permission_classes = [IsAdminOrTeacherOrReadOnly]
    filterset_fields = {
        "eleve": ["exact"],
        "eleve__classe": ["exact"],
        "matiere": ["exact"],
        "periode": ["exact"],
        "type_evaluation": ["exact"],
    }

    def get_queryset(self):
        qs = super().get_queryset().filter(eleve__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "teacher":
            return qs.filter(matiere__enseignements__enseignant=user).distinct()
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(eleve__parent=user)
        return qs

    def perform_create(self, serializer):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        note = serializer.save()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.NOTE,
            f"Note saisie : {note.eleve.user.get_full_name()} — {note.matiere.nom}", self.request,
        )

    def perform_update(self, serializer):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        note = serializer.save()
        journaliser(
            self.request.user, JournalUtilisateur.Categorie.NOTE,
            f"Note modifiée : {note.eleve.user.get_full_name()} — {note.matiere.nom}", self.request,
        )


# ---------------------------------------------------------------------------
# Calcul des moyennes, appréciations et classements — partagé entre le
# bulletin individuel, la vue "Résultats" de classe et les exports.
# ---------------------------------------------------------------------------

APPRECIATIONS = [
    (Decimal("16"), "Excellent"),
    (Decimal("14"), "Très bien"),
    (Decimal("12"), "Bien"),
    (Decimal("10"), "Assez bien"),
    (Decimal("8"), "Passable"),
]

MENTIONS = [
    (Decimal("16"), "Félicitations"),
    (Decimal("14"), "Encouragements"),
    (Decimal("12"), "Tableau d'honneur"),
    (Decimal("10"), "Passable"),
    (Decimal("8"), "Doit fournir des efforts"),
]


_DEVISE_COULEURS = ["rouge", "jaune", "verte"]


def _devise_html(texte):
    """Colore chaque segment de la devise nationale (ex: « Travail - Justice - Solidarité »,
    séparés par « - ») avec les couleurs du drapeau, dans l'ordre où ils apparaissent — la
    devise étant désormais un champ libre (`Ecole.entete_devise`), on ne peut plus se
    contenter des 3 <span> figés d'origine. Un texte sans « - » (ou avec un autre nombre de
    segments que 3) reste géré : les couleurs tournent simplement sur les segments présents."""
    segments = [s.strip() for s in (texte or "").split(" - ") if s.strip()]
    if not segments:
        return ""
    return format_html_join(
        " - ", '<span class="{}">{}</span>',
        ((_DEVISE_COULEURS[i % 3], segment) for i, segment in enumerate(segments)),
    )


def _appreciation(moyenne):
    if moyenne is None:
        return None
    for seuil, label in APPRECIATIONS:
        if moyenne >= seuil:
            return label
    return "Insuffisant"


def _mention_generale(moyenne):
    if moyenne is None:
        return None
    for seuil, label in MENTIONS:
        if moyenne >= seuil:
            return label
    return "Avertissement — travail insuffisant"


def _moyenne_ponderee(notes):
    """Calcule une moyenne pondérée par coefficient à partir d'une liste de Note."""
    total_points = Decimal("0")
    total_coeff = Decimal("0")
    for note in notes:
        poids = Decimal(note.coefficient)
        total_points += note.valeur * poids
        total_coeff += poids
    if total_coeff == 0:
        return None
    try:
        return round(total_points / total_coeff, 2)
    except InvalidOperation:
        return None


def _matieres_moyennes(eleve, periodes):
    """{Matiere: (moyenne, [Note, ...])} pour un élève sur un ensemble de périodes."""
    notes = Note.objects.filter(eleve=eleve, periode__in=periodes).select_related("matiere")
    par_matiere = {}
    for note in notes:
        par_matiere.setdefault(note.matiere, []).append(note)
    return {matiere: (_moyenne_ponderee(notes_m), notes_m) for matiere, notes_m in par_matiere.items()}


def _moyenne_generale(matieres_moyennes):
    total, coeffs = Decimal("0"), Decimal("0")
    for matiere, (moyenne, _) in matieres_moyennes.items():
        if moyenne is not None:
            total += moyenne * Decimal(matiere.coefficient)
            coeffs += Decimal(matiere.coefficient)
    return round(total / coeffs, 2) if coeffs > 0 else None


def _class_results(classe, periodes):
    """Classement complet d'une classe (moyenne générale + rang) sur un ensemble de périodes."""
    eleves = EleveProfile.objects.filter(classe=classe).select_related("user")
    computed = [(el, _moyenne_generale(_matieres_moyennes(el, periodes))) for el in eleves]
    computed.sort(key=lambda x: (x[1] is None, -(x[1] or Decimal("0"))))

    resultats, rang = [], 0
    for el, moyenne in computed:
        if moyenne is not None:
            rang += 1
        resultats.append({
            "eleve_id": el.id,
            "matricule": el.matricule,
            "nom_complet": el.user.get_full_name(),
            "moyenne_generale": moyenne,
            "rang": rang if moyenne is not None else None,
            "mention": _mention_generale(moyenne),
        })
    return resultats


TYPES_COURS = ("devoir", "interrogation", "projet")
TYPES_COMPO = ("composition",)


def _moyenne_ponderee_par_type(notes, types):
    filtrees = [n for n in notes if n.type_evaluation in types]
    return _moyenne_ponderee(filtrees) if filtrees else None


def _absences_summary(eleve, periodes):
    """Nombre d'absences justifiées/injustifiées et de retards sur la période couverte par le
    bulletin — affiché dans l'encadré récapitulatif du PDF, comme sur un bulletin papier officiel."""
    date_debut = min(p.date_debut for p in periodes)
    date_fin = max(p.date_fin for p in periodes)
    presences = Presence.objects.filter(eleve=eleve, date__gte=date_debut, date__lte=date_fin)
    return {
        "absences_justifiees": presences.filter(statut=Presence.Statut.ABSENT, justifie=True).count(),
        "absences_injustifiees": presences.filter(statut=Presence.Statut.ABSENT, justifie=False).count(),
        "retards": presences.filter(statut=Presence.Statut.RETARD).count(),
    }


def _build_bulletin(eleve, periodes, periode_label):
    matieres_moy = _matieres_moyennes(eleve, periodes)

    matieres_data = []
    for matiere, (moyenne, notes) in matieres_moy.items():
        moyenne_classe = None
        if eleve.classe_id:
            notes_classe = Note.objects.filter(
                eleve__classe_id=eleve.classe_id, matiere=matiere, periode__in=periodes
            ).select_related("eleve")
            par_eleve = {}
            for n in notes_classe:
                par_eleve.setdefault(n.eleve_id, []).append(n)
            moyennes = [m for m in (_moyenne_ponderee(v) for v in par_eleve.values()) if m is not None]
            if moyennes:
                moyenne_classe = round(sum(moyennes) / len(moyennes), 2)

        # Détail Cours / Composition par période — utilisé par le bulletin imprimé (une paire
        # de colonnes par période, comme le format papier habituel dans les écoles guinéennes).
        notes_par_periode = {}
        for n in notes:
            notes_par_periode.setdefault(n.periode_id, []).append(n)
        detail_periodes = []
        for p in periodes:
            notes_p = notes_par_periode.get(p.id, [])
            detail_periodes.append({
                "periode_id": p.id,
                "periode_nom": p.nom,
                "cours": _moyenne_ponderee_par_type(notes_p, TYPES_COURS),
                "compo": _moyenne_ponderee_par_type(notes_p, TYPES_COMPO),
                "moyenne": _moyenne_ponderee(notes_p) if notes_p else None,
            })

        matieres_data.append({
            "matiere_id": matiere.id,
            "matiere_nom": matiere.nom,
            "matiere_couleur": matiere.couleur,
            "coefficient": matiere.coefficient,
            "moyenne": moyenne,
            "moyenne_classe": moyenne_classe,
            "appreciation": _appreciation(moyenne),
            "detail_periodes": detail_periodes,
            "notes": [
                {"id": n.id, "type_evaluation": n.type_evaluation, "valeur": n.valeur,
                 "coefficient": n.coefficient, "date": n.date}
                for n in notes
            ],
        })
    matieres_data.sort(key=lambda m: m["matiere_nom"])

    # Totaux/moyennes de colonne (ligne "TOTAUX"/"MOYENNES" en bas du tableau du bulletin imprimé).
    colonnes_totaux = []
    for i, p in enumerate(periodes):
        cours_total = cours_coeff = compo_total = compo_coeff = Decimal("0")
        for m in matieres_data:
            dp = m["detail_periodes"][i]
            coef = Decimal(m["coefficient"])
            if dp["cours"] is not None:
                cours_total += dp["cours"] * coef
                cours_coeff += coef
            if dp["compo"] is not None:
                compo_total += dp["compo"] * coef
                compo_coeff += coef
        colonnes_totaux.append({
            "periode_nom": p.nom,
            "cours_total": round(cours_total, 2) if cours_coeff else None,
            "cours_moyenne": round(cours_total / cours_coeff, 2) if cours_coeff else None,
            "compo_total": round(compo_total, 2) if compo_coeff else None,
            "compo_moyenne": round(compo_total / compo_coeff, 2) if compo_coeff else None,
        })
    total_coefficient = sum(m["coefficient"] for m in matieres_data)

    moyenne_generale = _moyenne_generale(matieres_moy)

    rang, effectif = None, None
    meilleure_moyenne, moyenne_classe_generale, plus_faible_moyenne = None, None, None
    if eleve.classe_id:
        classement = _class_results(eleve.classe, periodes)
        effectif = len(classement)
        moyennes_valides = [c["moyenne_generale"] for c in classement if c["moyenne_generale"] is not None]
        if moyennes_valides:
            meilleure_moyenne = max(moyennes_valides)
            plus_faible_moyenne = min(moyennes_valides)
            moyenne_classe_generale = round(sum(moyennes_valides) / len(moyennes_valides), 2)
        for entry in classement:
            if entry["eleve_id"] == eleve.id:
                rang = entry["rang"]
                break

    # Récapitulatif période par période (une ligne par période + une ligne "annuelle").
    recap_periodes = []
    for p in periodes:
        moyenne_p = _moyenne_generale(_matieres_moyennes(eleve, [p]))
        rang_p, effectif_p = None, None
        if eleve.classe_id:
            classement_p = _class_results(eleve.classe, [p])
            effectif_p = len(classement_p)
            for entry in classement_p:
                if entry["eleve_id"] == eleve.id:
                    rang_p = entry["rang"]
                    break
        recap_periodes.append({
            "nom": p.nom, "moyenne": moyenne_p, "rang": rang_p,
            "effectif": effectif_p, "appreciation": _appreciation(moyenne_p),
        })

    seuil_admission = Decimal("10")
    bareme_notation = 20
    if eleve.user.ecole_id and getattr(eleve.user.ecole, "parametres", None):
        seuil_admission = eleve.user.ecole.parametres.moyenne_admission
        bareme_notation = eleve.user.ecole.parametres.bareme_notation
    decision = None
    if moyenne_generale is not None:
        if moyenne_generale >= seuil_admission:
            decision = "admis"
        elif moyenne_generale >= seuil_admission - 2:
            decision = "repeche"
        else:
            decision = "redouble"

    modele_bulletin = eleve.user.ecole.modele_bulletin if eleve.user.ecole_id else 1
    # Cadre photo du modèle « Officiel » (5, carré 18×18mm) distinct des 4 autres (portrait
    # 19×23mm) — voir bulletin_pdf.html (`.m5-photo` vs `.photo img`). La photo doit être
    # recadrée pour le bon format, sinon xhtml2pdf l'étire pour remplir le cadre (il ignore
    # silencieusement `object-fit`) et la déforme.
    taille_photo_bulletin = _mm_px(18, 18) if modele_bulletin == 5 else _mm_px(19, 23)
    # La classe de CETTE période (pas forcément celle d'aujourd'hui si l'élève a changé de
    # classe depuis) — un bulletin d'une année passée doit afficher la classe de l'époque.
    classe_periode = _classe_pour_annee(eleve, periodes[0].annee_scolaire) if periodes else eleve.classe

    return {
        "eleve": {
            "id": eleve.id,
            "nom_complet": eleve.user.get_full_name(),
            "matricule": eleve.matricule,
            "classe": classe_periode.nom if classe_periode else None,
            "sexe": eleve.user.sexe,
            "date_naissance": eleve.user.date_of_birth,
        },
        "professeur_principal_nom": (
            classe_periode.professeur_principal.get_full_name()
            if classe_periode and classe_periode.professeur_principal_id else None
        ),
        "ecole_nom": eleve.user.ecole.nom if eleve.user.ecole_id else "Taly-School",
        "ecole_adresse": eleve.user.ecole.adresse if eleve.user.ecole_id else "",
        "ecole_telephone": eleve.user.ecole.telephone if eleve.user.ecole_id else "",
        "ecole_logo_data_uri": (
            _image_data_uri(eleve.user.ecole.logo, _mm_px(17, 17), mode="contain") if eleve.user.ecole_id else None
        ),
        # Personnalisation par le Super Admin (EcoleDetailPage) — voir Ecole.couleur_principale
        # et Ecole.modele_bulletin (1-5, voir Ecole.ModeleDocument).
        "couleur_principale": eleve.user.ecole.couleur_principale if eleve.user.ecole_id else "#14304f",
        "couleur_secondaire": eleve.user.ecole.couleur_secondaire if eleve.user.ecole_id else "#b8860b",
        "modele": modele_bulletin,
        # Codes IRE/DPE/DSEE (renseignés par l'admin de l'école) et barème de notation —
        # utilisés par le modèle « Officiel » du bulletin (voir bulletin_pdf.html).
        "ire": eleve.user.ecole.ire if eleve.user.ecole_id else "",
        "dpe": eleve.user.ecole.dpe if eleve.user.ecole_id else "",
        "dsee": eleve.user.ecole.dsee if eleve.user.ecole_id else "",
        # En-tête institutionnel (ministère(s), pays, devise) — modifiable par l'admin de
        # l'école (ParametresEcolePage) — utilisé par tous les modèles de bulletin.
        "entete_ministere_1": eleve.user.ecole.entete_ministere_1 if eleve.user.ecole_id else "",
        "entete_ministere_2": eleve.user.ecole.entete_ministere_2 if eleve.user.ecole_id else "",
        "entete_republique": eleve.user.ecole.entete_republique if eleve.user.ecole_id else "République de Guinée",
        "entete_devise_html": _devise_html(
            eleve.user.ecole.entete_devise if eleve.user.ecole_id else "Travail - Justice - Solidarité"
        ),
        "bareme_notation": bareme_notation,
        "photo_data_uri": _image_data_uri(eleve.user.photo, taille_photo_bulletin),
        "absences": _absences_summary(eleve, periodes),
        "periode": periode_label,
        "periodes_colonnes": [p.nom for p in periodes],
        "matieres": matieres_data,
        "colonnes_totaux": colonnes_totaux,
        "total_coefficient": total_coefficient,
        "moyenne_generale": moyenne_generale,
        "mention": _mention_generale(moyenne_generale),
        "rang": rang,
        "effectif_classe": effectif,
        "recap_periodes": recap_periodes,
        "meilleure_moyenne": meilleure_moyenne,
        "moyenne_classe_generale": moyenne_classe_generale,
        "plus_faible_moyenne": plus_faible_moyenne,
        "decision": decision,
    }


def _check_bulletin_permission(user, eleve):
    if eleve.user.ecole_id != user.ecole_id:
        raise PermissionDenied("Cet élève n'appartient pas à votre établissement.")
    if user.role == "student" and getattr(user, "eleve_profile", None) != eleve:
        raise PermissionDenied("Vous ne pouvez consulter que votre propre bulletin.")
    if user.role == "parent" and eleve.parent_id != user.id:
        raise PermissionDenied("Vous ne pouvez consulter que le bulletin de vos enfants.")
    if user.role == "teacher":
        enseigne_dans_la_classe = eleve.classe_id and eleve.classe.enseignements.filter(enseignant=user).exists()
        if not enseigne_dans_la_classe:
            raise PermissionDenied("Vous n'enseignez pas dans la classe de cet élève.")


def _resolve_periodes(request):
    """Lit les paramètres 'periode' ou 'annee_scolaire' et renvoie (periodes, label)."""
    return _resolve_periodes_by_ids(
        request.query_params.get("periode"), request.query_params.get("annee_scolaire"),
        ecole_id=request.user.ecole_id,
    )


def _resolve_periodes_by_ids(periode_id, annee_id, ecole_id=None):
    """`ecole_id` restreint la résolution à l'établissement de l'utilisateur — omis uniquement
    pour le lien public signé (BulletinPublicPdfView), où l'élève/période ont déjà été validés
    par un membre du personnel autorisé au moment de la génération du lien."""
    periodes_qs = Periode.objects.select_related("annee_scolaire")
    annees_qs = AnneeScolaire.objects.all()
    if ecole_id is not None:
        periodes_qs = periodes_qs.filter(annee_scolaire__ecole_id=ecole_id)
        annees_qs = annees_qs.filter(ecole_id=ecole_id)

    if periode_id:
        periode = get_object_or_404(periodes_qs, pk=periode_id)
        return [periode], {
            "id": periode.id, "nom": periode.nom,
            "annee_scolaire": periode.annee_scolaire.libelle, "type": "periode",
        }
    if annee_id:
        annee = get_object_or_404(annees_qs, pk=annee_id)
        periodes = list(Periode.objects.filter(annee_scolaire=annee))
        if not periodes:
            raise ValidationError("Aucune période n'est définie pour cette année scolaire.")
        return periodes, {
            "id": annee.id, "nom": f"Année complète {annee.libelle}",
            "annee_scolaire": annee.libelle, "type": "annuel",
        }
    raise ValidationError("Précisez le paramètre 'periode' ou 'annee_scolaire' (bulletin annuel).")


class BulletinView(APIView):
    """Bulletin complet d'un élève : moyennes par matière (+ moyenne de classe et
    appréciation), moyenne générale, mention et rang — pour une période ou l'année entière."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        eleve_id = request.query_params.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile.objects.select_related("user", "classe"), pk=eleve_id)
        _check_bulletin_permission(request.user, eleve)

        periodes, label = _resolve_periodes(request)
        return Response(_build_bulletin(eleve, periodes, label))


def _bulletin_pdf_bytes(bulletin):
    html = render_to_string("grades/bulletin_pdf.html", {"b": bulletin})
    buffer = BytesIO()
    pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
    return buffer.getvalue()


class BulletinPdfView(APIView):
    """Version imprimable (PDF) du bulletin."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        eleve_id = request.query_params.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile.objects.select_related("user", "classe"), pk=eleve_id)
        _check_bulletin_permission(request.user, eleve)

        periodes, label = _resolve_periodes(request)
        bulletin = _build_bulletin(eleve, periodes, label)

        response = HttpResponse(_bulletin_pdf_bytes(bulletin), content_type="application/pdf")
        filename = f"bulletin_{bulletin['eleve']['matricule']}_{label['type']}.pdf"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


# Jeton signé (sans base de données) pour un lien public de téléchargement du bulletin,
# utilisé pour le SMS envoyé au parent. Valable 14 jours.
_BULLETIN_TOKEN_SALT = "bulletin-public-link"
_BULLETIN_TOKEN_MAX_AGE = 60 * 60 * 24 * 14


def _make_bulletin_token(eleve_id, periode_id, annee_id):
    payload = {"eleve": eleve_id}
    if periode_id:
        payload["periode"] = periode_id
    else:
        payload["annee_scolaire"] = annee_id
    return signing.dumps(payload, salt=_BULLETIN_TOKEN_SALT)


class BulletinSendEmailView(APIView):
    """Envoie le bulletin par email (au parent si connu, sinon à l'élève lui-même)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        eleve_id = request.data.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile.objects.select_related("user", "classe", "parent"), pk=eleve_id)
        _check_bulletin_permission(request.user, eleve)

        periodes, label = _resolve_periodes_by_ids(
            request.data.get("periode"), request.data.get("annee_scolaire"), ecole_id=request.user.ecole_id
        )
        bulletin = _build_bulletin(eleve, periodes, label)

        destinataire = (eleve.parent.email if eleve.parent and eleve.parent.email else "") or eleve.user.email
        if not destinataire:
            raise ValidationError("Aucune adresse email n'est disponible pour cet élève ou son parent.")

        email = EmailMessage(
            subject=f"Bulletin scolaire — {bulletin['eleve']['nom_complet']} ({label['nom']})",
            body=(
                f"Bonjour,\n\nVeuillez trouver ci-joint le bulletin de {bulletin['eleve']['nom_complet']} "
                f"pour {label['nom']}.\n\n— Taly-School"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[destinataire],
        )
        email.attach(f"bulletin_{eleve.matricule}.pdf", _bulletin_pdf_bytes(bulletin), "application/pdf")
        email.send(fail_silently=True)

        return Response({"detail": f"Bulletin envoyé par email à {destinataire}."})


class BulletinSendSmsView(APIView):
    """Envoie au parent un SMS contenant un lien public (14 jours) de téléchargement du bulletin."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        eleve_id = request.data.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile.objects.select_related("user", "parent"), pk=eleve_id)
        _check_bulletin_permission(request.user, eleve)

        periode_id = request.data.get("periode")
        annee_id = request.data.get("annee_scolaire")
        periodes, label = _resolve_periodes_by_ids(periode_id, annee_id, ecole_id=request.user.ecole_id)  # valide la sélection avant l'envoi

        telephone = eleve.parent.phone if eleve.parent else ""
        if not telephone:
            raise ValidationError("Aucun numéro de téléphone n'est disponible pour le parent de cet élève.")

        token = _make_bulletin_token(eleve.id, periode_id, annee_id)
        lien = f"{settings.BACKEND_PUBLIC_URL}/api/grades/bulletin/pdf/public/{token}/"
        message = (
            f"Taly-School : le bulletin de {eleve.user.get_full_name()} ({label['nom']}) est disponible ici : "
            f"{lien} (lien valable 14 jours)."
        )
        send_sms(telephone, message)

        return Response({"detail": f"Lien du bulletin envoyé par SMS au {telephone}."})


class BulletinSendWhatsAppView(APIView):
    """Envoie au parent, par WhatsApp, un lien public (14 jours) de téléchargement du bulletin
    — même lien signé que le SMS (voir `_make_bulletin_token`/`BulletinPublicPdfView`), sur le
    canal WhatsApp de Twilio (voir `people.sms.send_whatsapp`)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        eleve_id = request.data.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile.objects.select_related("user", "parent"), pk=eleve_id)
        _check_bulletin_permission(request.user, eleve)

        periode_id = request.data.get("periode")
        annee_id = request.data.get("annee_scolaire")
        periodes, label = _resolve_periodes_by_ids(periode_id, annee_id, ecole_id=request.user.ecole_id)  # valide la sélection avant l'envoi

        telephone = eleve.parent.phone if eleve.parent else ""
        if not telephone:
            raise ValidationError("Aucun numéro de téléphone n'est disponible pour le parent de cet élève.")

        token = _make_bulletin_token(eleve.id, periode_id, annee_id)
        lien = f"{settings.BACKEND_PUBLIC_URL}/api/grades/bulletin/pdf/public/{token}/"
        message = (
            f"Taly-School : le bulletin de {eleve.user.get_full_name()} ({label['nom']}) est disponible ici : "
            f"{lien} (lien valable 14 jours)."
        )
        envoye = send_whatsapp(telephone, message)
        if not envoye:
            raise ValidationError("L'envoi du message WhatsApp a échoué — vérifiez le numéro ou réessayez plus tard.")

        return Response({"detail": f"Lien du bulletin envoyé par WhatsApp au {telephone}."})


class BulletinPublicPdfView(APIView):
    """Téléchargement du bulletin via un lien signé (sans authentification) — utilisé par le SMS."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        try:
            payload = signing.loads(token, salt=_BULLETIN_TOKEN_SALT, max_age=_BULLETIN_TOKEN_MAX_AGE)
        except signing.BadSignature:
            return Response({"detail": "Lien invalide ou expiré."}, status=404)

        eleve = get_object_or_404(EleveProfile.objects.select_related("user", "classe"), pk=payload["eleve"])
        periodes, label = _resolve_periodes_by_ids(payload.get("periode"), payload.get("annee_scolaire"))
        bulletin = _build_bulletin(eleve, periodes, label)

        response = HttpResponse(_bulletin_pdf_bytes(bulletin), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="bulletin_{bulletin["eleve"]["matricule"]}.pdf"'
        return response


def _check_staff_class_access(user, classe):
    if classe.annee_scolaire.ecole_id != user.ecole_id:
        raise PermissionDenied("Cette classe n'appartient pas à votre établissement.")
    if user.role in ("student", "parent"):
        raise PermissionDenied("Accès réservé au personnel de l'école.")
    if user.role == "teacher" and not classe.enseignements.filter(enseignant=user).exists():
        raise PermissionDenied("Vous n'enseignez pas dans cette classe.")


class ResultatsView(APIView):
    """Résultats complets d'une classe (classement) pour une période ou l'année entière."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        classe_id = request.query_params.get("classe")
        if not classe_id:
            raise ValidationError("Le paramètre 'classe' est requis.")
        classe = get_object_or_404(Classe, pk=classe_id)
        _check_staff_class_access(request.user, classe)

        periodes, label = _resolve_periodes(request)
        resultats = _class_results(classe, periodes)
        return Response({
            "classe": {"id": classe.id, "nom": classe.nom},
            "periode": label,
            "effectif": len(resultats),
            "resultats": resultats,
        })


class ResultatsPdfView(APIView):
    """Version imprimable (PDF) du classement complet d'une classe."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        classe_id = request.query_params.get("classe")
        if not classe_id:
            raise ValidationError("Le paramètre 'classe' est requis.")
        classe = get_object_or_404(Classe, pk=classe_id)
        _check_staff_class_access(request.user, classe)

        periodes, label = _resolve_periodes(request)
        resultats = _class_results(classe, periodes)

        moyennes_valides = [r["moyenne_generale"] for r in resultats if r["moyenne_generale"] is not None]
        moyenne_classe = round(sum(moyennes_valides) / len(moyennes_valides), 2) if moyennes_valides else None
        taux_reussite = (
            round(len([m for m in moyennes_valides if m >= 10]) / len(resultats) * 100, 1) if resultats else None
        )

        html = render_to_string("grades/resultats_pdf.html", {
            "classe": classe,
            "periode": label,
            "resultats": resultats,
            "effectif": len(resultats),
            "moyenne_classe": moyenne_classe,
            "taux_reussite": taux_reussite,
            "ecole_nom": request.user.ecole.nom if request.user.ecole_id else "Taly-School",
            "ecole_logo_data_uri": (
                _image_data_uri(request.user.ecole.logo, _mm_px(16, 16), mode="contain")
                if request.user.ecole_id and request.user.ecole.logo else None
            ),
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")

        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="resultats_{classe.nom}.pdf"'
        return response


class AttestationHonneurPdfView(APIView):
    """Attestations d'excellence (PDF) pour les meilleurs élèves d'une classe — un certificat
    par élève, imprimables en une fois. Par défaut, les 3 premiers du classement ; le paramètre
    'rang_max' permet d'étendre la sélection, ou 'eleves' (ids séparés par des virgules) de
    choisir précisément qui reçoit un certificat."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        classe_id = request.query_params.get("classe")
        if not classe_id:
            raise ValidationError("Le paramètre 'classe' est requis.")
        classe = get_object_or_404(Classe, pk=classe_id)
        _check_staff_class_access(request.user, classe)

        periodes, label = _resolve_periodes(request)
        resultats = _class_results(classe, periodes)

        eleves_param = request.query_params.get("eleves")
        if eleves_param:
            ids_choisis = {int(x) for x in eleves_param.split(",") if x.strip()}
            laureats = [r for r in resultats if r["eleve_id"] in ids_choisis]
        else:
            rang_max = int(request.query_params.get("rang_max", 3))
            laureats = [r for r in resultats if r["rang"] is not None and r["rang"] <= rang_max]

        if not laureats:
            raise ValidationError("Aucun élève ne correspond aux critères de sélection.")

        html = render_to_string("grades/attestation_honneur_pdf.html", {
            "classe": classe,
            "periode": label,
            "laureats": laureats,
            "effectif": len(resultats),
            "date_edition": timezone.localdate(),
            "ecole_nom": request.user.ecole.nom if request.user.ecole_id else "Taly-School",
            "ecole_logo_data_uri": (
                _image_data_uri(request.user.ecole.logo, _mm_px(18, 18), mode="contain")
                if request.user.ecole_id and request.user.ecole.logo else None
            ),
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")

        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="attestations_{classe.nom}.pdf"'
        return response


CONSEILS_PAR_NIVEAU = {
    "faible": "En dessous de la moyenne : prévoir un point hebdomadaire avec l'enseignant, reprendre les bases avec les exercices corrigés et s'entraîner sur les évaluations passées.",
    "moyen": "En dessous de la moyenne de la classe : revoir régulièrement le cours, refaire les exercices ratés et solliciter un groupe de révision si disponible.",
    "bon": "Bon niveau, au-dessus de la moyenne de la classe : continuer sur cette lancée et viser l'approfondissement pour progresser vers l'excellence.",
    "aucune_note": "Pas encore de note enregistrée sur cette période.",
}


def _niveau_matiere(moyenne, moyenne_classe):
    if moyenne is None:
        return "aucune_note"
    if moyenne < 10:
        return "faible"
    if moyenne_classe is not None and moyenne < moyenne_classe:
        return "moyen"
    return "bon"


class AnalysePerformanceView(APIView):
    """Analyse matière par matière des points faibles/forts d'un élève, avec des conseils
    concrets pour progresser là où il est en difficulté. Un élève/parent ne peut consulter
    que sa propre analyse (ou celle de son enfant) ; le personnel peut consulter celle de
    n'importe quel élève de son établissement."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        eleve_id = request.query_params.get("eleve")
        if eleve_id:
            eleve = get_object_or_404(EleveProfile, pk=eleve_id)
        elif hasattr(request.user, "eleve_profile"):
            eleve = request.user.eleve_profile
        else:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        _check_bulletin_permission(request.user, eleve)

        periodes, label = _resolve_periodes(request)
        matieres_moy = _matieres_moyennes(eleve, periodes)

        analyse = []
        for matiere, (moyenne, _notes) in matieres_moy.items():
            moyenne_classe = None
            if eleve.classe_id:
                notes_classe = Note.objects.filter(
                    eleve__classe_id=eleve.classe_id, matiere=matiere, periode__in=periodes
                ).select_related("eleve")
                par_eleve = {}
                for n in notes_classe:
                    par_eleve.setdefault(n.eleve_id, []).append(n)
                moyennes_classe = [m for m in (_moyenne_ponderee(v) for v in par_eleve.values()) if m is not None]
                if moyennes_classe:
                    moyenne_classe = round(sum(moyennes_classe) / len(moyennes_classe), 2)

            niveau = _niveau_matiere(moyenne, moyenne_classe)
            analyse.append({
                "matiere_id": matiere.id,
                "matiere_nom": matiere.nom,
                "matiere_couleur": matiere.couleur,
                "moyenne": moyenne,
                "moyenne_classe": moyenne_classe,
                "niveau": niveau,
                "conseil": CONSEILS_PAR_NIVEAU[niveau],
            })
        analyse.sort(key=lambda a: (a["moyenne"] is None, a["moyenne"] if a["moyenne"] is not None else 0))

        return Response({
            "eleve": {"id": eleve.id, "nom_complet": eleve.user.get_full_name()},
            "periode": label,
            "matieres": analyse,
            "points_faibles": [a for a in analyse if a["niveau"] == "faible"][:3],
            "points_forts": [a for a in analyse if a["niveau"] == "bon"][:3],
        })


class ResultatsExportView(APIView):
    """Export CSV des résultats d'une classe (utilisable dans Excel)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        classe_id = request.query_params.get("classe")
        if not classe_id:
            raise ValidationError("Le paramètre 'classe' est requis.")
        classe = get_object_or_404(Classe, pk=classe_id)
        _check_staff_class_access(request.user, classe)

        periodes, label = _resolve_periodes(request)
        resultats = _class_results(classe, periodes)

        response = HttpResponse(content_type="text/csv; charset=utf-8-sig")
        response["Content-Disposition"] = f'attachment; filename="resultats_{classe.nom}.csv"'
        writer = csv.writer(response, delimiter=";")
        writer.writerow(["Rang", "Matricule", "Nom complet", "Moyenne générale /20", "Mention"])
        for r in resultats:
            writer.writerow([
                r["rang"] or "", r["matricule"], r["nom_complet"],
                r["moyenne_generale"] if r["moyenne_generale"] is not None else "", r["mention"] or "",
            ])
        return response
