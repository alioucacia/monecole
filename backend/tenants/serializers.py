from rest_framework import serializers

from core.validators import EXTENSIONS_IMAGE, TAILLE_MAX_IMAGE, valider_taille_fichier
from .features import FONCTIONNALITES
from .messages_templates import MODELES_MESSAGE
from .models import Ecole, JournalActivite, ModeleMessage, ParametresEcole, ParametresPlateforme, PaiementEcole, PlanAbonnement


class PlanAbonnementSerializer(serializers.ModelSerializer):
    periodicite_display = serializers.CharField(source="get_periodicite_display", read_only=True)
    nombre_ecoles = serializers.IntegerField(source="ecoles.count", read_only=True)

    class Meta:
        model = PlanAbonnement
        fields = [
            "id", "nom", "montant", "periodicite", "periodicite_display", "description",
            "limite_eleves", "limite_enseignants", "limite_administrateurs", "actif", "nombre_ecoles",
        ]


class ParametresPlateformeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParametresPlateforme
        fields = [
            "nom_plateforme", "logo", "email_expediteur_nom", "support_email", "support_telephone",
            "sms_actif", "maintenance_active", "maintenance_message",
        ]

    def validate_logo(self, fichier):
        # Sans ceci, un fichier trop volumineux (ou d'un format non pris en charge) remontait tel
        # quel jusqu'à Pillow — au mieux une erreur 400 correcte, au pire une exception non
        # rattrapée (ex: image décompressée trop grande) qui finissait en 500 générique côté client.
        return valider_taille_fichier(fichier, TAILLE_MAX_IMAGE, EXTENSIONS_IMAGE)


class PlateformeBrandingSerializer(serializers.ModelSerializer):
    """Sous-ensemble public de `ParametresPlateforme` — affiché partout dans l'app (page de
    connexion, barre latérale...), donc lisible sans authentification, contrairement au reste des
    réglages plateforme (support...) réservé au Super Admin. `maintenance_active`/
    `maintenance_message` y sont ajoutés (pas sensibles — un simple statut + un message destiné
    aux utilisateurs) pour que la page de connexion puisse afficher un écran de maintenance dédié
    AVANT même de tenter une connexion, plutôt que de laisser l'utilisateur taper ses identifiants
    pour découvrir le blocage seulement après coup (voir LoginPage.tsx)."""

    class Meta:
        model = ParametresPlateforme
        fields = ["nom_plateforme", "logo", "maintenance_active", "maintenance_message"]


class ParametresEcoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParametresEcole
        fields = [
            "devise", "bareme_notation", "moyenne_admission", "heure_limite_ponctualite",
            "message_bienvenue", "reglement_interieur",
        ]


class ModeleMessageSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    jetons = serializers.SerializerMethodField()

    class Meta:
        model = ModeleMessage
        fields = ["cle", "sujet", "contenu", "label", "description", "jetons"]

    def get_label(self, obj):
        return MODELES_MESSAGE[obj.cle]["label"]

    def get_description(self, obj):
        return MODELES_MESSAGE[obj.cle]["description"]

    def get_jetons(self, obj):
        return MODELES_MESSAGE[obj.cle]["jetons"]

    def validate_cle(self, value):
        if value not in MODELES_MESSAGE:
            raise serializers.ValidationError("Clé de modèle inconnue.")
        return value


class PaiementEcoleSerializer(serializers.ModelSerializer):
    enregistre_par_nom = serializers.CharField(source="enregistre_par.get_full_name", read_only=True, default=None)

    class Meta:
        model = PaiementEcole
        fields = [
            "id", "ecole", "mois", "montant", "date_paiement", "mode_paiement", "reference",
            "numero_facture", "enregistre_par", "enregistre_par_nom",
        ]
        read_only_fields = ["date_paiement", "numero_facture", "enregistre_par"]


class EcoleSerializer(serializers.ModelSerializer):
    statut_abonnement = serializers.CharField(read_only=True)
    jours_avant_blocage = serializers.IntegerField(read_only=True)
    jours_avant_echeance = serializers.IntegerField(read_only=True)
    # Compte à rebours principal (voir la docstring de `Ecole.jours_avant_prochaine_echeance`),
    # avec la périodicité effectivement appliquée — c'est ce que le Super Admin voit désormais
    # pour chaque école dans EcolesPage/EcoleDetailPage, au lieu d'un décompte toujours mensuel.
    jours_avant_prochaine_echeance = serializers.IntegerField(read_only=True)
    periodicite_abonnement_display = serializers.CharField(read_only=True)
    nombre_utilisateurs = serializers.SerializerMethodField()
    dernier_paiement = serializers.SerializerMethodField()
    parametres = ParametresEcoleSerializer(read_only=True)
    plan_nom = serializers.CharField(source="plan.nom", read_only=True, default=None)
    plan_limite_eleves = serializers.IntegerField(source="plan.limite_eleves", read_only=True, default=None)
    plan_limite_enseignants = serializers.IntegerField(source="plan.limite_enseignants", read_only=True, default=None)
    plan_limite_administrateurs = serializers.IntegerField(source="plan.limite_administrateurs", read_only=True, default=None)
    type_etablissement_display = serializers.CharField(source="get_type_etablissement_display", read_only=True)
    modele_recu_display = serializers.CharField(source="get_modele_recu_display", read_only=True)
    modele_badge_display = serializers.CharField(source="get_modele_badge_display", read_only=True)
    modele_bulletin_display = serializers.CharField(source="get_modele_bulletin_display", read_only=True)
    modele_fiche_inscription_display = serializers.CharField(source="get_modele_fiche_inscription_display", read_only=True)
    modele_certificat_display = serializers.CharField(source="get_modele_certificat_display", read_only=True)

    class Meta:
        model = Ecole
        fields = [
            "id", "nom", "slug", "adresse", "ville", "pays", "telephone", "email", "logo",
            "directeur_nom", "type_etablissement", "type_etablissement_display", "ire", "dpe", "dsee",
            "entete_ministere_1", "entete_ministere_2", "entete_republique", "entete_devise",
            "plan", "plan_nom", "plan_limite_eleves", "plan_limite_enseignants", "plan_limite_administrateurs",
            "abonnement_mensuel", "jour_echeance", "jours_grace", "actif", "date_creation",
            "statut_abonnement", "jours_avant_echeance", "jours_avant_blocage",
            "jours_avant_prochaine_echeance", "periodicite_abonnement_display",
            "nombre_utilisateurs", "dernier_paiement", "parametres",
            "couleur_principale", "couleur_secondaire", "fonctionnalites_desactivees",
            "modele_recu", "modele_recu_display", "modele_badge", "modele_badge_display",
            "modele_bulletin", "modele_bulletin_display",
            "modele_fiche_inscription", "modele_fiche_inscription_display",
            "modele_certificat", "modele_certificat_display",
        ]
        read_only_fields = ["slug", "date_creation"]

    def validate_fonctionnalites_desactivees(self, value):
        inconnues = [cle for cle in value if cle not in FONCTIONNALITES]
        if inconnues:
            raise serializers.ValidationError(f"Fonctionnalité(s) inconnue(s) : {', '.join(inconnues)}.")
        return value

    def get_nombre_utilisateurs(self, obj):
        return obj.users.count()

    def get_dernier_paiement(self, obj):
        dernier = obj.paiements.order_by("-mois").first()
        return PaiementEcoleSerializer(dernier).data if dernier else None


class EcoleCreateSerializer(serializers.ModelSerializer):
    """Création d'une école accompagnée de son premier compte administrateur et,
    optionnellement, de sa première année scolaire."""

    admin_username = serializers.CharField(write_only=True)
    admin_email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    admin_first_name = serializers.CharField(write_only=True)
    admin_last_name = serializers.CharField(write_only=True)
    admin_password = serializers.CharField(write_only=True, required=False, default="changeme123")
    annee_scolaire_libelle = serializers.CharField(
        write_only=True, required=False, allow_blank=True,
        help_text="Ex: 2025-2026 — crée automatiquement l'année scolaire active (1er septembre → 30 juin).",
    )

    class Meta:
        model = Ecole
        fields = [
            "id", "nom", "adresse", "ville", "pays", "telephone", "email", "logo",
            "directeur_nom", "type_etablissement", "actif",
            "plan", "abonnement_mensuel", "jour_echeance", "jours_grace",
            "admin_username", "admin_email", "admin_first_name", "admin_last_name", "admin_password",
            "annee_scolaire_libelle",
        ]

    def validate_annee_scolaire_libelle(self, value):
        if not value:
            return value
        annees = value.split("-")
        if len(annees) != 2 or not all(a.isdigit() and len(a) == 4 for a in annees):
            raise serializers.ValidationError("Format attendu : AAAA-AAAA, ex. 2025-2026.")
        if int(annees[1]) != int(annees[0]) + 1:
            raise serializers.ValidationError("La seconde année doit suivre directement la première.")
        return value

    def validate_logo(self, fichier):
        return valider_taille_fichier(fichier, TAILLE_MAX_IMAGE, EXTENSIONS_IMAGE)

    def create(self, validated_data):
        from datetime import date

        from academics.models import AnneeScolaire
        from accounts.models import User

        admin_fields = {
            "username": validated_data.pop("admin_username"),
            "email": validated_data.pop("admin_email", ""),
            "first_name": validated_data.pop("admin_first_name"),
            "last_name": validated_data.pop("admin_last_name"),
        }
        password = validated_data.pop("admin_password", "changeme123")
        annee_libelle = validated_data.pop("annee_scolaire_libelle", "")

        ecole = Ecole.objects.create(**validated_data)
        admin = User(role=User.Role.ADMIN, ecole=ecole, **admin_fields)
        admin.set_password(password)
        admin.doit_changer_mot_de_passe = True
        admin.save()

        if annee_libelle:
            premiere_annee = int(annee_libelle.split("-")[0])
            AnneeScolaire.objects.create(
                ecole=ecole, libelle=annee_libelle,
                date_debut=date(premiere_annee, 9, 1), date_fin=date(premiere_annee + 1, 6, 30),
                active=True,
            )
        return ecole

    def to_representation(self, instance):
        return EcoleSerializer(instance, context=self.context).data


class MonEcoleSerializer(serializers.ModelSerializer):
    """Profil + paramètres d'une école, éditable par son propre Administrateur.
    Les champs liés à l'abonnement (montant, échéance, statut) restent en lecture seule :
    seul le Super Admin de la plateforme peut les modifier."""

    parametres = ParametresEcoleSerializer()
    statut_abonnement = serializers.CharField(read_only=True)
    jours_avant_echeance = serializers.IntegerField(read_only=True)
    jours_avant_blocage = serializers.IntegerField(read_only=True)
    # Compte à rebours principal, valable quel que soit le statut à jour (voir la docstring de
    # `Ecole.jours_avant_prochaine_echeance`) et périodicité du plan lié (Mensuel/Trimestriel/
    # Annuel — voir `duree_periode_mois`), affichés tous deux dans le badge d'abonnement
    # (Layout.tsx AbonnementBadge).
    jours_avant_prochaine_echeance = serializers.IntegerField(read_only=True)
    periodicite_abonnement_display = serializers.CharField(read_only=True)

    class Meta:
        model = Ecole
        fields = [
            "id", "nom", "adresse", "telephone", "email", "logo", "ire", "dpe", "dsee",
            "entete_ministere_1", "entete_ministere_2", "entete_republique", "entete_devise",
            "abonnement_mensuel", "jour_echeance", "jours_grace", "statut_abonnement",
            "jours_avant_echeance", "jours_avant_blocage", "jours_avant_prochaine_echeance",
            "periodicite_abonnement_display", "parametres",
            "couleur_principale", "couleur_secondaire", "fonctionnalites_desactivees",
        ]
        # La personnalisation des documents et l'activation des fonctionnalités restent
        # décidées par le Super Admin (EcoleViewSet) — l'admin de l'école les consulte ici
        # en lecture seule mais ne peut pas les modifier lui-même.
        read_only_fields = [
            "abonnement_mensuel", "jour_echeance", "jours_grace",
            "couleur_principale", "couleur_secondaire", "fonctionnalites_desactivees",
        ]

    def validate_logo(self, fichier):
        # Sans cette limite, un fichier trop volumineux (ou d'un format non pris en charge par
        # Pillow) provoquait une erreur 500 générique au lieu d'un message clair — c'est le bug
        # remonté par l'administrateur en essayant de changer le logo de son école.
        return valider_taille_fichier(fichier, TAILLE_MAX_IMAGE, EXTENSIONS_IMAGE)

    def update(self, instance, validated_data):
        parametres_data = validated_data.pop("parametres", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if parametres_data:
            parametres, _ = ParametresEcole.objects.get_or_create(ecole=instance)
            for field, value in parametres_data.items():
                setattr(parametres, field, value)
            parametres.save()
            # `instance.parametres` peut déjà être mis en cache (ex: select_related fait par la
            # vue avant l'update) : on rafraîchit ce cache pour que to_representation() renvoie
            # bien les valeurs à jour, pas l'ancien objet.
            instance.parametres = parametres
        return instance


class JournalActiviteSerializer(serializers.ModelSerializer):
    acteur_nom = serializers.CharField(source="acteur.get_full_name", read_only=True, default=None)
    action_display = serializers.CharField(source="get_action_display", read_only=True)
    ecole_nom = serializers.CharField(source="ecole.nom", read_only=True, default=None)

    class Meta:
        model = JournalActivite
        fields = ["id", "horodatage", "acteur", "acteur_nom", "action", "action_display", "ecole", "ecole_nom", "details"]
        read_only_fields = fields


class EcoleUtilisateurSerializer(serializers.Serializer):
    """Aperçu en lecture seule des comptes d'une école, pour la supervision du Super Admin."""

    id = serializers.IntegerField()
    full_name = serializers.CharField()
    username = serializers.CharField()
    role = serializers.CharField()
    role_display = serializers.CharField()
    is_active = serializers.BooleanField()
    date_joined = serializers.DateTimeField()
    last_login = serializers.DateTimeField(allow_null=True)
    en_ligne = serializers.BooleanField()


class RechercheGlobaleResultSerializer(serializers.Serializer):
    """Un compte trouvé par la recherche globale du Super Admin (tous établissements)."""

    id = serializers.IntegerField()
    full_name = serializers.CharField()
    username = serializers.CharField()
    email = serializers.CharField()
    role = serializers.CharField()
    role_display = serializers.CharField()
    ecole_id = serializers.IntegerField(allow_null=True)
    ecole_nom = serializers.CharField(allow_null=True)
    is_active = serializers.BooleanField()
    last_login = serializers.DateTimeField(allow_null=True)
