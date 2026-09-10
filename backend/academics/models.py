import re
import unicodedata

from django.conf import settings
from django.db import models


class AnneeScolaire(models.Model):
    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="annees_scolaires")
    libelle = models.CharField(max_length=20, help_text="Ex: 2025-2026")
    date_debut = models.DateField()
    date_fin = models.DateField()
    active = models.BooleanField(default=False)

    class Meta:
        ordering = ["-date_debut"]
        unique_together = ["ecole", "libelle"]
        verbose_name = "Année scolaire"
        verbose_name_plural = "Années scolaires"

    def __str__(self):
        return self.libelle

    def save(self, *args, **kwargs):
        if self.active:
            AnneeScolaire.objects.filter(ecole=self.ecole).exclude(pk=self.pk).update(active=False)
        super().save(*args, **kwargs)


def _normaliser(texte: str) -> str:
    """Minuscules et sans accents, pour des comparaisons souples (ex: détecter '6ème'
    aussi bien que '6EME' ou '6e')."""
    normalise = unicodedata.normalize("NFKD", texte or "")
    return "".join(c for c in normalise if not unicodedata.combining(c)).lower()


# Mots-clés reconnus dans le libellé d'un niveau (« 6ème », « CM2», « Terminale D »...) pour
# deviner automatiquement son cycle. Volontairement large (variantes courantes en Guinée/
# Afrique francophone) — un libellé non reconnu laisse le cycle vide, à affecter manuellement.
# Expressions à plusieurs mots (« Grande Section »...) : recherchées comme sous-chaîne, le
# découpage en tokens ci-dessous les couperait sinon en deux morceaux non reconnus.
_PHRASES_CYCLE = {
    "prescolaire": ["petite section", "moyenne section", "grande section", "prescolaire", "maternelle", "creche", "garderie"],
    "primaire": ["primaire", "elementaire"],
    "college": ["college"],
    "lycee": ["lycee"],
}
# Mots ou codes courts (« ps », « cm2 », « 6e »...) : recherchés comme token isolé (pas en
# sous-chaîne) pour éviter les faux positifs (ex: « ps » ne doit pas matcher dans un autre mot).
_TOKENS_CYCLE = {
    "prescolaire": {"ps", "ms", "gs"},
    "primaire": {"cp", "ce1", "ce2", "cm1", "cm2"},
    "college": {"6eme", "5eme", "4eme", "3eme", "6e", "5e", "4e", "3e"},
    "lycee": {"seconde", "2nde", "2de", "premiere", "1ere", "1re", "terminale", "tle", "term", "bac"},
}


def deviner_cycle(niveau: str) -> str | None:
    """Devine le cycle (voir `Classe.Cycle`) à partir du libellé d'un niveau.
    None si aucun mot-clé reconnu — le cycle reste alors à affecter manuellement."""
    texte = _normaliser(niveau)
    for cycle, phrases in _PHRASES_CYCLE.items():
        if any(phrase in texte for phrase in phrases):
            return cycle
    tokens = set(re.findall(r"[a-z0-9]+", texte))
    for cycle, mots_cles in _TOKENS_CYCLE.items():
        if tokens & mots_cles:
            return cycle
    return None


class Classe(models.Model):
    class Cycle(models.TextChoices):
        PRESCOLAIRE = "prescolaire", "Préscolaire"
        PRIMAIRE = "primaire", "Primaire"
        COLLEGE = "college", "Collège"
        LYCEE = "lycee", "Lycée"

    nom = models.CharField(max_length=50, help_text="Ex: 6ème A")
    niveau = models.CharField(max_length=50, help_text="Ex: 6ème")
    cycle = models.CharField(
        max_length=20, choices=Cycle.choices, blank=True,
        help_text="Regroupement pédagogique (Préscolaire/Primaire/Collège/Lycée) — deviné "
                   "automatiquement depuis le niveau si laissé vide, modifiable manuellement.",
    )
    annee_scolaire = models.ForeignKey(AnneeScolaire, on_delete=models.CASCADE, related_name="classes")
    professeur_principal = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        limit_choices_to={"role": "teacher"},
        related_name="classes_dirigees",
    )
    capacite = models.PositiveIntegerField(default=30)

    class Meta:
        ordering = ["niveau", "nom"]
        unique_together = ["nom", "annee_scolaire"]

    def __str__(self):
        return f"{self.nom} ({self.annee_scolaire.libelle})"

    def save(self, *args, **kwargs):
        if not self.cycle:
            self.cycle = deviner_cycle(self.niveau) or ""
        super().save(*args, **kwargs)

    @property
    def effectif(self):
        return self.eleves.count()


class Matiere(models.Model):
    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, null=True, related_name="matieres")
    nom = models.CharField(max_length=100)
    code = models.CharField(max_length=20)
    coefficient = models.PositiveIntegerField(default=1)
    couleur = models.CharField(max_length=7, default="#6366f1", help_text="Couleur hexadécimale pour l'UI")

    class Meta:
        ordering = ["nom"]
        unique_together = ["ecole", "code"]

    def __str__(self):
        return self.nom


class Enseignement(models.Model):
    """Affectation d'un enseignant à une matière pour une classe donnée."""

    enseignant = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        limit_choices_to={"role": "teacher"},
        related_name="enseignements",
    )
    matiere = models.ForeignKey(Matiere, on_delete=models.CASCADE, related_name="enseignements")
    classe = models.ForeignKey(Classe, on_delete=models.CASCADE, related_name="enseignements")

    class Meta:
        unique_together = ["matiere", "classe"]
        ordering = ["classe__nom", "matiere__nom"]

    def __str__(self):
        return f"{self.matiere} - {self.classe} ({self.enseignant.get_full_name()})"


class Creneau(models.Model):
    """Créneau hebdomadaire de l'emploi du temps."""

    class Jour(models.TextChoices):
        LUNDI = "lundi", "Lundi"
        MARDI = "mardi", "Mardi"
        MERCREDI = "mercredi", "Mercredi"
        JEUDI = "jeudi", "Jeudi"
        VENDREDI = "vendredi", "Vendredi"
        SAMEDI = "samedi", "Samedi"

    classe = models.ForeignKey(Classe, on_delete=models.CASCADE, related_name="creneaux")
    enseignement = models.ForeignKey(Enseignement, on_delete=models.CASCADE, related_name="creneaux")
    jour = models.CharField(max_length=10, choices=Jour.choices)
    heure_debut = models.TimeField()
    heure_fin = models.TimeField()
    salle = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ["jour", "heure_debut"]

    def __str__(self):
        return f"{self.classe} - {self.enseignement.matiere} ({self.jour} {self.heure_debut})"
