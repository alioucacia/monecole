"""Validation des paiements d'abonnement Djomy et prolongation automatique de l'abonnement.

Partagé par la vérification déclenchée depuis la page de l'administrateur
(`VerifierPaiementDjomyView`), la vérification automatique des paiements en attente à
l'ouverture des paramètres de l'école (`MonEcoleView`) et la commande planifiable
`verifier_paiements_djomy` — un paiement confirmé par Djomy réactive donc l'école même si
l'administrateur a fermé la page de paiement entre-temps."""

from datetime import date, timedelta

from django.db import transaction as db_transaction
from django.utils import timezone

from .models import (
    JOURS_ABONNEMENT_ANNUEL, JOURS_ABONNEMENT_MENSUEL, JournalActivite, PaiementEcole, TransactionAbonnement,
)

# Vocabulaire de statut Djomy non documenté publiquement (observé en sandbox : "CREATED") — on ne
# bascule à REUSSI/ECHOUE que sur une valeur explicitement reconnue parmi les plus probables,
# sinon la transaction reste EN_ATTENTE : jamais de faux positif qui débloquerait à tort l'accès
# d'une école qui n'a pas réellement payé.
STATUTS_REUSSIS = {"SUCCESS", "SUCCESSFUL", "COMPLETED", "PAID"}
STATUTS_ECHOUES = {"FAILED", "CANCELLED", "CANCELED", "EXPIRED", "ERROR", "REJECTED"}


JOURS_PAR_NB_MOIS = {1: JOURS_ABONNEMENT_MENSUEL, 3: 90, 12: JOURS_ABONNEMENT_ANNUEL}
NB_MOIS_PAR_PERIODICITE = {"mensuel": 1, "trimestriel": 3, "annuel": 12}


def jours_pour_transaction(transaction: TransactionAbonnement) -> int:
    """30 jours pour un paiement Mensuel, 90 pour un Trimestriel, 365 pour un Annuel."""
    return JOURS_PAR_NB_MOIS.get(transaction.nb_mois, JOURS_ABONNEMENT_MENSUEL * transaction.nb_mois)


def _premier_du_mois_dans(n_mois: int, depuis: date) -> date:
    total = depuis.year * 12 + depuis.month - 1 + n_mois
    return date(total // 12, total % 12 + 1, 1)


def verifier_transaction_djomy(transaction: TransactionAbonnement, acteur=None) -> TransactionAbonnement:
    """Interroge Djomy sur une transaction en attente et applique le résultat : si le paiement
    est réussi, prolonge l'abonnement de l'école (30 / 365 jours — voir
    `Ecole.prolonger_abonnement`, ce qui la réactive si elle était en retard ou bloquée) et
    enregistre les `PaiementEcole` correspondants (historique, factures). Une transaction déjà
    traitée est renvoyée telle quelle. Lève l'exception de `djomy.services` en cas d'erreur
    réseau/API (à retenter plus tard)."""
    from djomy import services as djomy_services

    if transaction.statut != TransactionAbonnement.Statut.EN_ATTENTE:
        return transaction

    statut_djomy = (djomy_services.get_payment_status(transaction.transaction_id).get("status") or "").upper()

    if statut_djomy in STATUTS_REUSSIS:
        with db_transaction.atomic():
            # Verrou : deux vérifications simultanées (page + commande planifiée) ne doivent
            # jamais prolonger deux fois l'abonnement pour le même paiement.
            transaction = TransactionAbonnement.objects.select_for_update().select_related("ecole").get(pk=transaction.pk)
            if transaction.statut != TransactionAbonnement.Statut.EN_ATTENTE:
                return transaction
            ecole = transaction.ecole
            jours = jours_pour_transaction(transaction)
            date_fin = ecole.prolonger_abonnement(jours)

            # Historique : un `PaiementEcole` par mois couvert (comme avant), pour la part
            # mensuelle du montant — n'agit plus sur le décompte, qui est porté par
            # `Ecole.date_fin_abonnement`.
            montant_mensuel = transaction.montant / transaction.nb_mois
            dernier_paiement = None
            for i in range(transaction.nb_mois):
                dernier_paiement, _ = PaiementEcole.objects.get_or_create(
                    ecole=ecole, mois=_premier_du_mois_dans(i, transaction.mois),
                    defaults={
                        "montant": montant_mensuel,
                        "mode_paiement": PaiementEcole.ModePaiement.MOBILE_MONEY,
                        "reference": transaction.transaction_id,
                    },
                )
            transaction.statut = TransactionAbonnement.Statut.REUSSI
            transaction.paiement = dernier_paiement
            transaction.verifie_le = timezone.now()
            transaction.save()
            JournalActivite.objects.create(
                acteur=acteur, action=JournalActivite.Action.PAIEMENT_ENREGISTRE, ecole=ecole,
                details=(
                    f"{transaction.montant} GNF — {jours} jours d'abonnement (Djomy, {transaction.payer_number}) — "
                    f"abonnement valable jusqu'au {date_fin:%d/%m/%Y}"
                ),
            )
    elif statut_djomy in STATUTS_ECHOUES:
        transaction.statut = TransactionAbonnement.Statut.ECHOUE
        transaction.verifie_le = timezone.now()
        transaction.save()
    return transaction


def verifier_transactions_en_attente(ecole=None, depuis_jours: int = 3, acteur=None) -> list[TransactionAbonnement]:
    """Vérifie toutes les transactions Djomy encore en attente (d'une école, ou de toutes),
    créées dans les `depuis_jours` derniers jours — une erreur Djomy sur l'une n'empêche pas
    les suivantes (elle sera retentée au prochain passage)."""
    qs = TransactionAbonnement.objects.filter(
        statut=TransactionAbonnement.Statut.EN_ATTENTE, cree_le__gte=timezone.now() - timedelta(days=depuis_jours),
    ).select_related("ecole")
    if ecole is not None:
        qs = qs.filter(ecole=ecole)
    resultats = []
    for transaction in qs:
        try:
            resultats.append(verifier_transaction_djomy(transaction, acteur=acteur))
        except Exception:  # noqa: BLE001 — erreur réseau/API Djomy : retentée au prochain passage
            resultats.append(transaction)
    return resultats
