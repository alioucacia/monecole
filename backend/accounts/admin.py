from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import EvenementSecurite, JournalUtilisateur, SessionActive, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "first_name", "last_name", "email", "role", "is_active"]
    list_filter = ["role", "is_active", "is_staff"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Informations école", {"fields": ("role", "phone", "address", "photo", "date_of_birth")}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ("Informations école", {"fields": ("role", "phone", "address", "date_of_birth")}),
    )


@admin.register(JournalUtilisateur)
class JournalUtilisateurAdmin(admin.ModelAdmin):
    list_display = ["utilisateur_nom", "ecole", "action", "categorie", "description", "horodatage"]
    list_filter = ["action", "categorie"]
    search_fields = ["utilisateur_nom", "utilisateur__username", "description"]
    date_hierarchy = "horodatage"


@admin.register(EvenementSecurite)
class EvenementSecuriteAdmin(admin.ModelAdmin):
    list_display = ["user", "type", "niveau", "description", "adresse_ip", "horodatage"]
    list_filter = ["type", "niveau"]
    search_fields = ["user__username", "description", "adresse_ip"]
    date_hierarchy = "horodatage"


@admin.register(SessionActive)
class SessionActiveAdmin(admin.ModelAdmin):
    list_display = ["user", "appareil_libelle", "adresse_ip", "cree_le", "derniere_activite", "revoquee_le"]
    list_filter = ["revoquee_le"]
    search_fields = ["user__username", "adresse_ip"]
    exclude = ["sid"]
