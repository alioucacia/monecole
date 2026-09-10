from django.contrib import admin

from .models import (
    AlerteParent, EleveBadge, EleveProfile, EnseignantProfile, GroupeRevision,
    PaieEnseignant, PointageEnseignant,
)


@admin.register(EleveProfile)
class EleveProfileAdmin(admin.ModelAdmin):
    list_display = ["matricule", "user", "classe", "parent"]
    search_fields = ["matricule", "user__first_name", "user__last_name"]
    list_filter = ["classe"]


@admin.register(EnseignantProfile)
class EnseignantProfileAdmin(admin.ModelAdmin):
    list_display = ["matricule", "user", "specialite"]
    search_fields = ["matricule", "user__first_name", "user__last_name"]


admin.site.register(EleveBadge)
admin.site.register(PointageEnseignant)
admin.site.register(PaieEnseignant)
admin.site.register(GroupeRevision)
admin.site.register(AlerteParent)
