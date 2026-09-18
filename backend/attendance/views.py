from datetime import datetime, timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Count, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.permissions import IsAdminOrSurveillance, IsAdminOrTeacherOrSurveillanceOrReadOnly
from people.models import AlerteParent, EleveProfile
from people.sms import send_sms
from rest_framework.permissions import IsAuthenticated
from tenants.messages_templates import rendre_modele
from tenants.permissions import fonctionnalite_requise

from .models import JustificatifAbsence, Presence
from .serializers import (
    JustificatifAbsenceSerializer,
    PresenceBulkSerializer,
    PresenceSerializer,
    TraiterJustificatifSerializer,
)


class PresenceViewSet(viewsets.ModelViewSet):
    queryset = Presence.objects.select_related("eleve__user", "eleve__classe", "creneau")
    serializer_class = PresenceSerializer
    permission_classes = [IsAdminOrTeacherOrSurveillanceOrReadOnly]
    filterset_fields = {
        "eleve": ["exact"],
        "eleve__classe": ["exact"],
        "date": ["exact"],
        "statut": ["exact"],
        "creneau": ["exact"],
    }

    def get_queryset(self):
        qs = super().get_queryset().filter(eleve__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role in ("teacher", "surveillance"):
            if user.role == "teacher":
                return qs.filter(eleve__classe__enseignements__enseignant=user).distinct()
            return qs
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(eleve__parent=user)
        return qs

    def perform_create(self, serializer):
        serializer.save(enregistre_par=self.request.user)

    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk(self, request):
        """Enregistre en une fois la feuille d'appel de toute une classe."""
        serializer = PresenceBulkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        eleve_ids = [entry["eleve"] for entry in data["entries"]]
        nb_dans_ecole = EleveProfile.objects.filter(
            pk__in=eleve_ids, user__ecole_id=request.user.ecole_id
        ).count()
        if nb_dans_ecole != len(set(eleve_ids)):
            raise PermissionDenied("Un ou plusieurs élèves n'appartiennent pas à votre établissement.")

        created, updated = 0, 0
        for entry in data["entries"]:
            obj, was_created = Presence.objects.update_or_create(
                eleve_id=entry["eleve"],
                date=data["date"],
                creneau_id=data.get("creneau"),
                defaults={
                    "statut": entry["statut"],
                    "justifie": entry["justifie"],
                    "motif": entry["motif"],
                    "enregistre_par": request.user,
                },
            )
            created += 1 if was_created else 0
            updated += 0 if was_created else 1
            self._create_parent_alert_if_needed(obj.eleve_id, data["date"])
        return Response({"created": created, "updated": updated}, status=status.HTTP_200_OK)

    @staticmethod
    def _create_parent_alert_if_needed(eleve_id, date):
        eleve = EleveProfile.objects.select_related("parent", "user").get(pk=eleve_id)
        if not eleve.parent:
            return
        date_value = date if hasattr(date, "isocalendar") else datetime.fromisoformat(str(date)).date()
        week_start = date_value - timedelta(days=date_value.weekday())
        absences = Presence.objects.filter(
            eleve=eleve,
            date__gte=week_start,
            date__lte=week_start + timedelta(days=6),
            statut=Presence.Statut.ABSENT,
        ).count()
        if absences < 3:
            return
        already_alerted = AlerteParent.objects.filter(
            parent=eleve.parent,
            eleve=eleve,
            type="absence_hebdomadaire",
            cree_le__date__gte=week_start,
        ).exists()
        if not already_alerted:
            ecole = eleve.user.ecole if eleve.user.ecole_id else None
            periode = f"{week_start:%d/%m} au {week_start + timedelta(days=6):%d/%m}"
            sujet, contenu = rendre_modele(
                ecole, "absence",
                nom_complet=eleve.user.get_full_name(),
                nombre_absences=absences, periode=periode,
            )
            alerte = AlerteParent.objects.create(
                parent=eleve.parent,
                eleve=eleve,
                message=contenu,
            )
            # `sujet` était jusqu'ici récupéré puis jeté (`_sujet, contenu = ...`) : seul le SMS
            # partait réellement, jamais l'e-mail — malgré un modèle "absence" dédié (sujet +
            # contenu) prévu pour les deux canaux, comme pour compte_cree/mensualite_impayee.
            if eleve.parent.email:
                try:
                    send_mail(
                        subject=sujet, message=contenu, from_email=settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[eleve.parent.email], fail_silently=True,
                    )
                except Exception:  # noqa: BLE001 — un échec d'e-mail ne doit pas bloquer le SMS ci-dessous
                    pass
            if eleve.parent.phone and send_sms(eleve.parent.phone, alerte.message):
                alerte.sms_envoye = True
                alerte.save(update_fields=["sms_envoye"])

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """Statistiques d'assiduité (par élève ou par classe)."""
        qs = self.get_queryset()
        eleve_id = request.query_params.get("eleve")
        classe_id = request.query_params.get("classe")
        if eleve_id:
            qs = qs.filter(eleve_id=eleve_id)
        if classe_id:
            qs = qs.filter(eleve__classe_id=classe_id)

        totals = qs.aggregate(
            total=Count("id"),
            presents=Count("id", filter=Q(statut=Presence.Statut.PRESENT)),
            absents=Count("id", filter=Q(statut=Presence.Statut.ABSENT)),
            retards=Count("id", filter=Q(statut=Presence.Statut.RETARD)),
            absences_injustifiees=Count("id", filter=Q(statut=Presence.Statut.ABSENT, justifie=False)),
        )
        total = totals["total"] or 0
        taux_presence = round((totals["presents"] / total) * 100, 1) if total else None
        return Response({**totals, "taux_presence": taux_presence})


class JustificatifAbsenceViewSet(viewsets.ModelViewSet):
    """Justificatifs d'absence/maladie : l'élève ou son parent les soumet (avec preuve
    optionnelle), l'administration ou la surveillance générale les valide ou les rejette."""

    queryset = JustificatifAbsence.objects.select_related("eleve__user", "eleve__classe", "soumis_par", "traite_par")
    serializer_class = JustificatifAbsenceSerializer
    permission_classes = [IsAuthenticated, fonctionnalite_requise("justificatifs")]
    filterset_fields = ["eleve", "statut", "motif"]

    def get_queryset(self):
        qs = super().get_queryset().filter(eleve__user__ecole_id=self.request.user.ecole_id)
        user = self.request.user
        if user.role == "student" and hasattr(user, "eleve_profile"):
            return qs.filter(eleve=user.eleve_profile)
        if user.role == "parent":
            return qs.filter(eleve__parent=user)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        eleve = serializer.validated_data["eleve"]
        if eleve.user.ecole_id != user.ecole_id:
            raise PermissionDenied("Cet élève n'appartient pas à votre établissement.")
        if user.role == "student" and eleve.user_id != user.id:
            raise PermissionDenied("Vous ne pouvez soumettre un justificatif que pour vous-même.")
        if user.role == "parent" and eleve.parent_id != user.id:
            raise PermissionDenied("Vous ne pouvez soumettre un justificatif que pour votre enfant.")
        serializer.save(soumis_par=user)

    def _traiter(self, request, statut):
        justificatif = self.get_object()
        serializer = TraiterJustificatifSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        justificatif.statut = statut
        justificatif.traite_par = request.user
        justificatif.commentaire_traitement = serializer.validated_data.get("commentaire", "")
        justificatif.save(update_fields=["statut", "traite_par", "commentaire_traitement"])

        if statut == JustificatifAbsence.Statut.APPROUVE:
            Presence.objects.filter(eleve=justificatif.eleve, date=justificatif.date_absence).update(
                justifie=True, motif=justificatif.get_motif_display()
            )
        return Response(JustificatifAbsenceSerializer(justificatif).data)

    @action(detail=True, methods=["post"], url_path="approuver", permission_classes=[IsAdminOrSurveillance])
    def approuver(self, request, pk=None):
        return self._traiter(request, JustificatifAbsence.Statut.APPROUVE)

    @action(detail=True, methods=["post"], url_path="rejeter", permission_classes=[IsAdminOrSurveillance])
    def rejeter(self, request, pk=None):
        return self._traiter(request, JustificatifAbsence.Statut.REJETE)
