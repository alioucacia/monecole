from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from academics.models import AnneeScolaire, Matiere
from people.models import EleveProfile


class Periode(models.Model):
    nom = models.CharField(max_length=50, help_text="Ex: Trimestre 1")
    annee_scolaire = models.ForeignKey(AnneeScolaire, on_delete=models.CASCADE, related_name="periodes")
    date_debut = models.DateField()
    date_fin = models.DateField()

    class Meta:
        ordering = ["date_debut"]

    def __str__(self):
        return f"{self.nom} ({self.annee_scolaire.libelle})"


class Note(models.Model):
    class TypeEvaluation(models.TextChoices):
        DEVOIR = "devoir", "Devoir"
        COMPOSITION = "composition", "Composition"
        INTERROGATION = "interrogation", "Interrogation"
        PROJET = "projet", "Projet"

    eleve = models.ForeignKey(EleveProfile, on_delete=models.CASCADE, related_name="notes")
    matiere = models.ForeignKey(Matiere, on_delete=models.CASCADE, related_name="notes")
    enseignant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="notes_saisies")
    periode = models.ForeignKey(Periode, on_delete=models.CASCADE, related_name="notes")
    type_evaluation = models.CharField(max_length=20, choices=TypeEvaluation.choices, default=TypeEvaluation.DEVOIR)
    valeur = models.DecimalField(max_digits=4, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(20)])
    coefficient = models.PositiveIntegerField(default=1)
    date = models.DateField()
    commentaire = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"{self.eleve} - {self.matiere}: {self.valeur}/20"
