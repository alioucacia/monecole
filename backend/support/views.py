from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsSuperAdmin

from .models import MessageTicket, Ticket
from .serializers import ChangerStatutTicketSerializer, MessageTicketSerializer, TicketSerializer

# Statuts qui « comptent » pour un badge de notification — un ticket résolu/fermé n'a plus
# besoin d'attention immédiate (voir TicketViewSet.compteur).
STATUTS_ACTIFS = [Ticket.Statut.OUVERT, Ticket.Statut.EN_COURS]


def _peut_voir_ticket(user, ticket) -> bool:
    """Un ticket est visible par son auteur, par le Super Admin (toutes écoles), et par un admin
    de la même école que l'auteur (visibilité, pas exclusivité — n'importe quel autre rôle de
    la même école ne voit que ses propres tickets, comme la messagerie interne)."""
    if user.role == "superadmin":
        return True
    if ticket.auteur_id == user.id:
        return True
    return user.role == "admin" and ticket.ecole_id == user.ecole_id


class TicketViewSet(viewsets.ModelViewSet):
    """Tickets de support technique — n'importe quel utilisateur connecté peut en ouvrir un et
    consulter les siens ; un admin d'école voit ceux de son établissement ; le Super Admin les
    voit tous, toutes écoles confondues, et peut les traiter (voir `changer_statut`)."""

    queryset = Ticket.objects.select_related("auteur", "ecole", "assigne_a")
    serializer_class = TicketSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role == "superadmin":
            pass
        elif user.role == "admin":
            qs = qs.filter(Q(auteur=user) | Q(ecole_id=user.ecole_id))
        else:
            qs = qs.filter(auteur=user)
        statut = self.request.query_params.get("statut")
        if statut:
            qs = qs.filter(statut=statut)
        return qs

    def get_permissions(self):
        if self.action == "changer_statut":
            return [IsAuthenticated(), IsSuperAdmin()]
        return super().get_permissions()

    def perform_create(self, serializer):
        serializer.save(auteur=self.request.user)

    def perform_update(self, serializer):
        # Seuls sujet/priorité restent modifiables par l'auteur après coup — le statut ne
        # change que via `changer_statut` (réservé au Super Admin, voir get_permissions).
        serializer.save()

    @action(detail=True, methods=["post"], url_path="changer-statut")
    def changer_statut(self, request, pk=None):
        ticket = self.get_object()
        serializer = ChangerStatutTicketSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket.statut = serializer.validated_data["statut"]
        if "assigne_a" in serializer.validated_data:
            assigne_a_id = serializer.validated_data["assigne_a"]
            if assigne_a_id:
                assigne_a = User.objects.filter(pk=assigne_a_id, role="superadmin").first()
                if not assigne_a:
                    raise ValidationError({"assigne_a": "Ce Super Admin est introuvable."})
                ticket.assigne_a = assigne_a
            else:
                ticket.assigne_a = None
        ticket.save()
        return Response(TicketSerializer(ticket).data)

    @action(detail=False, methods=["get"], url_path="compteur")
    def compteur(self, request):
        """Nombre de tickets actifs (ouvert/en cours) pertinents pour l'utilisateur connecté —
        alimente le badge de notification sur l'entrée de menu Support (voir Layout.tsx)."""
        return Response({"actifs": self.get_queryset().filter(statut__in=STATUTS_ACTIFS).count()})


class MessageTicketViewSet(viewsets.ModelViewSet):
    queryset = MessageTicket.objects.select_related("auteur", "ticket")
    serializer_class = MessageTicketSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        ticket_id = self.request.query_params.get("ticket")
        if not ticket_id:
            raise ValidationError("Le paramètre 'ticket' est requis.")
        ticket = Ticket.objects.filter(pk=ticket_id).select_related("ecole").first()
        if not ticket or not _peut_voir_ticket(user, ticket):
            # Réponse vide plutôt qu'un 403 : on ne révèle pas l'existence d'un ticket qui
            # n'appartient pas à l'utilisateur (même logique que le reste de l'application,
            # où get_queryset masque simplement les objets hors périmètre).
            return qs.none()
        return qs.filter(ticket_id=ticket_id)

    def perform_create(self, serializer):
        ticket = serializer.validated_data.get("ticket") or Ticket.objects.filter(
            pk=self.request.data.get("ticket")
        ).first()
        if not ticket or not _peut_voir_ticket(self.request.user, ticket):
            raise PermissionDenied("Vous n'avez pas accès à ce ticket.")

        message = serializer.save(auteur=self.request.user)

        # Petits ajustements de statut automatiques, comme sur un vrai outil de support : le
        # Super Admin qui répond à un ticket encore « ouvert » le passe « en cours » ; l'auteur
        # (ou un admin d'école) qui répond à un ticket déjà clos le rouvre.
        if self.request.user.role == "superadmin" and ticket.statut == Ticket.Statut.OUVERT:
            ticket.statut = Ticket.Statut.EN_COURS
            ticket.save()
        elif self.request.user.role != "superadmin" and ticket.statut in (Ticket.Statut.RESOLU, Ticket.Statut.FERME):
            ticket.statut = Ticket.Statut.OUVERT
            ticket.save()
        else:
            ticket.save()  # met à jour `maj_le` même sans changement de statut

        return message
