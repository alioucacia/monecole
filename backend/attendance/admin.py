from django.contrib import admin

from .models import JustificatifAbsence, Presence


@admin.register(Presence)
class PresenceAdmin(admin.ModelAdmin):
    list_display = ["eleve", "date", "statut", "justifie", "creneau"]
    list_filter = ["statut", "justifie", "date"]
    search_fields = ["eleve__user__first_name", "eleve__user__last_name"]


@admin.register(JustificatifAbsence)
class JustificatifAbsenceAdmin(admin.ModelAdmin):
    list_display = ["eleve", "date_absence", "motif", "statut", "cree_le"]
    list_filter = ["statut", "motif"]
    search_fields = ["eleve__user__first_name", "eleve__user__last_name"]
