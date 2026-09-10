from django.conf import settings
from django.db import models

from people.models import EleveProfile


class Livre(models.Model):
    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="livres")
    titre = models.CharField(max_length=200)
    auteur = models.CharField(max_length=150, blank=True)
    isbn = models.CharField(max_length=20, blank=True)
    categorie = models.CharField(max_length=100, blank=True)
    couverture = models.ImageField(upload_to="livres/couvertures/", blank=True, null=True)
    exemplaires_total = models.PositiveIntegerField(default=1)
    duree_emprunt_jours = models.PositiveSmallIntegerField(
        default=14, help_text="Durée par défaut (en jours) d'un emprunt de ce livre — préremplit la date de retour prévue."
    )
    date_ajout = models.DateField(auto_now_add=True)

    class Meta:
        ordering = ["titre"]

    def __str__(self):
        return self.titre

    @property
    def exemplaires_empruntes(self):
        return self.emprunts.filter(date_retour_effective__isnull=True).count()

    @property
    def exemplaires_disponibles(self):
        return max(self.exemplaires_total - self.exemplaires_empruntes, 0)


class Emprunt(models.Model):
    livre = models.ForeignKey(Livre, on_delete=models.CASCADE, related_name="emprunts")
    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="emprunts")
    date_emprunt = models.DateField(auto_now_add=True)
    date_retour_prevue = models.DateField()
    date_retour_effective = models.DateField(null=True, blank=True)
    enregistre_par = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="emprunts_enregistres"
    )

    class Meta:
        ordering = ["-date_emprunt"]

    def __str__(self):
        return f"{self.livre} - {self.eleve}"

    @property
    def statut(self):
        if self.date_retour_effective:
            return "rendu"
        from datetime import date
        return "en_retard" if date.today() > self.date_retour_prevue else "en_cours"
