"""Corbeille des élèves : supprimer un élève (fiche, sélection, « élèves sans paiement ») le place
ici au lieu de l'effacer. Il disparaît alors de toute la plateforme (voir
`ElevesHorsCorbeilleManager`), devient inactif et son compte de connexion est désactivé — mais
ses notes, frais et présences restent en base. Seul l'administrateur de l'école consulte la
corbeille, restaure un élève (tout revient à l'identique) ou le supprime définitivement.

Comme pour la suppression directe d'avant, un élève ayant au moins un paiement n'entre jamais dans
la corbeille : de l'argent encaissé ne doit pas disparaître de la Caisse (il faut l'archiver)."""

from django.db import transaction
from django.utils import timezone

from accounts.models import User

from .fratrie import recalculer_exoneration_fratrie
from .models import EleveProfile


def eleves_avec_paiements(ids) -> set:
    from payments.models import Paiement

    return set(Paiement.objects.filter(frais__eleve_id__in=ids).values_list("frais__eleve_id", flat=True))


def corbeille_qs(ecole_id):
    return EleveProfile.tous.filter(user__ecole_id=ecole_id, supprime_le__isnull=False)


@transaction.atomic
def mettre_a_la_corbeille(eleves, auteur) -> list[str]:
    """Place `eleves` (déjà vérifiés sans paiement par l'appelant) dans la corbeille. Renvoie
    leurs noms, pour le journal."""
    noms = []
    maintenant = timezone.now()
    for eleve in eleves:
        EleveProfile.tous.filter(pk=eleve.pk).update(
            supprime_le=maintenant, supprime_par=auteur, actif=False,
            actif_avant_corbeille=eleve.actif, compte_actif_avant_corbeille=eleve.user.is_active,
        )
        User.objects.filter(pk=eleve.user_id).update(is_active=False)
        noms.append(eleve.user.get_full_name())
    for parent_id in {e.parent_id for e in eleves if e.parent_id}:
        recalculer_exoneration_fratrie(parent_id)
    return noms


@transaction.atomic
def restaurer(ecole_id, ids) -> list[str]:
    """Sort de la corbeille les élèves `ids` de l'école : statut actif/inactif et compte de
    connexion retrouvent leur état d'avant la suppression."""
    eleves = list(corbeille_qs(ecole_id).filter(id__in=ids).select_related("user"))
    for eleve in eleves:
        EleveProfile.tous.filter(pk=eleve.pk).update(
            supprime_le=None, supprime_par=None, actif=eleve.actif_avant_corbeille,
        )
        User.objects.filter(pk=eleve.user_id).update(is_active=eleve.compte_actif_avant_corbeille)
    for parent_id in {e.parent_id for e in eleves if e.parent_id}:
        recalculer_exoneration_fratrie(parent_id)
    return [e.user.get_full_name() for e in eleves]


def supprimer_definitivement(ecole_id, ids=None) -> list[str]:
    """Efface pour de bon les élèves `ids` de la corbeille (toute la corbeille si `ids` est
    None), avec leur compte de connexion — leurs frais, notes et présences partent en cascade.
    Un élève qui aurait malgré tout un paiement est ignoré."""
    with transaction.atomic():
        qs = corbeille_qs(ecole_id).select_for_update()
        if ids is not None:
            qs = qs.filter(id__in=ids)
        eleves = list(qs.select_related("user"))
        proteges = eleves_avec_paiements([e.id for e in eleves])
        eleves = [e for e in eleves if e.id not in proteges]
        User.objects.filter(pk__in=[e.user_id for e in eleves]).delete()
    return [e.user.get_full_name() for e in eleves]
