import uuid

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


class DocumentOfficiel(models.Model):
    """Document officiel émis par une école (bulletin, certificat de scolarité), vérifiable par
    QR code : le QR imprimé sur le PDF mène à une page publique qui affiche les informations
    ENREGISTRÉES ICI au moment de l'émission — un document retouché (moyenne modifiée dans le
    PDF…) ne correspond donc plus à ce que montre la vérification. Voir core/documents.py.

    Un même document régénéré à l'identique réutilise la même entrée (même `empreinte`) ; s'il
    change (note corrigée…), une nouvelle version est créée et l'ancienne reste vérifiable,
    signalée comme remplacée."""

    class Type(models.TextChoices):
        BULLETIN = "bulletin", "Bulletin scolaire"
        CERTIFICAT_SCOLARITE = "certificat_scolarite", "Certificat de scolarité"

    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, related_name="documents_officiels")
    type = models.CharField(max_length=30, choices=Type.choices)
    # SET_NULL : la vérification d'un document déjà remis reste possible même si le dossier de
    # l'élève est supprimé ensuite — toutes les informations affichées sont dans `donnees`.
    eleve = models.ForeignKey("people.EleveProfile", on_delete=models.SET_NULL, null=True, related_name="documents_officiels")
    reference = models.CharField(max_length=60, help_text="Ex: « periode:3 » ou « annee:2 » — regroupe les versions d'un même document")
    empreinte = models.CharField(max_length=64, help_text="SHA-256 du contenu enregistré")
    donnees = models.JSONField(default=dict)
    emis_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-emis_le"]
        verbose_name = "Document officiel"
        verbose_name_plural = "Documents officiels"
        indexes = [models.Index(fields=["type", "eleve", "reference"])]

    def __str__(self):
        return f"{self.get_type_display()} — {self.donnees.get('nom_complet', '?')} ({self.emis_le:%d/%m/%Y})"

    @property
    def code_court(self) -> str:
        """Code lisible imprimé sous le QR, à saisir à la main si le QR ne peut être scanné."""
        return self.token.hex[:10].upper()
