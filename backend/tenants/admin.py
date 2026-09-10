from django.contrib import admin

from .models import Ecole, JournalActivite, ParametresEcole, PaiementEcole, PlanAbonnement


@admin.register(Ecole)
class EcoleAdmin(admin.ModelAdmin):
    list_display = ["nom", "plan", "abonnement_mensuel", "statut_abonnement", "actif", "date_creation"]
    list_filter = ["actif"]
    search_fields = ["nom", "email"]


@admin.register(PlanAbonnement)
class PlanAbonnementAdmin(admin.ModelAdmin):
    list_display = ["nom", "montant", "periodicite", "actif"]
    list_filter = ["periodicite", "actif"]


@admin.register(PaiementEcole)
class PaiementEcoleAdmin(admin.ModelAdmin):
    list_display = ["ecole", "mois", "montant", "mode_paiement", "date_paiement"]
    list_filter = ["mode_paiement"]


@admin.register(ParametresEcole)
class ParametresEcoleAdmin(admin.ModelAdmin):
    list_display = ["ecole", "devise", "bareme_notation", "moyenne_admission"]


@admin.register(JournalActivite)
class JournalActiviteAdmin(admin.ModelAdmin):
    list_display = ["horodatage", "action", "ecole", "acteur"]
    list_filter = ["action"]
