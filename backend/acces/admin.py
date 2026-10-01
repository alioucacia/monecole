from django.contrib import admin

from .models import CarteAcces, Equipement, Passage

admin.site.register(Equipement)
admin.site.register(CarteAcces)


@admin.register(Passage)
class PassageAdmin(admin.ModelAdmin):
    list_display = ["horodatage", "nom_affiche", "sens", "methode", "equipement", "autorise"]
    list_filter = ["sens", "autorise", "methode"]
