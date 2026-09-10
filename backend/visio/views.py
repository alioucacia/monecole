import uuid

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User
from tenants.permissions import fonctionnalite_requise

from .models import Reunion
from .serializers import ParticipantSerializer, ReunionSerializer


class ReunionViewSet(viewsets.ModelViewSet):
    """Réunions vidéo planifiées et appels instantanés — voir `Reunion` pour le choix de
    s'appuyer sur Jitsi Meet plutôt que de bâtir une signalisation WebRTC maison."""

    serializer_class = ReunionSerializer
    permission_classes = [IsAuthenticated, fonctionnalite_requise("visioconference")]

    def get_queryset(self):
        user = self.request.user
        qs = Reunion.objects.filter(ecole_id=user.ecole_id).select_related("organisateur").prefetch_related("participants")
        # L'admin supervise toutes les réunions de son établissement ; les autres rôles ne
        # voient que celles qu'ils organisent ou auxquelles ils sont invités.
        if user.role == "admin":
            return qs
        return qs.filter(Q(organisateur=user) | Q(participants=user)).distinct()

    def perform_create(self, serializer):
        salle = f"em-{self.request.user.ecole.slug}-{uuid.uuid4().hex[:16]}"
        serializer.save(ecole=self.request.user.ecole, organisateur=self.request.user, salle=salle)

    def perform_update(self, serializer):
        reunion = self.get_object()
        if reunion.organisateur_id != self.request.user.id and self.request.user.role != "admin":
            raise ValidationError("Seul l'organisateur (ou l'administration) peut modifier cette réunion.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.organisateur_id != self.request.user.id and self.request.user.role != "admin":
            raise ValidationError("Seul l'organisateur (ou l'administration) peut annuler cette réunion.")
        instance.delete()

    @action(detail=False, methods=["post"], url_path="appel-instantane")
    def appel_instantane(self, request):
        """Démarre immédiatement un appel (audio ou vidéo) à un seul destinataire (boutons
        « Appel audio »/« Appel vidéo » de la messagerie) — une réunion classique, juste sans
        étape de planification."""
        destinataire_id = request.data.get("destinataire")
        if not destinataire_id:
            raise ValidationError("Le paramètre 'destinataire' est requis.")
        destinataire = User.objects.filter(pk=destinataire_id, ecole_id=request.user.ecole_id).first()
        if not destinataire:
            raise ValidationError("Destinataire introuvable dans votre établissement.")
        if destinataire.id == request.user.id:
            raise ValidationError("Vous ne pouvez pas vous appeler vous-même.")

        avec_video = request.data.get("type", "video") != "audio"
        type_label = "vidéo" if avec_video else "audio"

        salle = f"em-{request.user.ecole.slug}-{uuid.uuid4().hex[:16]}"
        reunion = Reunion.objects.create(
            ecole=request.user.ecole,
            titre=f"Appel {type_label} avec {request.user.get_full_name() or request.user.username}",
            organisateur=request.user,
            salle=salle,
            date_debut=timezone.now(),
            duree_minutes=60,
            statut=Reunion.Statut.EN_COURS,
            instantanee=True,
            avec_video=avec_video,
        )
        reunion.participants.add(destinataire)

        # Aucune infra temps réel (pas de WebSocket/Channels dans ce projet) pour "sonner" chez
        # le destinataire : on passe par la messagerie interne, déjà consultée régulièrement
        # (badge de non-lus), pour lui transmettre le lien de la salle.
        emoji = "📹" if avec_video else "🎙️"
        from messaging.models import Message

        lien = f"{settings.FRONTEND_URL}/visioconference?salle={salle}"
        Message.objects.create(
            expediteur=request.user, destinataire=destinataire,
            contenu=f"{emoji} Appel {type_label} en cours — rejoignez : {lien}",
        )

        return Response(ReunionSerializer(reunion, context={"request": request}).data, status=201)

    @action(detail=False, methods=["get"], url_path="participants-possibles")
    def participants_possibles(self, request):
        """Utilisateurs de son établissement pouvant être invités à une réunion (multi-select
        du formulaire de création) — tous les rôles, contrairement à `messaging.ContactsView`
        qui restreint selon les relations pédagogiques : une réunion de service (ex: toute
        l'équipe pédagogique + l'administration) n'a pas les mêmes besoins qu'un message privé."""
        utilisateurs = (
            User.objects.filter(ecole_id=request.user.ecole_id)
            .exclude(id=request.user.id)
            .order_by("last_name", "first_name")
        )
        return Response(ParticipantSerializer(utilisateurs, many=True).data)
