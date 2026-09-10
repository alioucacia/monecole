from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.serializers import UserSerializer
from tenants.permissions import fonctionnalite_requise

from .models import Message
from .serializers import MessageSerializer


class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated, fonctionnalite_requise("messagerie")]

    def get_queryset(self):
        user = self.request.user
        qs = Message.objects.filter(Q(expediteur=user) | Q(destinataire=user)).select_related(
            "expediteur", "destinataire"
        )
        box = self.request.query_params.get("box")
        if box == "inbox":
            qs = qs.filter(destinataire=user)
        elif box == "sent":
            qs = qs.filter(expediteur=user)
        with_user = self.request.query_params.get("avec")
        if with_user:
            qs = qs.filter(Q(expediteur_id=with_user) | Q(destinataire_id=with_user))
        return qs

    def perform_create(self, serializer):
        destinataire = serializer.validated_data.get("destinataire")
        if destinataire and destinataire.ecole_id != self.request.user.ecole_id:
            raise PermissionDenied("Ce destinataire n'appartient pas à votre établissement.")
        serializer.save(expediteur=self.request.user)

    @action(detail=True, methods=["post"], url_path="marquer-lu")
    def marquer_lu(self, request, pk=None):
        message = self.get_object()
        if message.destinataire_id == request.user.id:
            message.lu = True
            message.save()
        return Response(MessageSerializer(message).data)

    @action(detail=False, methods=["get"], url_path="non-lus")
    def non_lus(self, request):
        count = Message.objects.filter(destinataire=request.user, lu=False).count()
        return Response({"non_lus": count})


class ContactsView(APIView):
    """Liste des personnes qu'un utilisateur peut contacter, selon son rôle."""

    permission_classes = [IsAuthenticated, fonctionnalite_requise("messagerie")]

    def get(self, request):
        user = request.user
        contacts = User.objects.none()
        meme_ecole = Q(ecole_id=user.ecole_id)

        if user.role in ("admin", "comptabilite", "surveillance"):
            # Comptabilité et Surveillance générale ont des interlocuteurs potentiels trop
            # variés (parents pour un impayé, enseignants/élèves pour la discipline...) pour
            # se limiter à une liste de relations pédagogiques — comme l'admin, ils peuvent
            # écrire à n'importe qui de leur établissement.
            contacts = User.objects.filter(meme_ecole).exclude(id=user.id)

        elif user.role == "teacher":
            classes_ids = user.enseignements.values_list("classe_id", flat=True)
            eleves_ids = User.objects.filter(eleve_profile__classe_id__in=classes_ids).values_list("id", flat=True)
            parents_ids = User.objects.filter(
                enfants__classe_id__in=classes_ids
            ).values_list("id", flat=True)
            admins_ids = User.objects.filter(meme_ecole, role=User.Role.ADMIN).values_list("id", flat=True)
            contacts = User.objects.filter(meme_ecole, id__in=set(list(eleves_ids) + list(parents_ids) + list(admins_ids)))

        elif user.role == "student" and hasattr(user, "eleve_profile"):
            classe = user.eleve_profile.classe
            enseignants_ids = []
            if classe:
                enseignants_ids = list(User.objects.filter(enseignements__classe=classe).values_list("id", flat=True))
            admins_ids = list(User.objects.filter(meme_ecole, role=User.Role.ADMIN).values_list("id", flat=True))
            ids = set(enseignants_ids + admins_ids)
            if user.eleve_profile.parent_id:
                ids.add(user.eleve_profile.parent_id)
            contacts = User.objects.filter(meme_ecole, id__in=ids)

        elif user.role == "parent":
            classes_ids = user.enfants.values_list("classe_id", flat=True)
            enseignants_ids = User.objects.filter(enseignements__classe_id__in=classes_ids).values_list("id", flat=True)
            admins_ids = User.objects.filter(meme_ecole, role=User.Role.ADMIN).values_list("id", flat=True)
            contacts = User.objects.filter(meme_ecole, id__in=set(list(enseignants_ids) + list(admins_ids)))

        return Response(UserSerializer(contacts.exclude(id=user.id).distinct(), many=True).data)
