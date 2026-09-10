from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminOrReadOnly, IsAdminOrTeacherOrReadOnly

from .models import AnneeScolaire, Classe, Creneau, Enseignement, Matiere, deviner_cycle
from .serializers import (
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
    permission_classes = [IsAdminOrReadOnly]
    search_fields = ["nom", "code"]

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)


class ClasseViewSet(viewsets.ModelViewSet):
    queryset = Classe.objects.select_related("annee_scolaire", "professeur_principal")
    serializer_class = ClasseSerializer
    permission_classes = [IsAdminOrReadOnly]
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
    permission_classes = [IsAdminOrReadOnly]
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
