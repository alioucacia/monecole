import csv
from datetime import date
from decimal import Decimal
from io import BytesIO

from django.db.models import ProtectedError, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from xhtml2pdf import pisa

from accounts.permissions import IsAdmin, IsAdminOrComptabilite, IsAdminOrComptabiliteOrReadOnly
from people.views import _image_data_uri, _mm_px

from .models import CategorieDepense, Depense, Frais, Paiement, TarifClasse, TypeFrais
from .serializers import CategorieDepenseSerializer, DepenseSerializer, FraisSerializer, PaiementSerializer, TarifClasseSerializer, TypeFraisSerializer


def _mois_entre(date_debut, date_fin):
    """Liste des premiers jours de mois entre `date_debut` et `date_fin` (inclus)."""
    mois, courant = [], date_debut.replace(day=1)
    fin = date_fin.replace(day=1)
    while courant <= fin:
        mois.append(courant)
        courant = date(courant.year + 1, 1, 1) if courant.month == 12 else date(courant.year, courant.month + 1, 1)
    return mois


def _calculer_suivi_mensuel(eleve, annee_scolaire):
    """Statut payé/partiel/non payé, mois par mois, des frais mensuels (scolarité...) d'un
    élève sur une année scolaire — se base sur `Paiement.mois` (le mois qu'un paiement couvre),
    à ne pas confondre avec `Paiement.date_paiement` (la date à laquelle il a été encaissé).

    Le montant dû mensuel (`montant_mensuel_du`, somme des `Frais.montant_du` mensuels) tient
    compte de la catégorie de paiement de l'élève et d'une éventuelle réduction fidélité — un
    élève « Fondation 50% » ne doit ainsi que la moitié du tarif standard, un élève exonéré ou
    inscription-seulement rien du tout (aucun mois n'est alors suivi, faute d'obligation à
    respecter). Comme `Frais.montant_du` fige la réduction dès le premier paiement encaissé sur
    le frais (`facteur_applique`), ce montant ne change plus rétroactivement pour un frais déjà
    entamé — un mois déjà soldé au tarif en vigueur au moment du paiement reste soldé même si la
    catégorie de l'élève change ensuite."""
    frais_mensuels = list(Frais.objects.filter(
        eleve=eleve, annee_scolaire=annee_scolaire, type_frais__est_mensuel=True
    ))
    if not frais_mensuels:
        return []

    montant_mensuel_du = sum((f.montant_du for f in frais_mensuels), Decimal("0"))
    if montant_mensuel_du <= 0:
        # Élève exonéré (Fondation gratuite, inscription/réinscription seulement) : aucune
        # obligation mensuelle, donc aucun mois suivi — voir generer_pour_classe() qui, pour la
        # même raison, ne crée même pas de Frais mensuel pour ces élèves.
        return []
    paiements = (
        Paiement.objects.filter(frais__in=frais_mensuels, mois__isnull=False)
        .values("mois").annotate(total=Sum("montant"))
    )
    paye_par_mois = {p["mois"]: p["total"] for p in paiements}

    aujourdhui = date.today()
    fin = min(annee_scolaire.date_fin, aujourdhui)
    if annee_scolaire.date_debut > fin:
        return []

    resultat = []
    for mois in _mois_entre(annee_scolaire.date_debut, fin):
        paye = paye_par_mois.get(mois, Decimal("0"))
        if paye <= 0:
            statut = "non_paye"
        elif paye < montant_mensuel_du:
            statut = "partiel"
        else:
            statut = "paye"
        resultat.append({
            "mois": mois.strftime("%Y-%m"), "montant_du": montant_mensuel_du,
            "montant_paye": paye, "statut": statut,
        })
    return resultat


def _fiche_context(frais: Frais) -> dict:
    return {
        "eleve_nom": frais.eleve.user.get_full_name(),
        "matricule": frais.eleve.matricule,
        "classe": frais.eleve.classe.nom if frais.eleve.classe else None,
        "type_frais": frais.type_frais.nom,
        "annee_scolaire": frais.annee_scolaire.libelle,
        "montant": frais.montant,
        "montant_du": frais.montant_du,
        "montant_paye": frais.montant_paye,
        "solde": frais.solde,
        "statut": frais.statut,
        "date_echeance": frais.date_echeance,
        "paiements": list(frais.paiements.select_related("enregistre_par").order_by("date_paiement")),
    }


def _render_fiches_pdf(fiches: list[dict], titre: str, ecole=None) -> bytes:
    """`ecole` sert à personnaliser le document (logo, couleurs, modèle choisis par le Super
    Admin — voir `Ecole.modele_recu`/`couleur_principale`/`couleur_secondaire`) : toutes les
    fiches d'un même appel appartiennent à la même école (déjà filtrées par `get_queryset()`),
    donc une seule résolution suffit plutôt que de la refaire fiche par fiche."""
    html = render_to_string("payments/fiche_paiement_pdf.html", {
        "fiches": fiches, "titre": titre,
        "ecole_nom": ecole.nom if ecole else "Taly-School",
        "ecole_logo_data_uri": _image_data_uri(ecole.logo, _mm_px(11, 11), mode="contain") if ecole else None,
        "couleur_principale": ecole.couleur_principale if ecole else "#14304f",
        "couleur_secondaire": ecole.couleur_secondaire if ecole else "#b8860b",
        "modele": ecole.modele_recu if ecole else 1,
    })
    buffer = BytesIO()
    pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
    return buffer.getvalue()


class TypeFraisViewSet(viewsets.ModelViewSet):
    queryset = TypeFrais.objects.all()
    serializer_class = TypeFraisSerializer
    permission_classes = [IsAdminOrComptabiliteOrReadOnly]

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)

    def perform_destroy(self, instance):
        # type_frais est protégé (on_delete=PROTECT) tant que des Frais y sont rattachés,
        # pour ne jamais perdre l'historique des paiements déjà encaissés.
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                "Impossible de supprimer ce type de frais : des frais y sont déjà rattachés "
                "(historique de paiements). Vous pouvez le renommer à la place."
            )


class TarifClasseViewSet(viewsets.ModelViewSet):
    """Paramétrage, par classe et par année scolaire, du montant de chaque type de frais —
    ex: la scolarité peut coûter plus cher en Terminale qu'en 6ème. Sert de valeur par défaut
    lors de la création des frais d'un élève (voir `FraisViewSet.generer_pour_classe`)."""

    queryset = TarifClasse.objects.select_related("type_frais", "classe", "annee_scolaire")
    serializer_class = TarifClasseSerializer
    permission_classes = [IsAdminOrComptabilite]
    filterset_fields = {
        "annee_scolaire": ["exact"],
        "classe": ["exact"],
        "classe__niveau": ["exact"],
        "type_frais": ["exact"],
    }

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)

    @action(detail=False, methods=["post"], url_path="definir")
    def definir(self, request):
        """Crée ou met à jour (upsert) le tarif d'un type de frais pour une classe/année — utilisé
        par la grille de paramétrage (une case = un tarif), pour ne pas avoir à distinguer
        création/modification côté frontend."""
        from academics.models import AnneeScolaire, Classe

        type_frais_id = request.data.get("type_frais")
        classe_id = request.data.get("classe")
        annee_id = request.data.get("annee_scolaire")
        montant = request.data.get("montant")
        if not (type_frais_id and classe_id and annee_id and montant not in (None, "")):
            raise ValidationError("Les champs 'type_frais', 'classe', 'annee_scolaire' et 'montant' sont requis.")

        type_frais = get_object_or_404(TypeFrais, pk=type_frais_id, ecole_id=request.user.ecole_id)
        classe = get_object_or_404(Classe, pk=classe_id, annee_scolaire__ecole_id=request.user.ecole_id)
        annee = get_object_or_404(AnneeScolaire, pk=annee_id, ecole_id=request.user.ecole_id)

        tarif, _ = TarifClasse.objects.update_or_create(
            ecole=request.user.ecole, type_frais=type_frais, classe=classe, annee_scolaire=annee,
            defaults={"montant": montant},
        )
        return Response(TarifClasseSerializer(tarif).data)


class CategorieDepenseViewSet(viewsets.ModelViewSet):
    """Catégories de dépense de l'établissement — librement gérées par son administrateur
    (renommer, ajouter, supprimer), contrairement aux choix fixes qu'elles remplacent. Un jeu de
    départ (CATEGORIES_DEPENSE_PAR_DEFAUT) est créé automatiquement à la création de l'école."""

    queryset = CategorieDepense.objects.all()
    serializer_class = CategorieDepenseSerializer
    permission_classes = [IsAdminOrComptabilite]

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)

    def perform_destroy(self, instance):
        # PROTECT sur Depense.categorie : une catégorie déjà utilisée ne doit pas pouvoir
        # disparaître en laissant des dépenses orphelines/sans catégorie.
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                f"Impossible de supprimer « {instance.nom} » : des dépenses y sont déjà rattachées. "
                "Vous pouvez la renommer à la place."
            )


class DepenseViewSet(viewsets.ModelViewSet):
    """Sorties de caisse de l'établissement (hors salaires enseignants) — le pendant de
    `FraisViewSet`/`PaiementViewSet` côté dépenses, alimente le tableau de bord Caisse
    (voir `CaisseView`) et le rapport journalier (simple filtre de date sur cette même vue)."""

    queryset = Depense.objects.select_related("enregistre_par", "categorie")
    serializer_class = DepenseSerializer
    permission_classes = [IsAdminOrComptabilite]
    filterset_fields = {
        "date": ["exact", "gte", "lte"],
        "categorie": ["exact"],
        "mode_paiement": ["exact"],
    }

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole, enregistre_par=self.request.user)

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        qs = self.filter_queryset(self.get_queryset())
        total = qs.aggregate(total=Sum("montant"))["total"] or Decimal("0")
        return Response({"total": total, "nombre": qs.count()})

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """Export CSV des dépenses (respecte les filtres de la liste, ex: ?date__gte=…)."""
        queryset = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8-sig")
        response["Content-Disposition"] = 'attachment; filename="depenses.csv"'
        writer = csv.writer(response, delimiter=";")
        writer.writerow(["Date", "Catégorie", "Motif", "Montant", "Mode de paiement", "Référence", "Responsable", "Enregistré par"])
        for depense in queryset:
            writer.writerow([
                depense.date, depense.categorie.nom, depense.motif, depense.montant,
                depense.get_mode_paiement_display(), depense.reference, depense.responsable,
                depense.enregistre_par.get_full_name() if depense.enregistre_par else "",
            ])
        return response


class CaisseView(APIView):
    """Tableau de bord Caisse : combine les rentrées (paiements élèves) et les sorties (dépenses)
    de l'école sur une période — par défaut aujourd'hui, ce qui couvre directement le rapport
    journalier. `?date_debut=&date_fin=` (YYYY-MM-DD) pour une période personnalisée."""

    permission_classes = [IsAuthenticated, IsAdminOrComptabilite]

    def _periode(self, request):
        aujourdhui = date.today()
        date_debut = request.query_params.get("date_debut")
        date_fin = request.query_params.get("date_fin")
        try:
            debut = date.fromisoformat(date_debut) if date_debut else aujourdhui
            fin = date.fromisoformat(date_fin) if date_fin else aujourdhui
        except ValueError:
            raise ValidationError("Format de date invalide — attendu AAAA-MM-JJ.")
        if debut > fin:
            raise ValidationError("La date de début doit précéder la date de fin.")
        return debut, fin

    def _donnees(self, request):
        """Retourne déjà les rentrées/sorties sous forme de dicts sérialisés (pas les objets
        modèle bruts) : cette même forme sert à la fois à la réponse JSON (`CaisseView.get`) et
        au contexte du template PDF (`CaissePdfView.get`), pour que les deux ne puissent jamais
        diverger — un objet `Paiement`/`Depense` brut n'a pas d'attribut `eleve_nom`/
        `mode_paiement_display` et rendrait ces colonnes silencieusement vides dans le PDF."""
        ecole_id = request.user.ecole_id
        debut, fin = self._periode(request)
        paiements = (
            Paiement.objects.filter(
                frais__eleve__user__ecole_id=ecole_id, date_paiement__gte=debut, date_paiement__lte=fin,
            ).select_related("frais__eleve__user", "frais__type_frais", "enregistre_par").order_by("date_paiement")
        )
        depenses = (
            Depense.objects.filter(ecole_id=ecole_id, date__gte=debut, date__lte=fin)
            .select_related("enregistre_par", "categorie").order_by("date")
        )
        rentrees = [
            {
                "id": p.id, "date": p.date_paiement, "eleve_nom": p.frais.eleve.user.get_full_name(),
                "type_frais_nom": p.frais.type_frais.nom, "montant": p.montant,
                "mode_paiement": p.mode_paiement, "mode_paiement_display": p.get_mode_paiement_display(),
                "reference": p.reference,
                "enregistre_par_nom": p.enregistre_par.get_full_name() if p.enregistre_par else None,
            }
            for p in paiements
        ]
        sorties = [
            {
                "id": d.id, "date": d.date, "categorie": d.categorie_id,
                "categorie_nom": d.categorie.nom, "motif": d.motif, "montant": d.montant,
                "mode_paiement": d.mode_paiement, "mode_paiement_display": d.get_mode_paiement_display(),
                "reference": d.reference, "responsable": d.responsable,
                "enregistre_par_nom": d.enregistre_par.get_full_name() if d.enregistre_par else None,
            }
            for d in depenses
        ]
        total_rentrees = sum((r["montant"] for r in rentrees), Decimal("0"))
        total_sorties = sum((s["montant"] for s in sorties), Decimal("0"))
        return {
            "date_debut": debut, "date_fin": fin,
            "total_rentrees": total_rentrees, "total_sorties": total_sorties,
            "solde": total_rentrees - total_sorties,
            "rentrees": rentrees, "sorties": sorties,
        }

    def get(self, request):
        return Response(self._donnees(request))


class CaissePdfView(APIView):
    """Version imprimable (PDF) du tableau de bord Caisse — le rapport journalier demandé quand
    date_debut = date_fin = aujourd'hui (le réglage par défaut)."""

    permission_classes = [IsAuthenticated, IsAdminOrComptabilite]

    def get(self, request):
        vue = CaisseView()
        donnees = vue._donnees(request)
        ecole = request.user.ecole
        html = render_to_string("payments/caisse_pdf.html", {
            **donnees,
            "ecole_nom": ecole.nom if ecole else "Taly-School",
            "ecole_adresse": ecole.adresse if ecole else "",
            "ecole_telephone": ecole.telephone if ecole else "",
            "ecole_logo_data_uri": _image_data_uri(ecole.logo, _mm_px(16, 16), mode="contain") if ecole and ecole.logo else None,
            "couleur_principale": ecole.couleur_principale if ecole else "#14304f",
            "couleur_secondaire": ecole.couleur_secondaire if ecole else "#b8860b",
            "genere_par": request.user.get_full_name(),
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        nom_fichier = f"rapport_caisse_{donnees['date_debut']}_{donnees['date_fin']}.pdf"
        response["Content-Disposition"] = f'attachment; filename="{nom_fichier}"'
        return response


class FraisViewSet(viewsets.ModelViewSet):
    queryset = Frais.objects.select_related("eleve__user", "type_frais", "annee_scolaire").prefetch_related("paiements")
    serializer_class = FraisSerializer
    permission_classes = [IsAdminOrComptabilite]
    filterset_fields = {
        "eleve": ["exact"],
        "type_frais": ["exact"],
        "annee_scolaire": ["exact"],
        "eleve__classe": ["exact"],
        "eleve__classe__niveau": ["exact"],
        "eleve__classe__cycle": ["exact"],
    }
    # Recherche libre par nom/prénom/matricule de l'élève (onglet Paiements — filtre par
    # classe/nom/niveau demandé par l'établissement).
    search_fields = ["eleve__user__first_name", "eleve__user__last_name", "eleve__matricule"]

    def get_queryset(self):
        qs = super().get_queryset().filter(eleve__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(eleve__parent=user)
        return qs

    def get_permissions(self):
        if self.action in ("list", "retrieve", "fiche_paiement", "suivi_mensuel", "proforma"):
            from rest_framework.permissions import IsAuthenticated
            return [IsAuthenticated()]
        return super().get_permissions()

    def perform_destroy(self, instance):
        # La suppression d'un frais est en CASCADE sur ses paiements (voir Paiement.frais) : un
        # frais déjà payé, même partiellement, ne doit donc jamais être supprimé, sous peine de
        # perdre l'historique d'encaissement. Seul un frais encore intégralement impayé (aucun
        # paiement enregistré dessus) peut l'être — ex: un frais généré par erreur.
        if instance.montant_paye > 0:
            raise ValidationError(
                "Impossible de supprimer ce frais : des paiements y sont déjà enregistrés "
                "(historique de paiements). Seul un frais impayé peut être supprimé."
            )
        instance.delete()

    @action(detail=False, methods=["get"], url_path="suivi-mensuel")
    def suivi_mensuel(self, request):
        """Statut payé/partiel/non payé, mois par mois, des frais mensuels d'un élève
        (ex: scolarité mensuelle) — pour l'année scolaire active, ou celle précisée."""
        from academics.models import AnneeScolaire
        from people.models import EleveProfile

        eleve_id = request.query_params.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile, pk=eleve_id, user__ecole_id=request.user.ecole_id)

        if request.user.role == "student" and getattr(request.user, "eleve_profile", None) != eleve:
            raise ValidationError("Vous ne pouvez consulter que votre propre suivi de paiement.")
        if request.user.role == "parent" and eleve.parent_id != request.user.id:
            raise ValidationError("Vous ne pouvez consulter que le suivi de paiement de vos enfants.")

        annee_id = request.query_params.get("annee_scolaire")
        if annee_id:
            annee = get_object_or_404(AnneeScolaire, pk=annee_id, ecole_id=request.user.ecole_id)
        else:
            annee = AnneeScolaire.objects.filter(ecole_id=request.user.ecole_id, active=True).first()
        if not annee:
            raise ValidationError("Aucune année scolaire active pour votre établissement.")

        return Response({
            "eleve_id": eleve.id, "eleve_nom": eleve.user.get_full_name(),
            "categorie_paiement": eleve.categorie_paiement, "categorie_paiement_display": eleve.get_categorie_paiement_display(),
            "annee_scolaire": annee.libelle, "mois": _calculer_suivi_mensuel(eleve, annee),
        })

    @action(detail=False, methods=["get"], url_path="suivi-mensuel-classe")
    def suivi_mensuel_classe(self, request):
        """Grille de suivi mensuel (payé/partiel/non payé) pour tous les élèves d'une classe —
        vue d'ensemble pour la comptabilité, sans avoir à ouvrir chaque élève."""
        from academics.models import Classe
        from people.models import EleveProfile

        classe_id = request.query_params.get("classe")
        if not classe_id:
            raise ValidationError("Le paramètre 'classe' est requis.")
        classe = get_object_or_404(Classe, pk=classe_id, annee_scolaire__ecole_id=request.user.ecole_id)
        annee = classe.annee_scolaire

        eleves = (
            EleveProfile.objects.filter(classe=classe, actif=True)
            .select_related("user").order_by("user__last_name", "user__first_name")
        )
        data = [
            {
                "eleve_id": e.id, "eleve_nom": e.user.get_full_name(), "matricule": e.matricule,
                "categorie_paiement": e.categorie_paiement, "categorie_paiement_display": e.get_categorie_paiement_display(),
                "mois": _calculer_suivi_mensuel(e, annee),
            }
            for e in eleves
        ]
        return Response({"classe": classe.nom, "annee_scolaire": annee.libelle, "eleves": data})

    @action(detail=False, methods=["post"], url_path="generer-pour-classe")
    def generer_pour_classe(self, request):
        """Génère en masse les frais de tous les élèves actifs d'une classe, pour une ou plusieurs
        types de frais (tous ceux de l'école si non précisé), sur une année scolaire — en reprenant
        le tarif paramétré pour cette classe (`TarifClasse`) si un existe, sinon le montant standard
        du type de frais. N'écrase jamais un frais déjà existant pour (élève, type de frais, année).

        Pour un type de frais mensuel, un élève exonéré de mensualité (Fondation gratuite, ou
        inscription/réinscription seulement — `EleveProfile.facteur_mensualite == 0`) n'a aucun
        frais généré pour ce type : il ne doit rien, inutile de créer une dette fictive qu'il
        faudrait ensuite suivre manuellement. La réduction « Fondation 50% »/fidélité, elle, n'est
        pas figée dans le montant du frais — elle est recalculée à la volée dans le suivi mensuel
        (`_calculer_suivi_mensuel`), pour rester à jour même si la catégorie de l'élève change
        après coup."""
        from academics.models import AnneeScolaire, Classe
        from people.models import EleveProfile

        classe_id = request.data.get("classe")
        annee_id = request.data.get("annee_scolaire")
        date_echeance = request.data.get("date_echeance")
        type_frais_ids = request.data.get("types_frais")  # optionnel : liste d'ids, sinon tous
        if not (classe_id and annee_id and date_echeance):
            raise ValidationError("Les champs 'classe', 'annee_scolaire' et 'date_echeance' sont requis.")

        classe = get_object_or_404(Classe, pk=classe_id, annee_scolaire__ecole_id=request.user.ecole_id)
        annee = get_object_or_404(AnneeScolaire, pk=annee_id, ecole_id=request.user.ecole_id)

        types_qs = TypeFrais.objects.filter(ecole_id=request.user.ecole_id)
        if type_frais_ids:
            types_qs = types_qs.filter(id__in=type_frais_ids)
        types_frais = list(types_qs)
        if not types_frais:
            raise ValidationError("Aucun type de frais à générer.")

        tarifs = {
            t.type_frais_id: t.montant
            for t in TarifClasse.objects.filter(classe=classe, annee_scolaire=annee, type_frais__in=types_frais)
        }

        eleves = list(EleveProfile.objects.filter(classe=classe, actif=True))
        existants = set(
            Frais.objects.filter(eleve__in=eleves, annee_scolaire=annee, type_frais__in=types_frais)
            .values_list("eleve_id", "type_frais_id")
        )

        a_creer = [
            Frais(
                eleve=eleve, type_frais=type_frais, annee_scolaire=annee,
                montant=tarifs.get(type_frais.id, type_frais.montant_standard), date_echeance=date_echeance,
            )
            for eleve in eleves
            for type_frais in types_frais
            if (eleve.id, type_frais.id) not in existants
            and not (type_frais.est_mensuel and eleve.facteur_mensualite == 0)
        ]
        Frais.objects.bulk_create(a_creer)
        return Response({"crees": len(a_creer), "classe": classe.nom, "eleves": len(eleves)})

    @action(detail=True, methods=["get"], url_path="fiche-paiement")
    def fiche_paiement(self, request, pk=None):
        """Fiche de paiement (PDF) d'un élève pour ce frais — accessible à l'élève/parent concerné."""
        frais = self.get_object()
        if frais.montant_paye <= 0:
            raise ValidationError("Aucun paiement n'a encore été enregistré pour cet élève sur ce frais.")
        pdf = _render_fiches_pdf([_fiche_context(frais)], "Fiche de paiement", ecole=frais.eleve.user.ecole)
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="fiche_paiement_{frais.eleve.matricule}.pdf"'
        return response

    @action(detail=False, methods=["get"], url_path="fiches-paiement")
    def fiches_paiement(self, request):
        """Génère en un seul PDF les fiches de paiement de tous les élèves ayant déjà payé
        (respecte les mêmes filtres que la liste : classe, type de frais, année...)."""
        queryset = self.filter_queryset(self.get_queryset())
        fiches = [_fiche_context(f) for f in queryset if f.montant_paye > 0]
        if not fiches:
            raise ValidationError("Aucun élève n'a encore effectué de paiement pour cette sélection.")
        pdf = _render_fiches_pdf(fiches, "Fiches de paiement", ecole=request.user.ecole)
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = 'attachment; filename="fiches_paiement.pdf"'
        return response

    @action(detail=False, methods=["get"], url_path="proforma")
    def proforma(self, request):
        """Facture proforma (PDF) : récapitule tous les frais d'un élève pour une année scolaire
        (montant dû, déjà payé, solde) — un document d'estimation à présenter avant paiement,
        distinct de la « fiche de paiement » (qui documente des paiements déjà encaissés)."""
        from academics.models import AnneeScolaire
        from people.models import EleveProfile

        eleve_id = request.query_params.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile, pk=eleve_id, user__ecole_id=request.user.ecole_id)

        if request.user.role == "student" and getattr(request.user, "eleve_profile", None) != eleve:
            raise ValidationError("Vous ne pouvez consulter que votre propre facture proforma.")
        if request.user.role == "parent" and eleve.parent_id != request.user.id:
            raise ValidationError("Vous ne pouvez consulter que la facture proforma de vos enfants.")

        annee_id = request.query_params.get("annee_scolaire")
        if annee_id:
            annee = get_object_or_404(AnneeScolaire, pk=annee_id, ecole_id=request.user.ecole_id)
        else:
            annee = AnneeScolaire.objects.filter(ecole_id=request.user.ecole_id, active=True).first()
        if not annee:
            raise ValidationError("Aucune année scolaire active pour votre établissement.")

        lignes = list(
            Frais.objects.filter(eleve=eleve, annee_scolaire=annee).select_related("type_frais").order_by("date_echeance")
        )
        if not lignes:
            raise ValidationError("Aucun frais enregistré pour cet élève sur cette année scolaire.")

        total_du = sum((f.montant_du for f in lignes), Decimal("0"))
        total_paye = sum((f.montant_paye for f in lignes), Decimal("0"))

        ecole = eleve.user.ecole
        html = render_to_string("payments/proforma_pdf.html", {
            "eleve": eleve,
            "annee_scolaire": annee.libelle,
            "lignes": lignes,
            "total_du": total_du,
            "total_paye": total_paye,
            "total_solde": total_du - total_paye,
            "date_edition": date.today(),
            "ecole_nom": ecole.nom if ecole else "Taly-School",
            "ecole_adresse": ecole.adresse if ecole else "",
            "ecole_telephone": ecole.telephone if ecole else "",
            "ecole_logo_data_uri": _image_data_uri(ecole.logo, _mm_px(15, 15), mode="contain") if ecole else None,
            "couleur_principale": ecole.couleur_principale if ecole else "#14304f",
            "couleur_secondaire": ecole.couleur_secondaire if ecole else "#b8860b",
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="proforma_{eleve.matricule}_{annee.libelle}.pdf"'
        return response

    @action(detail=False, methods=["get"], url_path="suivi-mensuel-pdf")
    def suivi_mensuel_pdf(self, request):
        """Version imprimable (PDF) du suivi mensuel des paiements de scolarité d'un élève —
        même calcul/permissions que `suivi_mensuel`, en document téléchargeable."""
        from academics.models import AnneeScolaire
        from people.models import EleveProfile

        eleve_id = request.query_params.get("eleve")
        if not eleve_id:
            raise ValidationError("Le paramètre 'eleve' est requis.")
        eleve = get_object_or_404(EleveProfile, pk=eleve_id, user__ecole_id=request.user.ecole_id)

        if request.user.role == "student" and getattr(request.user, "eleve_profile", None) != eleve:
            raise ValidationError("Vous ne pouvez consulter que votre propre suivi de paiement.")
        if request.user.role == "parent" and eleve.parent_id != request.user.id:
            raise ValidationError("Vous ne pouvez consulter que le suivi de paiement de vos enfants.")

        annee_id = request.query_params.get("annee_scolaire")
        if annee_id:
            annee = get_object_or_404(AnneeScolaire, pk=annee_id, ecole_id=request.user.ecole_id)
        else:
            annee = AnneeScolaire.objects.filter(ecole_id=request.user.ecole_id, active=True).first()
        if not annee:
            raise ValidationError("Aucune année scolaire active pour votre établissement.")

        mois = _calculer_suivi_mensuel(eleve, annee)
        total_du = sum((m["montant_du"] for m in mois), Decimal("0"))
        total_paye = sum((m["montant_paye"] for m in mois), Decimal("0"))

        ecole = eleve.user.ecole
        html = render_to_string("payments/suivi_mensuel_pdf.html", {
            "eleve": eleve,
            "annee_scolaire": annee.libelle,
            "mois": mois,
            "total_du": total_du,
            "total_paye": total_paye,
            "total_solde": total_du - total_paye,
            "date_edition": date.today(),
            "ecole_nom": ecole.nom if ecole else "Taly-School",
            "ecole_adresse": ecole.adresse if ecole else "",
            "ecole_telephone": ecole.telephone if ecole else "",
            "ecole_logo_data_uri": _image_data_uri(ecole.logo, _mm_px(15, 15), mode="contain") if ecole and ecole.logo else None,
            "couleur_principale": ecole.couleur_principale if ecole else "#14304f",
            "couleur_secondaire": ecole.couleur_secondaire if ecole else "#b8860b",
        })
        buffer = BytesIO()
        pisa.CreatePDF(html, dest=buffer, encoding="utf-8")
        response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="suivi_mensuel_{eleve.matricule}_{annee.libelle}.pdf"'
        return response

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        qs = self.get_queryset()
        # Sum("montant") sur la requête ne peut pas tenir compte de la réduction (catégorie de
        # paiement/fidélité) : Frais.montant_du n'est pas une colonne mais calculé par élève —
        # boucle Python, comme le fait déjà impayes_par_classe() ci-dessous pour la même raison.
        total_attendu = sum((f.montant_du for f in qs.select_related("eleve", "type_frais")), Decimal("0"))
        total_encaisse = Paiement.objects.filter(frais__in=qs).aggregate(total=Sum("montant"))["total"] or Decimal("0")
        taux = round(float(total_encaisse) / float(total_attendu) * 100, 1) if total_attendu else None
        return Response({
            "total_attendu": total_attendu,
            "total_encaisse": total_encaisse,
            "solde_total": total_attendu - total_encaisse,
            "taux_recouvrement": taux,
        })

    @action(detail=False, methods=["get"], url_path="impayes-par-classe")
    def impayes_par_classe(self, request):
        """Regroupe par classe tous les élèves ayant un solde restant à payer (respecte les
        mêmes filtres que la liste, ex: ?annee_scolaire=…) — et, à côté, ceux qui sont À JOUR
        (au moins un frais, tout réglé) : le comptable/l'administrateur voient les deux d'un
        coup d'œil plutôt que devoir déduire les « bons payeurs » par soustraction."""
        queryset = self.filter_queryset(self.get_queryset()).select_related("eleve__user", "eleve__classe", "type_frais")

        par_eleve: dict[int, dict] = {}
        for frais in queryset:
            entry = par_eleve.setdefault(frais.eleve_id, {
                "eleve": frais.eleve, "du": Decimal("0"), "paye": Decimal("0"),
            })
            entry["du"] += frais.montant_du
            entry["paye"] += frais.montant_paye

        par_classe: dict[int, dict] = {}
        for data in par_eleve.values():
            solde = data["du"] - data["paye"]
            eleve = data["eleve"]
            classe = eleve.classe
            classe_id = classe.id if classe else 0
            groupe = par_classe.setdefault(classe_id, {
                "classe_id": classe_id if classe else None,
                "classe_nom": classe.nom if classe else "Sans classe",
                "eleves": [], "eleves_a_jour": [],
            })
            fiche = {
                "eleve_id": eleve.id, "matricule": eleve.matricule,
                "nom_complet": eleve.user.get_full_name(), "du": data["du"],
                "paye": data["paye"], "solde": solde,
            }
            if solde > 0:
                groupe["eleves"].append(fiche)
            else:
                groupe["eleves_a_jour"].append(fiche)

        resultat = []
        for groupe in par_classe.values():
            groupe["eleves"].sort(key=lambda e: e["nom_complet"])
            groupe["eleves_a_jour"].sort(key=lambda e: e["nom_complet"])
            groupe["nb_impayes"] = len(groupe["eleves"])
            groupe["nb_a_jour"] = len(groupe["eleves_a_jour"])
            groupe["total_solde"] = sum((e["solde"] for e in groupe["eleves"]), Decimal("0"))
            resultat.append(groupe)
        # Une classe entièrement à jour (aucun impayé) reste incluse — comme avant, on n'exclut
        # que les classes sans aucun frais suivi du tout (ni impayé, ni à jour).
        resultat = [g for g in resultat if g["nb_impayes"] or g["nb_a_jour"]]
        resultat.sort(key=lambda g: g["classe_nom"])
        return Response(resultat)

    @action(detail=False, methods=["post"], url_path="notifier-impayes")
    def notifier_impayes(self, request):
        """Envoie immédiatement les rappels de paiement (email + SMS) pour les frais en
        retard de l'école de l'utilisateur connecté."""
        from .notifications import notifier_frais_impayes
        nb = notifier_frais_impayes(ecole_id=request.user.ecole_id)
        return Response({"notifies": nb})

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """Export CSV des frais/paiements (utilisable dans Excel)."""
        queryset = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8-sig")
        response["Content-Disposition"] = 'attachment; filename="frais_paiements.csv"'
        writer = csv.writer(response, delimiter=";")
        writer.writerow(["Élève", "Type de frais", "Tarif standard", "Montant dû", "Payé", "Solde", "Statut", "Échéance"])
        for frais in queryset:
            writer.writerow([
                frais.eleve.user.get_full_name(), frais.type_frais.nom, frais.montant, frais.montant_du,
                frais.montant_paye, frais.solde, frais.statut, frais.date_echeance,
            ])
        return response


class PaiementViewSet(viewsets.ModelViewSet):
    queryset = Paiement.objects.select_related("frais__eleve__user", "enregistre_par")
    serializer_class = PaiementSerializer
    permission_classes = [IsAdminOrComptabilite]
    filterset_fields = ["frais", "mode_paiement"]

    def get_queryset(self):
        qs = super().get_queryset().filter(frais__eleve__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(frais__eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(frais__eleve__parent=user)
        return qs

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            from rest_framework.permissions import IsAuthenticated
            return [IsAuthenticated()]
        if self.action == "destroy":
            # Suppression d'un paiement déjà encaissé : réservée à l'administrateur, même la
            # comptabilité (qui peut pourtant créer des paiements) n'y a pas accès — un paiement
            # supprimé par erreur fausse l'historique et le suivi mensuel de l'élève.
            return [IsAdmin()]
        return super().get_permissions()

    def perform_create(self, serializer):
        from accounts.models import JournalUtilisateur
        from accounts.services import journaliser

        paiement = serializer.save(enregistre_par=self.request.user)

        # Premier paiement sur ce frais : on fige la réduction en vigueur à cet instant (voir
        # Frais.facteur_applique/montant_du) — un changement ultérieur de catégorie de paiement
        # de l'élève n'affectera plus ce frais, la réduction ne s'applique jamais à une somme
        # déjà versée.
        frais = paiement.frais
        if frais.facteur_applique is None and frais.type_frais.est_mensuel:
            frais.facteur_applique = frais.eleve.facteur_mensualite
            frais.save(update_fields=["facteur_applique"])

        journaliser(
            self.request.user, JournalUtilisateur.Categorie.PAIEMENT,
            f"Paiement enregistré : {paiement.frais.eleve.user.get_full_name()} — {paiement.montant}",
            self.request,
        )

    def perform_destroy(self, instance):
        # Symétrique de perform_create() : si ce paiement était le dernier encaissé sur ce frais,
        # on "dégèle" la réduction (le frais suit de nouveau la catégorie courante de l'élève,
        # comme s'il n'avait jamais été payé) plutôt que de garder un gel devenu sans objet.
        frais = instance.frais
        instance.delete()
        if not frais.paiements.exists() and frais.facteur_applique is not None:
            frais.facteur_applique = None
            frais.save(update_fields=["facteur_applique"])
