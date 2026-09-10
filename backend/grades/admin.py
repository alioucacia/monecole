from django.contrib import admin

from .models import Note, Periode


@admin.register(Periode)
class PeriodeAdmin(admin.ModelAdmin):
    list_display = ["nom", "annee_scolaire", "date_debut", "date_fin"]


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ["eleve", "matiere", "periode", "type_evaluation", "valeur", "coefficient", "date"]
    list_filter = ["periode", "matiere", "type_evaluation"]
    search_fields = ["eleve__user__first_name", "eleve__user__last_name"]
