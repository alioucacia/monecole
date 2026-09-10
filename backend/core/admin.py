from django.contrib import admin

from .models import SauvegardeLog


@admin.register(SauvegardeLog)
class SauvegardeLogAdmin(admin.ModelAdmin):
    list_display = ["date_lancement", "statut", "taille_octets", "duree_secondes"]
    list_filter = ["statut"]
