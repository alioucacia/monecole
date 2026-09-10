from django.contrib import admin

from .models import Annonce


@admin.register(Annonce)
class AnnonceAdmin(admin.ModelAdmin):
    list_display = ["titre", "auteur", "cible_role", "classe", "date_publication", "epingle"]
    list_filter = ["cible_role", "epingle"]
    search_fields = ["titre", "contenu"]
