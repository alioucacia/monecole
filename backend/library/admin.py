from django.contrib import admin

from .models import Emprunt, Livre


@admin.register(Livre)
class LivreAdmin(admin.ModelAdmin):
    list_display = ["titre", "auteur", "categorie", "exemplaires_total", "exemplaires_disponibles"]
    search_fields = ["titre", "auteur", "isbn"]


@admin.register(Emprunt)
class EmpruntAdmin(admin.ModelAdmin):
    list_display = ["livre", "eleve", "date_emprunt", "date_retour_prevue", "date_retour_effective", "statut"]
    list_filter = ["date_retour_effective"]
