from django.contrib import admin

from .models import AffectationTransport, PointageTransport, TicketBus, Trajet


@admin.register(Trajet)
class TrajetAdmin(admin.ModelAdmin):
    list_display = ["nom", "chauffeur_nom", "capacite", "effectif", "position_maj_le"]


@admin.register(AffectationTransport)
class AffectationTransportAdmin(admin.ModelAdmin):
    list_display = ["eleve", "trajet", "point_montee", "date_debut"]
    list_filter = ["trajet"]


@admin.register(PointageTransport)
class PointageTransportAdmin(admin.ModelAdmin):
    list_display = ["eleve", "trajet", "type_evenement", "horodatage"]
    list_filter = ["trajet", "type_evenement"]


@admin.register(TicketBus)
class TicketBusAdmin(admin.ModelAdmin):
    list_display = ["affectation", "mois", "montant", "paye"]
    list_filter = ["paye"]
