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

    class Meta:
        model = TypeFrais
        fields = ["id", "nom", "montant_standard", "periodicite", "periodicite_display", "est_mensuel"]
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

    class Meta:
        model = Paiement
        fields = ["id", "frais", "montant", "date_paiement", "mode_paiement", "reference", "mois", "enregistre_par", "enregistre_par_nom"]
        read_only_fields = ["date_paiement", "enregistre_par"]

    def validate(self, attrs):
        frais = attrs.get("frais", getattr(self.instance, "frais", None))
        mois = attrs.get("mois", getattr(self.instance, "mois", None))
        # Seuls les frais mensuels (scolarité...) sont suivis mois par mois — un frais ponctuel
        # (cantine, transport, inscription...) n'a pas cette notion, rien à vérifier ici.
        if not (frais and mois and frais.type_frais.est_mensuel):
            return attrs

        deja_verses = Paiement.objects.filter(frais=frais, mois=mois)
        if self.instance:
            deja_verses = deja_verses.exclude(pk=self.instance.pk)
        total_deja_verse = deja_verses.aggregate(total=Sum("montant"))["total"] or Decimal("0")
        montant_du_ce_mois = frais.montant_du
        if montant_du_ce_mois > 0 and total_deja_verse >= montant_du_ce_mois:
            raise serializers.ValidationError({
                "mois": f"Le mois {mois.strftime('%m/%Y')} est déjà intégralement payé pour ce frais."
            })
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
            "id", "eleve", "eleve_nom", "type_frais", "type_frais_nom", "type_frais_est_mensuel", "annee_scolaire",
            "montant", "montant_du", "date_echeance", "montant_paye", "solde", "statut", "paiements",
        ]
