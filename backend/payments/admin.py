from django.contrib import admin

from .models import Frais, Paiement, TypeFrais


@admin.register(TypeFrais)
class TypeFraisAdmin(admin.ModelAdmin):
    list_display = ["nom", "montant_standard"]


@admin.register(Frais)
class FraisAdmin(admin.ModelAdmin):
    list_display = ["eleve", "type_frais", "montant", "date_echeance", "statut"]
    list_filter = ["type_frais", "annee_scolaire"]


@admin.register(Paiement)
class PaiementAdmin(admin.ModelAdmin):
    list_display = ["frais", "montant", "date_paiement", "mode_paiement"]
    list_filter = ["mode_paiement"]
