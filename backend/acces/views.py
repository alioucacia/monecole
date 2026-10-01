from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdminOrSurveillance

from .models import CarteAcces, Equipement, Passage
from .services import enregistrer_passage, message_passage, reponse_passage


# --- Serializers -------------------------------------------------------------------------------

class EquipementSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    sens_display = serializers.CharField(source="get_sens_display", read_only=True)

    class Meta:
        model = Equipement
        fields = ["id", "nom", "type", "type_display", "sens", "sens_display", "actif", "derniere_activite", "cree_le"]
        read_only_fields = ["derniere_activite", "cree_le"]


class CarteAccesSerializer(serializers.ModelSerializer):
    personne_nom = serializers.CharField(source="personne.get_full_name", read_only=True)
    personne_role = serializers.CharField(source="personne.get_role_display", read_only=True)

    class Meta:
        model = CarteAcces
        fields = ["id", "uid", "personne", "personne_nom", "personne_role", "actif", "cree_le"]
        read_only_fields = ["cree_le"]

    def validate_personne(self, personne):
        if personne.ecole_id != self.context["request"].user.ecole_id:
            raise serializers.ValidationError("Cette personne n'appartient pas à votre établissement.")
        return personne

    def validate(self, attrs):
        from .models import normaliser_uid

        uid = normaliser_uid(attrs.get("uid", getattr(self.instance, "uid", "")))
        if not uid:
            raise serializers.ValidationError({"uid": "Scannez ou saisissez le numéro de la carte."})
        doublon = CarteAcces.objects.filter(ecole_id=self.context["request"].user.ecole_id, uid=uid)
        if self.instance:
            doublon = doublon.exclude(pk=self.instance.pk)
        if doublon.exists():
            raise serializers.ValidationError({"uid": "Cette carte est déjà associée à une autre personne."})
        attrs["uid"] = uid
        return attrs


class PassageSerializer(serializers.ModelSerializer):
    sens_display = serializers.CharField(source="get_sens_display", read_only=True)
    methode_display = serializers.CharField(source="get_methode_display", read_only=True)
    equipement_nom = serializers.CharField(source="equipement.nom", read_only=True, default=None)
    message = serializers.SerializerMethodField()

    class Meta:
        model = Passage
        fields = [
            "id", "personne", "nom_affiche", "role", "classe", "sens", "sens_display", "horodatage",
            "methode", "methode_display", "equipement", "equipement_nom", "autorise", "motif_refus", "message",
        ]

    def get_message(self, obj):
        return message_passage(obj)


# --- Gestion (direction / surveillance) ----------------------------------------------------------

class EquipementViewSet(viewsets.ModelViewSet):
    """Équipements de l'école. La clé secrète n'est renvoyée qu'à la création et à sa
    régénération (`regenerer-cle`) — elle est à saisir dans la configuration de l'équipement."""

    serializer_class = EquipementSerializer
    permission_classes = [IsAdminOrSurveillance]

    def get_queryset(self):
        return Equipement.objects.filter(ecole_id=self.request.user.ecole_id)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        equipement = serializer.save(ecole=request.user.ecole)
        return Response({**serializer.data, "cle": equipement.cle}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="regenerer-cle")
    def regenerer_cle(self, request, pk=None):
        from .models import _nouvelle_cle

        equipement = self.get_object()
        equipement.cle = _nouvelle_cle()
        equipement.save(update_fields=["cle"])
        return Response({**self.get_serializer(equipement).data, "cle": equipement.cle})


class CarteAccesViewSet(viewsets.ModelViewSet):
    serializer_class = CarteAccesSerializer
    permission_classes = [IsAdminOrSurveillance]
    filterset_fields = ["personne", "actif"]
    search_fields = ["uid", "personne__first_name", "personne__last_name"]

    def get_queryset(self):
        return CarteAcces.objects.select_related("personne").filter(ecole_id=self.request.user.ecole_id)

    def perform_create(self, serializer):
        serializer.save(ecole=self.request.user.ecole)

    @action(detail=False, methods=["get"], url_path="personnes")
    def personnes(self, request):
        """Recherche d'un élève ou d'un membre du personnel (pas les parents) à qui associer
        une carte — ouverte à la surveillance, contrairement à la liste des comptes."""
        from django.db.models import Q

        texte = (request.query_params.get("search") or "").strip()
        if len(texte) < 2:
            return Response([])
        qs = User.objects.filter(ecole_id=request.user.ecole_id, is_active=True).exclude(role=User.Role.PARENT).filter(
            Q(first_name__icontains=texte) | Q(last_name__icontains=texte) | Q(username__icontains=texte)
            | Q(eleve_profile__matricule__icontains=texte)
        )[:20]
        return Response([{"id": u.id, "nom": u.get_full_name() or u.username, "role": u.get_role_display()} for u in qs])


class PassageViewSet(viewsets.ReadOnlyModelViewSet):
    """Journal des passages. Filtres : `date` (AAAA-MM-JJ, aujourd'hui par défaut), `sens`,
    `personne`, `autorise`."""

    serializer_class = PassageSerializer
    permission_classes = [IsAdminOrSurveillance]
    search_fields = ["nom_affiche", "classe", "identifiant_lu"]

    def get_queryset(self):
        qs = Passage.objects.select_related("equipement").filter(ecole_id=self.request.user.ecole_id)
        jour = self.request.query_params.get("date") or timezone.localdate().isoformat()
        qs = qs.filter(horodatage__date=jour)
        for champ in ("sens", "personne"):
            if self.request.query_params.get(champ):
                qs = qs.filter(**{champ: self.request.query_params[champ]})
        if self.request.query_params.get("autorise") in ("true", "false"):
            qs = qs.filter(autorise=self.request.query_params["autorise"] == "true")
        return qs

    @action(detail=False, methods=["get"], url_path="resume")
    def resume(self, request):
        """Chiffres du jour : entrées, sorties, refus, et personnes présentes dans
        l'établissement (dernier passage = entrée)."""
        qs = self.get_queryset()
        derniers = {}
        for p in qs.filter(autorise=True).order_by("horodatage").values("personne_id", "sens", "role"):
            derniers[p["personne_id"]] = p
        presents = [p for p in derniers.values() if p["sens"] == Passage.Sens.ENTREE]
        return Response({
            "entrees": qs.filter(autorise=True, sens=Passage.Sens.ENTREE).count(),
            "sorties": qs.filter(autorise=True, sens=Passage.Sens.SORTIE).count(),
            "refus": qs.filter(autorise=False).count(),
            "presents": len(presents),
            "eleves_presents": sum(1 for p in presents if p["role"] == User.Role.STUDENT),
            "personnel_present": sum(1 for p in presents if p["role"] != User.Role.STUDENT),
        })

    @action(detail=False, methods=["post"], url_path="scanner")
    def scanner(self, request):
        """Scan depuis la borne navigateur (lecteur QR/RFID USB qui « tape » le code) — même
        traitement qu'un équipement, avec la session de l'utilisateur au lieu d'une clé."""
        equipement = None
        if request.data.get("equipement"):
            equipement = Equipement.objects.filter(ecole_id=request.user.ecole_id, pk=request.data["equipement"]).first()
        passage = enregistrer_passage(request.user.ecole, request.data.get("identifiant", ""), equipement, request.data.get("sens"))
        return Response(reponse_passage(passage, request))


# --- API des équipements (sans session : authentifiée par la clé) --------------------------------

def _equipement_de_la_requete(request):
    cle = request.headers.get("X-Cle-Equipement") or request.data.get("cle") or request.query_params.get("cle")
    equipement = Equipement.objects.select_related("ecole").filter(cle=cle or "-").first() if cle else None
    if equipement is None or not equipement.actif or not equipement.ecole.actif:
        return None
    return equipement


class EquipementPassageView(APIView):
    """POST /api/acces/equipement/passage/ — appelé par l'équipement à chaque lecture.

    En-tête : `X-Cle-Equipement: <clé de l'équipement>`.
    Corps JSON : `{"identifiant": "<contenu du QR, numéro RFID ou matricule>", "sens": "entree" | "sortie" (facultatif)}`.
    Réponse : `{"ouvrir": true/false, "sens", "nom", "classe", "heure", "message", ...}` — un
    contrôleur de porte ou un tourniquet déverrouille si `ouvrir` vaut true."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        equipement = _equipement_de_la_requete(request)
        if equipement is None:
            return Response({"ouvrir": False, "message": "Équipement non reconnu ou désactivé."}, status=status.HTTP_403_FORBIDDEN)
        if not request.data.get("identifiant"):
            raise ValidationError({"identifiant": "Identifiant lu manquant."})
        passage = enregistrer_passage(equipement.ecole, request.data["identifiant"], equipement, request.data.get("sens"))
        return Response(reponse_passage(passage, request))


class EquipementPingView(APIView):
    """GET /api/acces/equipement/ping/ — test de connexion d'un équipement (avec sa clé)."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        equipement = _equipement_de_la_requete(request)
        if equipement is None:
            return Response({"ok": False, "message": "Équipement non reconnu ou désactivé."}, status=status.HTTP_403_FORBIDDEN)
        Equipement.objects.filter(pk=equipement.pk).update(derniere_activite=timezone.now())
        return Response({"ok": True, "equipement": equipement.nom, "ecole": equipement.ecole.nom})
