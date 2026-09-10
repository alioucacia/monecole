from django.db import models


class SauvegardeLog(models.Model):
    """Trace chaque exécution de la sauvegarde journalière de la plateforme (toutes écoles
    confondues, base de données partagée). Visible par le Super Admin uniquement."""

    class Statut(models.TextChoices):
        SUCCES = "succes", "Succès"
        ECHEC = "echec", "Échec"

    date_lancement = models.DateTimeField(auto_now_add=True)
    fichier = models.CharField(max_length=255, blank=True, help_text="Chemin du fichier de sauvegarde généré")
    taille_octets = models.BigIntegerField(default=0)
    duree_secondes = models.FloatField(default=0)
    statut = models.CharField(max_length=10, choices=Statut.choices, default=Statut.SUCCES)
    message = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-date_lancement"]
        verbose_name = "Sauvegarde"
        verbose_name_plural = "Sauvegardes"

    def __str__(self):
        return f"Sauvegarde du {self.date_lancement:%d/%m/%Y %H:%M} ({self.statut})"
