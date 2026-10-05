from datetime import date

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminOrReadOnly, IsAdminOrTeacherOrReadOnly
from tenants.permissions import fonctionnalite_requise

from .models import Emprunt, Livre
from .serializers import EmpruntSerializer, LivreSerializer


class LivreViewSet(viewsets.ModelViewSet):
    queryset = Livre.objects.all()
    serializer_class = LivreSerializer
    permission_classes = [IsAdminOrReadOnly, fonctionnalite_requise("bibliotheque")]
    search_fields = ["titre", "auteur", "categorie", "isbn"]

    def get_queryset(self):
        return super().get_queryset().filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)


class EmpruntViewSet(viewsets.ModelViewSet):
    queryset = Emprunt.objects.select_related("livre", "eleve__user")
    serializer_class = EmpruntSerializer
    permission_classes = [IsAdminOrTeacherOrReadOnly, fonctionnalite_requise("bibliotheque")]
    filterset_fields = ["livre", "eleve", "date_retour_effective"]

    def get_queryset(self):
        qs = super().get_queryset().filter(livre__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(eleve__parent=user)
        return qs

    def perform_create(self, serializer):
        serializer.save(enregistre_par=self.request.user)

    @action(detail=True, methods=["post"], url_path="retourner")
    def retourner(self, request, pk=None):
        """Marque un emprunt comme rendu."""
        emprunt = self.get_object()
        emprunt.date_retour_effective = date.today()
        emprunt.save()
        return Response(EmpruntSerializer(emprunt).data)
