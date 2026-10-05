"""Recalcul automatique de la réduction « fratrie » (voir people/fratrie.py) dès qu'un élève
change de parent, de classe ou de statut actif, est créé ou supprimé — ou qu'une classe change
de niveau/cycle (l'ordre des classes, donc le benjamin, peut alors changer)."""

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from academics.models import Classe

from .fratrie import recalculer_exoneration_fratrie
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
