from django.contrib import admin

from .models import (
    AlerteParent, EleveBadge, EleveProfile, EnseignantProfile, GroupeRevision, HistoriqueStatutEleve,
    PaieEnseignant, PointageEnseignant,
)


@admin.register(EleveProfile)
class EleveProfileAdmin(admin.ModelAdmin):
    list_display = ["matricule", "user", "classe", "parent", "actif", "type_sortie"]
    search_fields = ["matricule", "user__first_name", "user__last_name"]
    list_filter = ["classe", "actif", "type_sortie"]


@admin.register(EnseignantProfile)
class EnseignantProfileAdmin(admin.ModelAdmin):
    list_display = ["matricule", "user", "specialite"]
    search_fields = ["matricule", "user__first_name", "user__last_name"]


admin.site.register(EleveBadge)
admin.site.register(PointageEnseignant)
admin.site.register(PaieEnseignant)
admin.site.register(GroupeRevision)
admin.site.register(AlerteParent)


@admin.register(HistoriqueStatutEleve)
class HistoriqueStatutEleveAdmin(admin.ModelAdmin):
    list_display = ["eleve", "evenement", "type_sortie", "date", "auteur"]
    list_filter = ["evenement", "type_sortie"]
    search_fields = ["eleve__matricule", "eleve__user__first_name", "eleve__user__last_name"]
