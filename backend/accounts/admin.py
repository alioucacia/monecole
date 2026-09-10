from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import JournalUtilisateur, User


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
    list_display = ["utilisateur", "categorie", "description", "horodatage"]
    list_filter = ["categorie"]
    search_fields = ["utilisateur__username", "utilisateur__first_name", "utilisateur__last_name", "description"]
    date_hierarchy = "horodatage"
