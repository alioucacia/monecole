from django.db.models import Q
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from accounts.permissions import IsAdminOrTeacherOrReadOnly, IsSuperAdmin
from tenants.permissions import fonctionnalite_requise

from .models import Annonce
from .notifications import envoyer_notifications_annonce
from .serializers import AnnonceSerializer


class _RapporteResultatEnvoiMixin:
    """Ajoute `resultat_envoi` (nombre d'e-mails/SMS effectivement envoyés) à la réponse de
    création — `envoyer_notifications_annonce()` calcule déjà ce compte mais `perform_create`
    ne peut pas modifier la réponse HTTP lui-même, seul `create()` le peut."""

    _dernier_resultat_envoi = None

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        if self._dernier_resultat_envoi is not None:
            response.data["resultat_envoi"] = self._dernier_resultat_envoi
        return response


class AnnonceViewSet(_RapporteResultatEnvoiMixin, viewsets.ModelViewSet):
    queryset = Annonce.objects.select_related("auteur", "classe")
    serializer_class = AnnonceSerializer
    permission_classes = [IsAdminOrTeacherOrReadOnly, fonctionnalite_requise("annonces")]
    filterset_fields = ["cible_role", "classe"]
    search_fields = ["titre", "contenu"]

    def get_queryset(self):
        user = self.request.user
        # Les annonces plateforme (ecole=null, publiées par le Super Admin via
        # AnnoncePlateformeViewSet) sont visibles de toutes les écoles, en plus des
        # annonces propres à l'établissement de l'utilisateur.
        qs = super().get_queryset().filter(Q(ecole_id=user.ecole_id) | Q(ecole__isnull=True))
        if user.role == "admin":
            return qs
        visibilite = Q(cible_role=Annonce.Cible.TOUS) | Q(cible_role=user.role)
        if user.role == "student" and hasattr(user, "eleve_profile"):
            visibilite |= Q(classe=user.eleve_profile.classe)
        if user.role == "parent":
            classes_enfants = [e.classe_id for e in user.enfants.all()]
            visibilite |= Q(classe_id__in=classes_enfants)
        return qs.filter(visibilite).distinct()

    def perform_create(self, serializer):
        annonce = serializer.save(auteur=self.request.user, ecole=self.request.user.ecole)
        self._dernier_resultat_envoi = envoyer_notifications_annonce(annonce)


class AnnoncePlateformeViewSet(_RapporteResultatEnvoiMixin, viewsets.ModelViewSet):
    """Annonces diffusées par le Super Admin — soit à toutes les écoles de la plateforme
    (`ecole=None`, comportement par défaut), soit à une seule école ciblée en passant son
    id dans `ecole` à la création."""

    # Seul un Super Admin peut créer via ce ViewSet (permission_classes ci-dessous) : filtrer
    # sur le rôle de l'auteur suffit donc à distinguer ces annonces (diffusées à tous ou
    # ciblées sur une école) de celles publiées en interne par un établissement.
    queryset = Annonce.objects.filter(auteur__role="superadmin").select_related("auteur", "ecole")
    serializer_class = AnnonceSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["cible_role", "ecole"]
    search_fields = ["titre", "contenu"]

    def perform_create(self, serializer):
        from tenants.models import Ecole

        ecole = None
        ecole_id = self.request.data.get("ecole")
        if ecole_id not in (None, "", "null"):
            try:
                ecole = Ecole.objects.get(pk=ecole_id)
            except (Ecole.DoesNotExist, ValueError, TypeError):
                raise ValidationError({"ecole": "École introuvable."})

        annonce = serializer.save(auteur=self.request.user, ecole=ecole, classe=None)
        self._dernier_resultat_envoi = envoyer_notifications_annonce(annonce)
