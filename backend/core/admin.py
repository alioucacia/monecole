from django.contrib import admin

from .models import OperationSauvegardeEcole, SauvegardeLog


@admin.register(SauvegardeLog)
class SauvegardeLogAdmin(admin.ModelAdmin):
    list_display = ["date_lancement", "statut", "taille_octets", "duree_secondes"]
    list_filter = ["statut"]


@admin.register(OperationSauvegardeEcole)
class OperationSauvegardeEcoleAdmin(admin.ModelAdmin):
    list_display = ["date_lancement", "ecole", "type", "origine", "statut", "taille_octets", "duree_secondes"]
    list_filter = ["type", "statut", "origine"]
