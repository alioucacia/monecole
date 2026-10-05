from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Sum
from rest_framework import serializers

from core.validators import EXTENSIONS_DOCUMENT, TAILLE_MAX_DOCUMENT, valider_taille_fichier

from .models import FORMULES_SCOLARITE, MESSAGE_ELEVE_BONUS, MESSAGE_MOIS_HORS_MENSUALITE, MOIS_MENSUALITE, est_scolarite, PERIODICITES_SCOLARITE, USAGES_INSCRIPTION, CategorieDepense, Depense, Frais, Paiement, TarifClasse, TypeFrais


MOIS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


def verifier_formule_scolarite(eleve_id, annee_scolaire_id, type_frais, champ):
    """Refuse une mensualité / tranche / scolarité annuelle d'une autre formule que celle déjà
    commencée par l'élève cette année (voir Frais.formule_scolarite)."""
    if type_frais.usage in USAGES_INSCRIPTION or type_frais.periodicite not in PERIODICITES_SCOLARITE:
        return
    formule = Frais.formule_scolarite(eleve_id, annee_scolaire_id)
    if formule and formule != type_frais.periodicite:
        raise serializers.ValidationError({
            champ: (
                f"Cet élève paie déjà sa scolarité {FORMULES_SCOLARITE[formule]} cette année : il ne peut pas "
                f"la payer {FORMULES_SCOLARITE[type_frais.periodicite]} pour cette même année scolaire."
            )
        })


class CategorieDepenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = CategorieDepense
        fields = ["id", "nom"]


class TypeFraisSerializer(serializers.ModelSerializer):
    periodicite_display = serializers.CharField(source="get_periodicite_display", read_only=True)
    usage_display = serializers.CharField(source="get_usage_display", read_only=True)
    numero_tranche = serializers.IntegerField(read_only=True)

    class Meta:
        model = TypeFrais
        fields = [
            "id", "nom", "montant_standard", "periodicite", "periodicite_display", "est_mensuel", "usage", "usage_display",
            "numero_tranche",
        ]
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

    def _deja_verse(self, frais, frais_concernes=None, **filtres) -> Decimal:
        # Sur le frais ET ses éventuels doublons (voir Frais.equivalents) : un mois / une
        # inscription déjà payé·e via un autre frais identique de l'élève compte aussi.
        if frais_concernes is None:
            frais_concernes = frais.equivalents()
        qs = Paiement.objects.filter(frais__in=frais_concernes, **filtres)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        return qs.aggregate(total=Sum("montant"))["total"] or Decimal("0")

    def _reste_annuel_mensualites(self, frais) -> Decimal:
        """Ce que l'élève doit encore payer en mensualités sur l'année du frais (Octobre → Juin),
        d'après le suivi mensuel — le paiement en cours de modification n'est pas compté comme
        déjà versé."""
        from .views import _calculer_suivi_mensuel  # import différé : views importe ce module

        reste = sum((m["reste"] for m in _calculer_suivi_mensuel(frais.eleve, frais.annee_scolaire)), Decimal("0"))
        if self.instance and self.instance.frais.type_frais.est_mensuel:
            reste += self.instance.montant
        return reste

    def validate(self, attrs):
        frais = attrs.get("frais", getattr(self.instance, "frais", None))
        if not frais:
            return attrs
        if frais.eleve.exonere_fratrie and est_scolarite(frais.type_frais):
            # « Élève Bonus » (voir people/fratrie.py) : aucune scolarité à encaisser.
            raise serializers.ValidationError({"frais": MESSAGE_ELEVE_BONUS})
        mois = attrs.get("mois", getattr(self.instance, "mois", None))
        periode = attrs.get("periode", getattr(self.instance, "periode", None))
        montant = attrs.get("montant", getattr(self.instance, "montant", None))
        verifier_formule_scolarite(frais.eleve_id, frais.annee_scolaire_id, frais.type_frais, "frais")
        numero = frais.type_frais.numero_tranche
        if numero:
            # Type propre à une tranche (« 2ème Tranche ») : la tranche payée est forcément la
            # sienne — la N-ième Periode de l'année (s'il y en a une de configurée).
            from grades.models import Periode

            sa_tranche = (
                Periode.objects.filter(annee_scolaire_id=frais.annee_scolaire_id)
                .order_by("date_debut")[numero - 1:numero].first()
            )
            if periode and sa_tranche and periode != sa_tranche:
                raise serializers.ValidationError({"periode": f"Ce frais « {frais.type_frais.nom} » ne couvre que cette tranche."})
            periode = attrs["periode"] = sa_tranche
        elif frais.type_frais.periodicite == TypeFrais.Periodicite.TRIMESTRIEL and not periode:
            # Sans tranche précisée, le versement ne serait rattaché à aucun mois du suivi mensuel.
            raise serializers.ValidationError({"periode": "Précisez la tranche payée pour ce frais par tranche."})
        if periode and periode.annee_scolaire_id != frais.annee_scolaire_id:
            raise serializers.ValidationError({"periode": "Cette tranche n'appartient pas à l'année scolaire de ce frais."})

        # 1) Mensuel : un mois déjà intégralement payé pour ce frais ne peut plus recevoir de
        #    versement supplémentaire, et un versement ne peut pas dépasser ce qu'il reste à
        #    payer pour CE mois précis (le montant dû tient compte de la réduction — voir
        #    Frais.montant_du). `restant` exclut le paiement en cours d'édition le cas échéant
        #    (voir `_deja_verse`), donc reste correct aussi bien en création qu'en modification.
        if frais.type_frais.est_mensuel and not mois:
            # Sans mois précisé, le versement échappait au contrôle mois par mois ci-dessous.
            raise serializers.ValidationError({"mois": "Précisez le mois payé pour ce frais mensuel."})
        if frais.type_frais.est_mensuel and mois.month not in MOIS_MENSUALITE:
            raise serializers.ValidationError({"mois": MESSAGE_MOIS_HORS_MENSUALITE})
        if mois and frais.type_frais.est_mensuel:
            # Tous les frais de ce type de l'élève pour l'année (un frais par mois d'échéance est
            # permis) : un mois payé sur l'un ne peut pas être repayé sur un autre.
            meme_type = Frais.objects.filter(
                eleve_id=frais.eleve_id, type_frais_id=frais.type_frais_id, annee_scolaire_id=frais.annee_scolaire_id,
            )
            restant = frais.montant_du - self._deja_verse(frais, frais_concernes=meme_type, mois=mois)
            if frais.montant_du > 0 and restant <= 0:
                raise serializers.ValidationError({
                    "mois": f"Le mois {mois.strftime('%m/%Y')} est déjà intégralement payé pour « {frais.type_frais.nom} »."
                })
            if montant is not None and montant > restant:
                raise serializers.ValidationError({
                    "montant": f"Le montant dépasse ce qu'il reste à payer pour {mois.strftime('%m/%Y')} ({restant} GNF)."
                })
            # Plafond annuel : jamais plus que ce que l'élève doit encore pour toute l'année
            # (somme des restes des 9 mois du suivi mensuel) — couvre aussi plusieurs types de
            # frais mensuels ou des mensualités de montants différents, que le contrôle mois par
            # mois ci-dessus traite chacun séparément.
            reste_annuel = self._reste_annuel_mensualites(frais)
            if montant is not None and montant > reste_annuel:
                raise serializers.ValidationError({
                    "montant": f"Le montant dépasse ce que l'élève doit encore payer en mensualités pour l'année "
                               f"{frais.annee_scolaire.libelle} ({reste_annuel} GNF)."
                })
            return attrs

        # 2) Tranche (frais de périodicité "trimestriel") : même garde-fou, par tranche plutôt
        #    que par mois — `Frais.montant` représente le montant D'UNE tranche (comme il
        #    représente celui D'UN mois pour un frais mensuel), pas le total de l'année.
        if periode and frais.type_frais.periodicite == TypeFrais.Periodicite.TRIMESTRIEL:
            restant = frais.montant_du - self._deja_verse(frais, periode=periode)
            if frais.montant_du > 0 and restant <= 0:
                raise serializers.ValidationError({
                    "periode": f"{periode.nom} est déjà intégralement payée pour ce frais."
                })
            if montant is not None and montant > restant:
                raise serializers.ValidationError({
                    "montant": f"Le montant dépasse ce qu'il reste à payer pour {periode.nom} ({restant} GNF)."
                })
            return attrs

        # 3) Tout le reste (annuel, autre, ou un paiement sans mois/tranche précisé·e) : le frais
        #    dans son ensemble ne doit pas recevoir de paiement au-delà de son solde restant.
        restant = frais.montant_du - self._deja_verse(frais)
        if restant <= 0:
            if frais.montant_paye < frais.montant_du and frais.type_frais.periodicite == TypeFrais.Periodicite.AUTRE:
                raise serializers.ValidationError({
                    "montant": f"Le mois {frais.mois_reference.strftime('%m/%Y')} est déjà payé pour "
                               f"« {frais.type_frais.nom} » (via un autre frais de cet élève)."
                })
            raise serializers.ValidationError({"montant": "Ce frais est déjà intégralement payé."})
        if montant is not None and montant > restant:
            raise serializers.ValidationError({
                "montant": f"Le montant dépasse le solde restant ({restant} GNF)."
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
        # Date d'une transaction = date du jour, fixée par le serveur à la création (jamais saisie
        # ni modifiée ensuite) — voir DepenseViewSet.perform_create.
        read_only_fields = ["enregistre_par", "date"]
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
    # Étiquette « Statut de paiement (mensualité) » sous le nom de l'élève (PaymentsPage) —
    # distingue les élèves pris en charge par la Fondation.
    eleve_categorie_paiement = serializers.CharField(source="eleve.categorie_paiement", read_only=True)
    eleve_exonere_fratrie = serializers.BooleanField(source="eleve.exonere_fratrie", read_only=True)
    type_frais_nom = serializers.CharField(source="type_frais.nom", read_only=True)
    type_frais_est_mensuel = serializers.BooleanField(source="type_frais.est_mensuel", read_only=True)
    type_frais_periodicite = serializers.CharField(source="type_frais.periodicite", read_only=True)
    type_frais_numero_tranche = serializers.IntegerField(source="type_frais.numero_tranche", read_only=True)
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
            "id", "eleve", "eleve_nom", "eleve_categorie_paiement", "eleve_exonere_fratrie", "type_frais", "type_frais_nom", "type_frais_est_mensuel",
            "type_frais_periodicite", "type_frais_numero_tranche", "annee_scolaire",
            "montant", "montant_du", "date_echeance", "mois", "montant_paye", "solde", "statut", "paiements",
        ]

    @staticmethod
    def montant_parametre(eleve, type_frais, annee) -> Decimal:
        """Montant paramétré d'un type de frais pour un élève : tarif de sa classe pour l'année
        (Paiements → Tarifs par classe) s'il y en a un, sinon le montant standard du type."""
        tarif = None
        if eleve.classe_id:
            tarif = TarifClasse.objects.filter(
                type_frais=type_frais, classe_id=eleve.classe_id, annee_scolaire=annee,
            ).values_list("montant", flat=True).first()
        return tarif if tarif is not None else type_frais.montant_standard

    def validate(self, attrs):
        eleve = attrs.get("eleve", getattr(self.instance, "eleve", None))
        type_frais = attrs.get("type_frais", getattr(self.instance, "type_frais", None))
        annee = attrs.get("annee_scolaire", getattr(self.instance, "annee_scolaire", None))
        # Mois couvert (Mensuel/Autre) : champ `mois` s'il est fourni, sinon celui de l'échéance
        # (voir Frais.mois) — l'échéance elle-même peut être n'importe quelle date (date du jour).
        if attrs.get("mois"):
            attrs["mois"] = attrs["mois"].replace(day=1)
        echeance = (
            attrs.get("mois") or getattr(self.instance, "mois", None)
            or attrs.get("date_echeance", getattr(self.instance, "date_echeance", None))
        )
        if self.instance is None and eleve and type_frais and eleve.exonere_fratrie and est_scolarite(type_frais):
            raise serializers.ValidationError({"eleve": MESSAGE_ELEVE_BONUS})
        if self.instance is None and eleve and type_frais and annee:
            verifier_formule_scolarite(eleve.id, annee.id, type_frais, "type_frais")
        if type_frais and type_frais.est_mensuel and echeance and echeance.month not in MOIS_MENSUALITE:
            raise serializers.ValidationError({"mois" if attrs.get("mois") else "date_echeance": MESSAGE_MOIS_HORS_MENSUALITE})
        # Montant non modifiable : celui paramétré (tarif de la classe, sinon montant standard) —
        # seule la remise fidélité de 5 % d'un frais Annuel (voir PaymentsPage) peut le réduire.
        montant = attrs.get("montant")
        modifie = montant is not None and (self.instance is None or montant != self.instance.montant)
        if modifie and eleve and type_frais and annee:
            parametre = self.montant_parametre(eleve, type_frais, annee)
            autorises = {parametre}
            if type_frais.periodicite == TypeFrais.Periodicite.ANNUEL:
                autorises.add((parametre * Decimal("0.95")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            if montant not in autorises:
                raise serializers.ValidationError({
                    "montant": f"Le montant est fixé par le paramétrage ({parametre:.0f} GNF) et ne peut pas être modifié."
                })
        filtre = Frais.filtre_equivalents(eleve, type_frais, annee, echeance) if eleve and type_frais and annee else None
        if filtre is None:
            return attrs
        doublons = Frais.objects.filter(filtre)
        if self.instance:
            doublons = doublons.exclude(pk=self.instance.pk)
        existant = doublons.select_related("type_frais").first()
        if existant:
            if type_frais.usage in USAGES_INSCRIPTION:
                message = (
                    f"Cet élève a déjà un frais d'inscription/réinscription (« {existant.type_frais.nom} ») "
                    f"pour l'année {annee.libelle}."
                )
            elif type_frais.periodicite in (TypeFrais.Periodicite.AUTRE, TypeFrais.Periodicite.MENSUEL):
                statut = " (déjà payé)" if existant.statut == "paye" else ""
                nom_mois = MOIS_FR[echeance.month - 1]
                de_mois = f"d'{nom_mois}" if nom_mois[0] in "aeiouy" else f"de {nom_mois}"
                message = (
                    f"Cet élève a déjà un frais « {existant.type_frais.nom} » pour le mois {de_mois} "
                    f"{echeance.year}{statut} pour cette année {annee.libelle}."
                )
            else:
                message = f"Cet élève a déjà un frais « {existant.type_frais.nom} » pour l'année {annee.libelle}."
            raise serializers.ValidationError({"type_frais": message})
        return attrs
