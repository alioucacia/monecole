from datetime import date

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdmin, IsAdminOrComptabilite, IsAdminOrComptabiliteOrReadOnly, IsAdminOrReadOnly
from tenants.permissions import fonctionnalite_requise

from .models import Formule, InscriptionCantine, PointageCantine, TicketCantine
from .serializers import (
    FormuleSerializer,
    InscriptionCantineSerializer,
    PointageCantineSerializer,
    TicketCantineSerializer,
)


class FormuleViewSet(viewsets.ModelViewSet):
    queryset = Formule.objects.all()
    serializer_class = FormuleSerializer
    permission_classes = [IsAdminOrReadOnly, fonctionnalite_requise("cantine")]
    search_fields = ["nom", "responsable_nom"]

    def get_queryset(self):
        qs = super().get_queryset().filter(ecole_id=self.request.user.ecole_id)
        user = self.request.user
        # Un élève/parent ne doit voir que la ou les formule(s) auxquelles il est inscrit —
        # pas les coordonnées de tous les responsables de l'école.
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(inscriptions__eleve=user.eleve_profile).distinct()
        if user.role == "parent":
            return qs.filter(inscriptions__eleve__parent=user).distinct()
        return qs

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)

    @action(detail=True, methods=["post"], url_path="regenerer-lien-agent", permission_classes=[IsAdmin])
    def regenerer_lien_agent(self, request, pk=None):
        """Invalide l'ancien lien de scan de l'agent (en cas de perte/partage non désiré)
        et en génère un nouveau."""
        import uuid
        formule = self.get_object()
        formule.token_agent = uuid.uuid4()
        formule.save(update_fields=["token_agent"])
        return Response(FormuleSerializer(formule, context={"request": request}).data)


class InscriptionCantineViewSet(viewsets.ModelViewSet):
    queryset = InscriptionCantine.objects.select_related("eleve__user", "eleve__classe", "formule")
    serializer_class = InscriptionCantineSerializer
    permission_classes = [IsAdminOrReadOnly, fonctionnalite_requise("cantine")]
    filterset_fields = ["formule", "eleve"]

    def get_queryset(self):
        qs = super().get_queryset().filter(formule__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(eleve__parent=user)
        return qs


class TicketCantineViewSet(viewsets.ModelViewSet):
    """Tickets/abonnements mensuels de cantine — gérés par l'admin ou la comptabilité."""

    queryset = TicketCantine.objects.select_related("inscription__eleve__user", "inscription__formule")
    serializer_class = TicketCantineSerializer
    permission_classes = [IsAdminOrComptabiliteOrReadOnly, fonctionnalite_requise("cantine")]
    filterset_fields = ["inscription", "paye"]

    def get_queryset(self):
        qs = super().get_queryset().filter(inscription__formule__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(inscription__eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(inscription__eleve__parent=user)
        return qs

    @action(detail=True, methods=["post"], url_path="marquer-paye", permission_classes=[IsAdminOrComptabilite])
    def marquer_paye(self, request, pk=None):
        ticket = self.get_object()
        ticket.paye = True
        ticket.date_paiement = date.today()
        ticket.save(update_fields=["paye", "date_paiement"])
        return Response(TicketCantineSerializer(ticket).data)


# ---------------------------------------------------------------------------
# Portail agent de cantine : accès public par lien secret (token), sans authentification —
# comme la vérification de badge. L'agent ouvre ce lien sur son téléphone/tablette.
# ---------------------------------------------------------------------------

class AgentCantineInfoView(APIView):
    """Informations de la formule + liste des élèves inscrits, avec leur statut de repas
    du jour et l'état de paiement de leur ticket du mois en cours."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        formule = get_object_or_404(Formule, token_agent=token)
        today = timezone.localdate()
        mois_courant = today.replace(day=1)

        eleves_info = []
        for inscription in formule.inscriptions.select_related("eleve__user", "eleve__classe"):
            repas_pris = PointageCantine.objects.filter(
                formule=formule, eleve=inscription.eleve, horodatage__date=today,
            ).exists()
            ticket = TicketCantine.objects.filter(inscription=inscription, mois=mois_courant).first()
            eleves_info.append({
                "inscription_id": inscription.id,
                "eleve_id": inscription.eleve_id,
                "nom_complet": inscription.eleve.user.get_full_name(),
                "classe_nom": inscription.eleve.classe.nom if inscription.eleve.classe else None,
                "repas_pris": repas_pris,
                "ticket_paye": ticket.paye if ticket else None,
            })

        return Response({
            "formule": {
                "id": formule.id, "nom": formule.nom, "responsable_nom": formule.responsable_nom,
                "heure_service": formule.heure_service,
            },
            "eleves": eleves_info,
        })


class AgentCantinePointageView(APIView):
    """Pointe le repas pris par un élève."""

    permission_classes = [AllowAny]

    def post(self, request, token):
        formule = get_object_or_404(Formule, token_agent=token)
        eleve_id = request.data.get("eleve")
        inscription = get_object_or_404(InscriptionCantine, formule=formule, eleve_id=eleve_id)

        pointage = PointageCantine.objects.create(formule=formule, eleve=inscription.eleve)
        return Response(PointageCantineSerializer(pointage).data, status=201)
