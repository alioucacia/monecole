from datetime import date

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdmin, IsAdminOrComptabilite, IsAdminOrComptabiliteOrReadOnly, IsAdminOrReadOnly
from tenants.permissions import fonctionnalite_requise

from .models import AffectationTransport, PointageTransport, TicketBus, Trajet
from .serializers import (
    AffectationTransportSerializer,
    PointageTransportSerializer,
    TicketBusSerializer,
    TrajetSerializer,
)


class TrajetViewSet(viewsets.ModelViewSet):
    queryset = Trajet.objects.all()
    serializer_class = TrajetSerializer
    permission_classes = [IsAdminOrReadOnly, fonctionnalite_requise("transport")]
    search_fields = ["nom", "chauffeur_nom"]

    def get_queryset(self):
        qs = super().get_queryset().filter(ecole_id=self.request.user.ecole_id)
        user = self.request.user
        # Un élève/parent ne doit voir que la ou les ligne(s) auxquelles il est affecté —
        # pas les coordonnées de tous les chauffeurs et véhicules de l'école.
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(affectations__eleve=user.eleve_profile).distinct()
        if user.role == "parent":
            return qs.filter(affectations__eleve__parent=user).distinct()
        return qs

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)

    @action(detail=True, methods=["post"], url_path="regenerer-lien-chauffeur", permission_classes=[IsAdmin])
    def regenerer_lien_chauffeur(self, request, pk=None):
        """Invalide l'ancien lien de scan du chauffeur (en cas de perte/partage non désiré)
        et en génère un nouveau."""
        import uuid
        trajet = self.get_object()
        trajet.token_chauffeur = uuid.uuid4()
        trajet.save(update_fields=["token_chauffeur"])
        return Response(TrajetSerializer(trajet, context={"request": request}).data)


class AffectationTransportViewSet(viewsets.ModelViewSet):
    queryset = AffectationTransport.objects.select_related("eleve__user", "eleve__classe", "trajet")
    serializer_class = AffectationTransportSerializer
    permission_classes = [IsAdminOrReadOnly, fonctionnalite_requise("transport")]
    filterset_fields = ["trajet", "eleve"]

    def get_queryset(self):
        qs = super().get_queryset().filter(trajet__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(eleve__parent=user)
        return qs


class TicketBusViewSet(viewsets.ModelViewSet):
    """Tickets/abonnements mensuels de bus — gérés par l'admin ou la comptabilité."""

    queryset = TicketBus.objects.select_related("affectation__eleve__user", "affectation__trajet")
    serializer_class = TicketBusSerializer
    permission_classes = [IsAdminOrComptabiliteOrReadOnly, fonctionnalite_requise("transport")]
    filterset_fields = ["affectation", "paye"]

    def get_queryset(self):
        qs = super().get_queryset().filter(affectation__trajet__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(affectation__eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(affectation__eleve__parent=user)
        return qs

    @action(detail=True, methods=["post"], url_path="marquer-paye", permission_classes=[IsAdminOrComptabilite])
    def marquer_paye(self, request, pk=None):
        ticket = self.get_object()
        ticket.paye = True
        ticket.date_paiement = date.today()
        ticket.save(update_fields=["paye", "date_paiement"])
        return Response(TicketBusSerializer(ticket).data)


# ---------------------------------------------------------------------------
# Portail chauffeur : accès public par lien secret (token), sans authentification —
# comme la vérification de badge. Le chauffeur ouvre ce lien sur son téléphone.
# ---------------------------------------------------------------------------

class ChauffeurInfoView(APIView):
    """Informations du trajet + liste des élèves inscrits, avec leur statut de montée/descente
    du jour et l'état de paiement de leur ticket du mois en cours."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        trajet = get_object_or_404(Trajet, token_chauffeur=token)
        today = timezone.localdate()
        mois_courant = today.replace(day=1)

        eleves_info = []
        for affectation in trajet.affectations.select_related("eleve__user", "eleve__classe"):
            pointages_jour = list(
                PointageTransport.objects.filter(trajet=trajet, eleve=affectation.eleve, horodatage__date=today)
                .order_by("horodatage")
            )
            dernier = pointages_jour[-1] if pointages_jour else None
            ticket = TicketBus.objects.filter(affectation=affectation, mois=mois_courant).first()
            eleves_info.append({
                "affectation_id": affectation.id,
                "eleve_id": affectation.eleve_id,
                "nom_complet": affectation.eleve.user.get_full_name(),
                "classe_nom": affectation.eleve.classe.nom if affectation.eleve.classe else None,
                "point_montee": affectation.point_montee,
                "statut_jour": dernier.type_evenement if dernier else None,
                "ticket_paye": ticket.paye if ticket else None,
            })

        return Response({
            "trajet": {
                "id": trajet.id, "nom": trajet.nom, "chauffeur_nom": trajet.chauffeur_nom,
                "vehicule_immatriculation": trajet.vehicule_immatriculation,
                "derniere_latitude": trajet.derniere_latitude, "derniere_longitude": trajet.derniere_longitude,
                "position_maj_le": trajet.position_maj_le,
            },
            "eleves": eleves_info,
        })


class ChauffeurPointageView(APIView):
    """Pointe la montée ou la descente d'un élève. Si une position GPS est transmise
    (capturée par le navigateur du chauffeur), elle est aussi enregistrée comme dernière
    position connue du bus."""

    permission_classes = [AllowAny]

    def post(self, request, token):
        trajet = get_object_or_404(Trajet, token_chauffeur=token)
        eleve_id = request.data.get("eleve")
        type_evenement = request.data.get("type_evenement")
        if type_evenement not in PointageTransport.TypeEvenement.values:
            raise ValidationError("type_evenement invalide.")
        affectation = get_object_or_404(AffectationTransport, trajet=trajet, eleve_id=eleve_id)

        latitude = request.data.get("latitude")
        longitude = request.data.get("longitude")
        pointage = PointageTransport.objects.create(
            trajet=trajet, eleve=affectation.eleve, type_evenement=type_evenement,
            latitude=latitude or None, longitude=longitude or None,
        )
        if latitude and longitude:
            trajet.derniere_latitude = latitude
            trajet.derniere_longitude = longitude
            trajet.position_maj_le = timezone.now()
            trajet.save(update_fields=["derniere_latitude", "derniere_longitude", "position_maj_le"])

        return Response(PointageTransportSerializer(pointage).data, status=201)


class ChauffeurPositionView(APIView):
    """Signale la position actuelle du bus, indépendamment d'un pointage élève —
    utile en cours de trajet, entre deux arrêts."""

    permission_classes = [AllowAny]

    def post(self, request, token):
        trajet = get_object_or_404(Trajet, token_chauffeur=token)
        latitude, longitude = request.data.get("latitude"), request.data.get("longitude")
        if not latitude or not longitude:
            raise ValidationError("latitude et longitude sont requises.")
        trajet.derniere_latitude = latitude
        trajet.derniere_longitude = longitude
        trajet.position_maj_le = timezone.now()
        trajet.save(update_fields=["derniere_latitude", "derniere_longitude", "position_maj_le"])
        return Response({"detail": "Position mise à jour.", "position_maj_le": trajet.position_maj_le})
