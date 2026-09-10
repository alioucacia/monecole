from django.contrib import admin

from .models import Message


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ["expediteur", "destinataire", "date_envoi", "lu"]
    list_filter = ["lu"]
