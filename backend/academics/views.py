from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminOrReadOnly, IsAdminOrSurveillanceReadWriteNoDelete, IsAdminOrTeacherOrReadOnly

from .models import AnneeScolaire, ChapitreProgramme, Classe, Creneau, Enseignement, Matiere, deviner_cycle
from .serializers import (
    ChapitreProgrammeSerializer,
    AnneeScolaireSerializer,
    ClasseSerializer,
    CreneauSerializer,
    EnseignementSerializer,
    MatiereSerializer,
)


class AnneeScolaireViewSet(viewsets.ModelViewSet):
    queryset = AnneeScolaire.objects.all()
    serializer_class = AnneeScolaireSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)


class MatiereViewSet(viewsets.ModelViewSet):
    queryset = Matiere.objects.all()
    serializer_class = MatiereSerializer
    permission_classes = [IsAdminOrSurveillanceReadWriteNoDelete]
    search_fields = ["nom", "code"]

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)


class ClasseViewSet(viewsets.ModelViewSet):
    queryset = Classe.objects.select_related("annee_scolaire", "professeur_principal")
    serializer_class = ClasseSerializer
    permission_classes = [IsAdminOrSurveillanceReadWriteNoDelete]
    filterset_fields = ["annee_scolaire", "niveau", "cycle"]
    search_fields = ["nom", "niveau"]

    def get_queryset(self):
        qs = super().get_queryset().filter(annee_scolaire__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "teacher":
            # Un enseignant voit les classes où il enseigne ou dont il est le PP
            return qs.filter(
                models_q_teacher(user)
            ).distinct()
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(pk=user.eleve_profile.classe_id)
        if user.role == "parent":
            enfants_classes = [e.classe_id for e in user.enfants.all()]
            return qs.filter(pk__in=enfants_classes)
        return qs

    @action(detail=False, methods=["post"], url_path="deviner-cycles")
    def deviner_cycles(self, request):
        """Redevine le cycle (Préscolaire/Primaire/Collège/Lycée) de chaque classe de
        l'école à partir de son niveau — n'écrase que les classes sans cycle défini,
        sauf `?forcer=true` qui redevine aussi celles déjà affectées manuellement."""
        forcer = request.query_params.get("forcer") == "true"
        classes = self.get_queryset() if forcer else self.get_queryset().filter(cycle="")
        modifiees = 0
        for classe in classes:
            devine = deviner_cycle(classe.niveau)
            if devine and devine != classe.cycle:
                classe.cycle = devine
                classe.save(update_fields=["cycle"])
                modifiees += 1
        return Response({"classes_affectees": modifiees})


def models_q_teacher(user):
    return Q(professeur_principal=user) | Q(enseignements__enseignant=user)


class EnseignementViewSet(viewsets.ModelViewSet):
    queryset = Enseignement.objects.select_related("enseignant", "matiere", "classe")
    serializer_class = EnseignementSerializer
    # Affectation classe+matière à un professeur : admin et surveillance générale peuvent
    # affecter/modifier, seul l'admin peut retirer une affectation (voir ClassesPage.tsx →
    # ClassDetailModal, section "Enseignements affectés").
    permission_classes = [IsAdminOrSurveillanceReadWriteNoDelete]
    filterset_fields = ["classe", "matiere", "enseignant"]

    def get_queryset(self):
        qs = super().get_queryset().filter(classe__annee_scolaire__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "teacher":
            return qs.filter(enseignant=user)
        return qs


class CreneauViewSet(viewsets.ModelViewSet):
    queryset = Creneau.objects.select_related("classe", "enseignement__matiere", "enseignement__enseignant")
    serializer_class = CreneauSerializer
    permission_classes = [IsAdminOrTeacherOrReadOnly]
    filterset_fields = ["classe", "jour", "enseignement"]

    def get_queryset(self):
        qs = super().get_queryset().filter(classe__annee_scolaire__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "teacher":
            return qs.filter(enseignement__enseignant=user)
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(classe=user.eleve_profile.classe)
        if user.role == "parent":
            enfants_classes = [e.classe_id for e in user.enfants.all()]
            return qs.filter(classe_id__in=enfants_classes)
        return qs


class ChapitreProgrammeViewSet(viewsets.ModelViewSet):
    """Programme (liste de chapitres) de chaque matière dans chaque classe, et son avancement.
    Lecture : tout utilisateur de l'école. Écriture : l'administrateur, ou l'enseignant qui
    enseigne cette matière dans cette classe (voir Enseignement) — c'est lui qui coche les
    chapitres au fil de l'année. Le Directeur Général suit en lecture seule."""

    serializer_class = ChapitreProgrammeSerializer
    filterset_fields = ["classe", "matiere", "statut"]

    def get_queryset(self):
        return ChapitreProgramme.objects.select_related("classe", "matiere", "realise_par").filter(
            classe__annee_scolaire__ecole_id=self.request.user.ecole_id,
        )

    def get_permissions(self):
        from rest_framework.permissions import IsAuthenticated

        from accounts.permissions import IsAdminOrTeacher

        if self.action in ("list", "retrieve", "avancement"):
            return [IsAuthenticated()]
        return [IsAdminOrTeacher()]

    def _verifier_droit_ecriture(self, classe, matiere):
        from rest_framework.exceptions import PermissionDenied

        user = self.request.user
        if user.role == "admin":
            return
        if user.role == "teacher" and Enseignement.objects.filter(enseignant=user, classe=classe, matiere=matiere).exists():
            return
        raise PermissionDenied("Seul l'enseignant de cette matière dans cette classe (ou l'administrateur) peut modifier son programme.")

    def _enregistrer(self, serializer, instance=None):
        from django.utils import timezone
        from rest_framework.exceptions import ValidationError

        classe = serializer.validated_data.get("classe", getattr(instance, "classe", None))
        matiere = serializer.validated_data.get("matiere", getattr(instance, "matiere", None))
        if classe.annee_scolaire.ecole_id != self.request.user.ecole_id or matiere.ecole_id != self.request.user.ecole_id:
            raise ValidationError("Classe ou matière d'un autre établissement.")
        self._verifier_droit_ecriture(classe, matiere)
        extra = {}
        statut = serializer.validated_data.get("statut")
        if statut == ChapitreProgramme.Statut.TERMINE and getattr(instance, "statut", None) != ChapitreProgramme.Statut.TERMINE:
            extra["realise_par"] = self.request.user
            if not serializer.validated_data.get("date_realisation"):
                extra["date_realisation"] = timezone.localdate()
        elif statut in (ChapitreProgramme.Statut.A_FAIRE, ChapitreProgramme.Statut.EN_COURS):
            extra["date_realisation"] = None
        serializer.save(**extra)

    def perform_create(self, serializer):
        self._enregistrer(serializer)

    def perform_update(self, serializer):
        self._enregistrer(serializer, serializer.instance)

    def perform_destroy(self, instance):
        self._verifier_droit_ecriture(instance.classe, instance.matiere)
        instance.delete()

    @action(detail=False, methods=["get"], url_path="avancement")
    def avancement(self, request):
        """Avancement du programme, classe par classe et matière par matière, pour une année
        scolaire (l'année active par défaut, ou `annee_scolaire`) — éventuellement une seule
        `classe`. Pourcentage = chapitres terminés / chapitres prévus."""
        from django.db.models import Count

        annee_id = request.query_params.get("annee_scolaire")
        annees = AnneeScolaire.objects.filter(ecole_id=request.user.ecole_id)
        annee = annees.filter(pk=annee_id).first() if annee_id else annees.filter(active=True).first()
        if not annee:
            return Response({"annee_scolaire": None, "annee_scolaire_id": None, "classes": []})

        classes = Classe.objects.filter(annee_scolaire=annee).order_by("niveau", "nom")
        if request.query_params.get("classe"):
            classes = classes.filter(pk=request.query_params["classe"])

        stats = (
            ChapitreProgramme.objects.filter(classe__in=classes)
            .values("classe_id", "matiere_id")
            .annotate(
                total=Count("id"),
                termines=Count("id", filter=Q(statut=ChapitreProgramme.Statut.TERMINE)),
                en_cours=Count("id", filter=Q(statut=ChapitreProgramme.Statut.EN_COURS)),
            )
        )
        par_classe = {}
        for ligne in stats:
            par_classe.setdefault(ligne["classe_id"], {})[ligne["matiere_id"]] = ligne
        enseignants = {
            (e.classe_id, e.matiere_id): e.enseignant.get_full_name()
            for e in Enseignement.objects.filter(classe__in=classes).select_related("enseignant")
        }
        noms_matieres = dict(Matiere.objects.filter(ecole_id=request.user.ecole_id).values_list("id", "nom"))

        resultat = []
        for classe in classes:
            ids_matieres = {m for (c, m) in enseignants if c == classe.id} | set(par_classe.get(classe.id, {}))
            lignes = []
            for matiere_id in sorted(ids_matieres, key=lambda m: noms_matieres.get(m, "")):
                st = par_classe.get(classe.id, {}).get(matiere_id, {"total": 0, "termines": 0, "en_cours": 0})
                lignes.append({
                    "matiere_id": matiere_id, "matiere_nom": noms_matieres.get(matiere_id, "?"),
                    "enseignant": enseignants.get((classe.id, matiere_id)),
                    "total": st["total"], "termines": st["termines"], "en_cours": st["en_cours"],
                    "pourcentage": round(st["termines"] * 100 / st["total"]) if st["total"] else None,
                })
            total = sum(l["total"] for l in lignes)
            termines = sum(l["termines"] for l in lignes)
            resultat.append({
                "classe_id": classe.id, "classe_nom": classe.nom, "niveau": classe.niveau,
                "total": total, "termines": termines,
                "pourcentage": round(termines * 100 / total) if total else None,
                "matieres": lignes,
            })
        return Response({"annee_scolaire": annee.libelle, "annee_scolaire_id": annee.id, "classes": resultat})
