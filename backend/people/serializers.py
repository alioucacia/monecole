from django.db import transaction
from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserSerializer
from tenants.quotas import verifier_quota_plan

from .models import (
    AlerteParent, EleveBadge, EleveProfile, EnseignantBadge, EnseignantProfile,
    GroupeRevision, MessageIA, PaieEnseignant, PointageEnseignant, generer_matricule_eleve,
)


class MiniUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email", "phone", "photo", "date_of_birth", "address", "sexe"]


class EleveProfileSerializer(serializers.ModelSerializer):
    user = MiniUserSerializer(read_only=True)
    classe_nom = serializers.CharField(source="classe.nom", read_only=True, default=None)
    classe_cycle = serializers.CharField(source="classe.cycle", read_only=True, default=None)
    classe_cycle_display = serializers.CharField(source="classe.get_cycle_display", read_only=True, default=None)
    parent_nom = serializers.CharField(source="parent.get_full_name", read_only=True, default=None)
    parent_telephone = serializers.CharField(source="parent.phone", read_only=True, default=None)
    parent_email = serializers.CharField(source="parent.email", read_only=True, default=None)
    parent_username = serializers.CharField(source="parent.username", read_only=True, default=None)
    categorie_paiement_display = serializers.CharField(source="get_categorie_paiement_display", read_only=True)
    facteur_mensualite = serializers.DecimalField(max_digits=4, decimal_places=3, read_only=True)

    class Meta:
        model = EleveProfile
        fields = [
            "id", "user", "matricule", "classe", "classe_nom", "classe_cycle", "classe_cycle_display",
            "parent", "parent_nom", "parent_telephone", "parent_email", "parent_username",
            "date_inscription", "lieu_naissance", "nom_pere", "nom_mere", "nom_tuteur",
            "regime", "statut_inscription", "actif", "date_sortie", "motif_sortie",
            "categorie_paiement", "categorie_paiement_display", "reduction_fidelite_mensualite", "facteur_mensualite",
        ]


class CategoriePaiementSerializer(serializers.ModelSerializer):
    """Sérialiseur restreint pour la mise à jour de la seule catégorie de paiement (mensualité)
    d'un élève — permet à la comptabilité de la modifier sans lui donner accès au reste de la
    fiche élève (voir `EleveProfileViewSet.categorie_paiement`)."""

    class Meta:
        model = EleveProfile
        fields = ["categorie_paiement", "reduction_fidelite_mensualite"]


class EleveProfileWriteSerializer(serializers.ModelSerializer):
    """Crée/actualise l'utilisateur ET le profil élève en une seule requête."""

    first_name = serializers.CharField(write_only=True)
    last_name = serializers.CharField(write_only=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    date_of_birth = serializers.DateField(write_only=True, required=False, allow_null=True)
    address = serializers.CharField(write_only=True, required=False, allow_blank=True)
    phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
    photo = serializers.ImageField(write_only=True, required=False, allow_null=True)
    sexe = serializers.ChoiceField(choices=User.Sexe.choices, write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, default="changeme123")

    # Création d'un NOUVEAU compte parent en même temps que l'élève, plutôt que de n'autoriser
    # que le choix d'un parent déjà existant via le champ `parent` — jusqu'ici, aucune page ne
    # permettait de créer un compte parent, il fallait donc que l'admin en crée un ailleurs (ce
    # qui n'existait nulle part) avant de pouvoir l'associer à un élève. `parent` reste utilisable
    # tel quel pour rattacher un parent déjà existant ; ces champs sont ignorés si `parent_creer`
    # n'est pas vrai (et, s'il l'est, ils remplacent toute valeur envoyée dans `parent`).
    parent_creer = serializers.BooleanField(write_only=True, required=False, default=False)
    parent_username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    parent_first_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    parent_last_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    parent_phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
    parent_email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    parent_password = serializers.CharField(write_only=True, required=False, default="changeme123")

    class Meta:
        model = EleveProfile
        fields = [
            "id", "matricule", "classe", "parent", "lieu_naissance", "nom_pere", "nom_mere", "nom_tuteur",
            "regime", "statut_inscription",
            "first_name", "last_name", "email", "date_of_birth", "address", "phone", "photo", "sexe", "password",
            "parent_creer", "parent_username", "parent_first_name", "parent_last_name",
            "parent_phone", "parent_email", "parent_password",
        ]
        # Généré automatiquement à la création (voir `generer_matricule_eleve` : 2 lettres du
        # prénom + 2 lettres du nom + numéro de place dans les inscriptions de l'école) — laissé
        # modifiable pour autoriser une correction manuelle après coup (édition), d'où
        # `required=False` plutôt qu'un champ en lecture seule.
        extra_kwargs = {"matricule": {"required": False, "allow_blank": True}}

    def validate(self, attrs):
        if attrs.get("parent_creer"):
            manquants = {
                champ: f"Le {label} du parent est requis pour créer son compte."
                for champ, label in [
                    ("parent_username", "identifiant"),
                    ("parent_first_name", "prénom"),
                    ("parent_last_name", "nom"),
                ]
                if not attrs.get(champ)
            }
            if manquants:
                raise serializers.ValidationError(manquants)
            if User.objects.filter(username=attrs["parent_username"]).exists():
                raise serializers.ValidationError({"parent_username": "Cet identifiant est déjà utilisé."})
        return attrs

    def _parent_champs(self):
        return [
            "parent_creer", "parent_username", "parent_first_name", "parent_last_name",
            "parent_phone", "parent_email", "parent_password",
        ]

    def _extraire_nouveau_parent(self, validated_data, ecole):
        """Retire les champs `parent_*` de `validated_data` et, si `parent_creer` était vrai,
        crée le compte parent correspondant. Retourne (parent, mot_de_passe_en_clair) — tous
        deux `None` si aucun parent n'était à créer. Le mot de passe en clair n'est renvoyé que
        pour permettre le message de bienvenue de `create()` juste après : il n'est ni stocké
        ni renvoyé par l'API au-delà (haché immédiatement par `set_password`)."""
        donnees = {champ: validated_data.pop(champ, None) for champ in self._parent_champs()}
        if not donnees.get("parent_creer"):
            return None, None
        mot_de_passe = donnees.get("parent_password") or "changeme123"
        parent = User(
            username=donnees["parent_username"], role=User.Role.PARENT, ecole=ecole,
            first_name=donnees.get("parent_first_name") or "", last_name=donnees.get("parent_last_name") or "",
            phone=donnees.get("parent_phone") or "", email=donnees.get("parent_email") or "",
        )
        parent.set_password(mot_de_passe)
        parent.doit_changer_mot_de_passe = True
        parent.save()
        return parent, mot_de_passe

    @transaction.atomic
    def create(self, validated_data):
        from people.notifications import notifier_creation_compte_eleve

        ecole = self.context["request"].user.ecole
        verifier_quota_plan(
            ecole, "limite_eleves",
            EleveProfile.objects.filter(user__ecole_id=ecole.id if ecole else None, actif=True).count(),
            "élèves actifs",
        )
        nouveau_parent, mot_de_passe_parent = self._extraire_nouveau_parent(validated_data, ecole)
        if nouveau_parent:
            validated_data["parent"] = nouveau_parent
        user_fields = ["first_name", "last_name", "email", "date_of_birth", "address", "phone", "photo", "sexe"]
        password = validated_data.pop("password", "changeme123")
        user_data = {f: validated_data.pop(f, "") for f in user_fields}
        matricule = validated_data.pop("matricule", "") or generer_matricule_eleve(
            user_data.get("first_name", ""), user_data.get("last_name", ""), ecole,
        )
        validated_data["matricule"] = matricule
        user = User(
            username=matricule,
            role=User.Role.STUDENT,
            ecole=ecole,
            **{k: v for k, v in user_data.items() if v not in ("", None)},
        )
        user.set_password(password)
        user.doit_changer_mot_de_passe = True
        user.save()
        eleve = EleveProfile.objects.create(user=user, **validated_data)

        # Envoi automatique des identifiants par e-mail/SMS — à l'élève, et au parent rattaché
        # (nouveau compte tout juste créé ci-dessus, ou parent déjà existant simplement lié via
        # `validated_data["parent"]`) : voir people/notifications.py pour le détail des messages.
        notifier_creation_compte_eleve(
            user, password,
            parent_user=validated_data.get("parent"),
            mot_de_passe_parent=mot_de_passe_parent if nouveau_parent else None,
            parent_est_nouveau=bool(nouveau_parent),
        )
        return eleve

    @transaction.atomic
    def update(self, instance, validated_data):
        nouveau_parent, _ = self._extraire_nouveau_parent(validated_data, instance.user.ecole)
        if nouveau_parent:
            validated_data["parent"] = nouveau_parent
        user_fields = ["first_name", "last_name", "email", "date_of_birth", "address", "phone", "photo", "sexe"]
        validated_data.pop("password", None)
        user_data = {f: validated_data.pop(f) for f in user_fields if f in validated_data}
        if user_data:
            for k, v in user_data.items():
                setattr(instance.user, k, v)
            instance.user.save()
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        return EleveProfileSerializer(instance, context=self.context).data


class ReinscriptionSerializer(serializers.Serializer):
    """Passage en masse d'élèves vers une nouvelle classe (année suivante),
    avec création optionnelle d'un frais de réinscription pour chacun."""

    eleves = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    classe_destination = serializers.IntegerField()
    type_frais = serializers.IntegerField(required=False, allow_null=True)
    montant_frais = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    date_echeance_frais = serializers.DateField(required=False, allow_null=True)


class MarquerNonReinscritSerializer(serializers.Serializer):
    motif = serializers.CharField(required=False, allow_blank=True, default="")


class EnseignantProfileSerializer(serializers.ModelSerializer):
    user = MiniUserSerializer(read_only=True)

    class Meta:
        model = EnseignantProfile
        fields = ["id", "user", "matricule", "specialite", "date_embauche", "diplome"]


class EnseignantProfileWriteSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(write_only=True)
    last_name = serializers.CharField(write_only=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    address = serializers.CharField(write_only=True, required=False, allow_blank=True)
    phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
    photo = serializers.ImageField(write_only=True, required=False, allow_null=True)
    sexe = serializers.ChoiceField(choices=User.Sexe.choices, write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, default="changeme123")

    class Meta:
        model = EnseignantProfile
        fields = [
            "id", "matricule", "specialite", "date_embauche", "diplome",
            "first_name", "last_name", "email", "address", "phone", "photo", "sexe", "password",
        ]

    @transaction.atomic
    def create(self, validated_data):
        ecole = self.context["request"].user.ecole
        verifier_quota_plan(
            ecole, "limite_enseignants",
            EnseignantProfile.objects.filter(user__ecole_id=ecole.id if ecole else None).count(),
            "enseignants",
        )
        user_fields = ["first_name", "last_name", "email", "address", "phone", "photo", "sexe"]
        password = validated_data.pop("password", "changeme123")
        user_data = {f: validated_data.pop(f, "") for f in user_fields}
        matricule = validated_data["matricule"]
        user = User(
            username=matricule,
            role=User.Role.TEACHER,
            ecole=ecole,
            **{k: v for k, v in user_data.items() if v not in ("", None)},
        )
        user.set_password(password)
        user.doit_changer_mot_de_passe = True
        user.save()
        return EnseignantProfile.objects.create(user=user, **validated_data)

    @transaction.atomic
    def update(self, instance, validated_data):
        user_fields = ["first_name", "last_name", "email", "address", "phone", "photo", "sexe"]
        validated_data.pop("password", None)
        user_data = {f: validated_data.pop(f) for f in user_fields if f in validated_data}
        if user_data:
            for k, v in user_data.items():
                setattr(instance.user, k, v)
            instance.user.save()
        return super().update(instance, validated_data)

    def to_representation(self, instance):
        return EnseignantProfileSerializer(instance, context=self.context).data


class EleveBadgeSerializer(serializers.ModelSerializer):
    photo = serializers.ImageField(source="eleve.user.photo", read_only=True)
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)

    class Meta:
        model = EleveBadge
        fields = ["id", "eleve", "eleve_nom", "photo", "qr_token", "actif", "emis_le"]
        read_only_fields = ["qr_token", "emis_le"]


class EnseignantBadgeSerializer(serializers.ModelSerializer):
    photo = serializers.ImageField(source="enseignant.user.photo", read_only=True)
    enseignant_nom = serializers.CharField(source="enseignant.user.get_full_name", read_only=True)

    class Meta:
        model = EnseignantBadge
        fields = ["id", "enseignant", "enseignant_nom", "photo", "qr_token", "actif", "emis_le"]
        read_only_fields = ["qr_token", "emis_le"]


class PointageEnseignantSerializer(serializers.ModelSerializer):
    enseignant_nom = serializers.CharField(source="enseignant.user.get_full_name", read_only=True)

    class Meta:
        model = PointageEnseignant
        fields = ["id", "enseignant", "enseignant_nom", "date", "heure_arrivee", "heure_depart", "statut", "commentaire"]


class PaieEnseignantSerializer(serializers.ModelSerializer):
    enseignant_nom = serializers.CharField(source="enseignant.user.get_full_name", read_only=True)
    salaire_calcule = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    net_a_payer = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = PaieEnseignant
        fields = [
            "id", "enseignant", "enseignant_nom", "mois", "mode_calcul", "salaire_base",
            "nombre_heures", "taux_horaire", "salaire_calcule", "primes", "retenues",
            "net_a_payer", "payee", "date_paiement", "commentaire",
        ]


class GroupeRevisionSerializer(serializers.ModelSerializer):
    enseignant_nom = serializers.CharField(source="enseignant.get_full_name", read_only=True)
    eleves_noms = serializers.StringRelatedField(source="eleves", many=True, read_only=True)

    class Meta:
        model = GroupeRevision
        fields = ["id", "enseignant", "enseignant_nom", "nom", "description", "matiere", "classe", "eleves", "eleves_noms", "lien", "actif", "cree_le"]
        read_only_fields = ["enseignant"]


class AlerteParentSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)

    class Meta:
        model = AlerteParent
        fields = ["id", "parent", "eleve", "eleve_nom", "type", "message", "sms_envoye", "cree_le"]


class MessageIASerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageIA
        fields = ["id", "role", "contenu", "cree_le"]
        read_only_fields = fields


class MessageIACreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, allow_blank=False)
