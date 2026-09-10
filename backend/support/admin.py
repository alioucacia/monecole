from django.contrib import admin

from .models import MessageTicket, Ticket


class MessageTicketInline(admin.TabularInline):
    model = MessageTicket
    extra = 0
    readonly_fields = ["auteur", "contenu", "fichier", "cree_le"]


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ["id", "sujet", "ecole", "auteur", "statut", "priorite", "cree_le", "maj_le"]
    list_filter = ["statut", "priorite", "ecole"]
    search_fields = ["sujet", "auteur__first_name", "auteur__last_name", "auteur__username"]
    inlines = [MessageTicketInline]
