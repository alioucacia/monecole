from rest_framework import serializers

from .models import Frais, Paiement, TarifClasse, TypeFrais


class TypeFraisSerializer(serializers.ModelSerializer):
    class Meta:
        model = TypeFrais
        fields = ["id", "nom", "montant_standard", "est_mensuel"]


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
