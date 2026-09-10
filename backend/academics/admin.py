from django.contrib import admin

from .models import AnneeScolaire, Classe, Creneau, Enseignement, Matiere


@admin.register(AnneeScolaire)
class AnneeScolaireAdmin(admin.ModelAdmin):
    list_display = ["libelle", "date_debut", "date_fin", "active"]


@admin.register(Matiere)
class MatiereAdmin(admin.ModelAdmin):
    list_display = ["nom", "code", "coefficient"]
    search_fields = ["nom", "code"]


@admin.register(Classe)
class ClasseAdmin(admin.ModelAdmin):
    list_display = ["nom", "niveau", "annee_scolaire", "professeur_principal", "effectif"]
    list_filter = ["annee_scolaire", "niveau"]


@admin.register(Enseignement)
class EnseignementAdmin(admin.ModelAdmin):
    list_display = ["matiere", "classe", "enseignant"]
    list_filter = ["classe", "matiere"]


@admin.register(Creneau)
class CreneauAdmin(admin.ModelAdmin):
    list_display = ["classe", "enseignement", "jour", "heure_debut", "heure_fin", "salle"]
    list_filter = ["jour", "classe"]
