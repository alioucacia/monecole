"""Recalcul automatique de la réduction « fratrie » (voir people/fratrie.py) dès qu'un élève
change de parent, de classe ou de statut actif, est créé ou supprimé — ou qu'une classe change
de niveau/cycle (l'ordre des classes, donc le benjamin, peut alors changer), ou que le Super
Admin modifie le réglage « Élève Bonus » d'une école."""

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from academics.models import Classe

from tenants.models import Ecole

from .fratrie import recalculer_ecole, recalculer_eleve_sans_parent, recalculer_exoneration_fratrie
from .models import EleveProfile


@receiver(pre_save, sender=EleveProfile)
def _memoriser_ancien_parent(sender, instance, **kwargs):
    instance._ancien_parent_id = (
        EleveProfile.objects.filter(pk=instance.pk).values_list("parent_id", flat=True).first() if instance.pk else None
    )


@receiver(post_save, sender=EleveProfile)
def _fratrie_apres_enregistrement(sender, instance, **kwargs):
    for parent_id in {instance.parent_id, getattr(instance, "_ancien_parent_id", None)}:
        recalculer_exoneration_fratrie(parent_id)
    if not instance.parent_id:
        recalculer_eleve_sans_parent(instance)
    # Le recalcul passe par .update() : l'instance en mémoire (renvoyée par l'API) est remise à jour.
    instance.exonere_fratrie = EleveProfile.objects.filter(pk=instance.pk).values_list("exonere_fratrie", flat=True).first() or False


@receiver(post_delete, sender=EleveProfile)
def _fratrie_apres_suppression(sender, instance, **kwargs):
    recalculer_exoneration_fratrie(instance.parent_id)


@receiver(post_save, sender=Classe)
def _fratrie_apres_classe(sender, instance, created, **kwargs):
    if created:
        return
    parents = EleveProfile.objects.filter(classe=instance, parent__isnull=False).values_list("parent_id", flat=True).distinct()
    for parent_id in parents:
        recalculer_exoneration_fratrie(parent_id)


_REGLAGE_BONUS = ("eleve_bonus_actif", "eleve_bonus_seuil")


@receiver(pre_save, sender=Ecole)
def _memoriser_reglage_bonus(sender, instance, **kwargs):
    instance._ancien_reglage_bonus = (
        Ecole.objects.filter(pk=instance.pk).values_list(*_REGLAGE_BONUS).first() if instance.pk else None
    )


@receiver(post_save, sender=Ecole)
def _fratrie_apres_reglage_ecole(sender, instance, created, **kwargs):
    ancien = getattr(instance, "_ancien_reglage_bonus", None)
    if not created and ancien is not None and ancien != tuple(getattr(instance, c) for c in _REGLAGE_BONUS):
        recalculer_ecole(instance.pk)
