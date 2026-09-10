from django.contrib import admin

from .models import Formule, InscriptionCantine, PointageCantine, TicketCantine


@admin.register(Formule)
class FormuleAdmin(admin.ModelAdmin):
    list_display = ["nom", "responsable_nom", "prix", "capacite", "effectif"]


@admin.register(InscriptionCantine)
class InscriptionCantineAdmin(admin.ModelAdmin):
    list_display = ["eleve", "formule", "date_debut"]
    list_filter = ["formule"]


@admin.register(PointageCantine)
class PointageCantineAdmin(admin.ModelAdmin):
    list_display = ["eleve", "formule", "horodatage"]
    list_filter = ["formule"]


@admin.register(TicketCantine)
class TicketCantineAdmin(admin.ModelAdmin):
    list_display = ["inscription", "mois", "montant", "paye"]
    list_filter = ["paye"]
