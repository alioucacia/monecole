from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers

from core.validators import EXTENSIONS_DOCUMENT, TAILLE_MAX_DOCUMENT, valider_taille_fichier

from .models import CategorieDepense, Depense, Frais, Paiement, TarifClasse, TypeFrais


class CategorieDepenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = CategorieDepense
        fields = ["id", "nom"]


class TypeFraisSerializer(serializers.ModelSerializer):
    periodicite_display = serializers.CharField(source="get_periodicite_display", read_only=True)
    usage_display = serializers.CharField(source="get_usage_display", read_only=True)

    class Meta:
        model = TypeFrais
        fields = ["id", "nom", "montant_standard", "periodicite", "periodicite_display", "est_mensuel", "usage", "usage_display"]
        # Dérivé automatiquement de `periodicite` par `TypeFrais.save()` — lecture seule ici pour
        # qu'il n'y ait qu'une seule source de vérité côté client (le sélecteur de périodicité).
        read_only_fields = ["est_mensuel"]


class TarifClasseSerializer(serializers.ModelSerializer):
    type_frais_nom = serializers.CharField(source="type_frais.nom", read_only=True)
    classe_nom = serializers.CharField(source="classe.nom", read_only=True)
    classe_niveau = serializers.CharField(source="classe.niveau", read_only=True)
    annee_scolaire_libelle = serializers.CharField(source="annee_scolaire.libelle", read_only=True)

    class Meta:
        model = TarifClasse
        fields = [
            "id", "type_frais", "type_frais_nom", "classe", "classe_nom", "classe_niveau",
            "annee_scolaire", "annee_scolaire_libelle", "montant",
        ]


class PaiementSerializer(serializers.ModelSerializer):
    enregistre_par_nom = serializers.CharField(source="enregistre_par.get_full_name", read_only=True, default=None)
    periode_nom = serializers.CharField(source="periode.nom", read_only=True, default=None)

    class Meta:
        model = Paiement
        fields = [
            "id", "frais", "montant", "date_paiement", "mode_paiement", "reference", "mois",
            "periode", "periode_nom", "enregistre_par", "enregistre_par_nom",
        ]
        read_only_fields = ["date_paiement", "enregistre_par"]

    def _deja_verse(self, frais, **filtres) -> Decimal:
        qs = Paiement.objects.filter(frais=frais, **filtres)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        return qs.aggregate(total=Sum("montant"))["total"] or Decimal("0")

    def validate(self, attrs):
        frais = attrs.get("frais", getattr(self.instance, "frais", None))
        if not frais:
            return attrs
        mois = attrs.get("mois", getattr(self.instance, "mois", None))
        periode = attrs.get("periode", getattr(self.instance, "periode", None))
        if periode and periode.annee_scolaire_id != frais.annee_scolaire_id:
            raise serializers.ValidationError({"periode": "Cette tranche n'appartient pas à l'année scolaire de ce frais."})

        # 1) Mensuel : un mois déjà intégralement payé pour ce frais ne peut plus recevoir de
        #    versement supplémentaire (le montant dû tient compte de la réduction — voir
        #    Frais.montant_du).
        if mois and frais.type_frais.est_mensuel:
            if frais.montant_du > 0 and self._deja_verse(frais, mois=mois) >= frais.montant_du:
                raise serializers.ValidationError({
                    "mois": f"Le mois {mois.strftime('%m/%Y')} est déjà intégralement payé pour ce frais."
                })
            return attrs

        # 2) Tranche (frais de périodicité "trimestriel") : même garde-fou, par tranche plutôt
        #    que par mois — `Frais.montant` représente le montant D'UNE tranche (comme il
        #    représente celui D'UN mois pour un frais mensuel), pas le total de l'année.
        if periode and frais.type_frais.periodicite == TypeFrais.Periodicite.TRIMESTRIEL:
            if frais.montant_du > 0 and self._deja_verse(frais, periode=periode) >= frais.montant_du:
                raise serializers.ValidationError({
                    "periode": f"{periode.nom} est déjà intégralement payée pour ce frais."
                })
            return attrs

        # 3) Tout le reste (annuel, autre, ou un paiement sans mois/tranche précisé·e) : le frais
        #    dans son ensemble ne doit pas recevoir de paiement au-delà de son solde restant.
        if frais.solde <= 0:
            raise serializers.ValidationError({"montant": "Ce frais est déjà intégralement payé."})
        return attrs


class DepenseSerializer(serializers.ModelSerializer):
    categorie_nom = serializers.CharField(source="categorie.nom", read_only=True)
    mode_paiement_display = serializers.CharField(source="get_mode_paiement_display", read_only=True)
    enregistre_par_nom = serializers.CharField(source="enregistre_par.get_full_name", read_only=True, default=None)

    class Meta:
        model = Depense
        fields = [
            "id", "date", "categorie", "categorie_nom", "motif", "montant", "mode_paiement",
            "mode_paiement_display", "reference", "responsable", "enregistre_par", "enregistre_par_nom",
            "justificatif", "commentaire",
        ]
        read_only_fields = ["enregistre_par"]
        extra_kwargs = {"justificatif": {"required": False}}

    def validate_justificatif(self, fichier):
        return valider_taille_fichier(fichier, TAILLE_MAX_DOCUMENT, EXTENSIONS_DOCUMENT)

    def validate_categorie(self, value):
        request = self.context.get("request")
        if request and value.ecole_id != request.user.ecole_id:
            raise serializers.ValidationError("Cette catégorie n'appartient pas à votre établissement.")
        return value


class FraisSerializer(serializers.ModelSerializer):
    eleve_nom = serializers.CharField(source="eleve.user.get_full_name", read_only=True)
    type_frais_nom = serializers.CharField(source="type_frais.nom", read_only=True)
    type_frais_est_mensuel = serializers.BooleanField(source="type_frais.est_mensuel", read_only=True)
    type_frais_periodicite = serializers.CharField(source="type_frais.periodicite", read_only=True)
    # Montant réellement dû après application de la catégorie de paiement/réduction fidélité de
    # l'élève (voir Frais.montant_du) — distinct de `montant`, qui reste le tarif standard.
    montant_du = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    montant_paye = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    solde = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    statut = serializers.CharField(read_only=True)
    paiements = PaiementSerializer(many=True, read_only=True)

    class Meta:
        model = Frais
        fields = [
            "id", "eleve", "eleve_nom", "type_frais", "type_frais_nom", "type_frais_est_mensuel",
            "type_frais_periodicite", "annee_scolaire",
            "montant", "montant_du", "date_echeance", "montant_paye", "solde", "statut", "paiements",
        ]
