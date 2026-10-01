"""Contrôle d'accès : équipements (lecteurs QR / RFID, biométrie, caméra, contrôleur de porte,
borne navigateur), cartes RFID et journal des passages (entrées / sorties) — voir
acces/services.py pour la logique et acces/views.py pour l'API des équipements."""

import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


def _nouvelle_cle() -> str:
    return secrets.token_urlsafe(32)


class Equipement(models.Model):
    """Un équipement connecté au contrôle d'accès. Il s'authentifie auprès de l'API avec sa
    `cle` secrète (en-tête `X-Cle-Equipement`), quelle que soit sa marque."""

    class Type(models.TextChoices):
        QR = "qr", "Lecteur QR code"
        RFID = "rfid", "Lecteur RFID / badge"
        BIOMETRIE = "biometrie", "Biométrie (empreinte, visage)"
        CAMERA = "camera", "Caméra (reconnaissance)"
        PORTE = "porte", "Contrôleur de porte / tourniquet"
        BORNE = "borne", "Borne navigateur (PC / tablette)"

    class Sens(models.TextChoices):
        AUTO = "auto", "Automatique (entrée puis sortie)"
        ENTREE = "entree", "Entrées uniquement"
        SORTIE = "sortie", "Sorties uniquement"

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, related_name="equipements_acces")
    nom = models.CharField(max_length=100, help_text="Ex : Portail principal")
    type = models.CharField(max_length=12, choices=Type.choices, default=Type.QR)
    sens = models.CharField(max_length=8, choices=Sens.choices, default=Sens.AUTO)
    cle = models.CharField(max_length=64, unique=True, default=_nouvelle_cle, editable=False)
    actif = models.BooleanField(default=True)
    derniere_activite = models.DateTimeField(null=True, blank=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["nom"]
        verbose_name = "Équipement d'accès"
        verbose_name_plural = "Équipements d'accès"

    def __str__(self):
        return f"{self.nom} ({self.get_type_display()})"


class CarteAcces(models.Model):
    """Carte / badge RFID (ou tout identifiant physique) associé à un élève ou un membre du
    personnel. Le QR code de la carte élève/enseignant et le matricule fonctionnent sans
    association : seules les cartes RFID doivent être enregistrées ici."""

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, related_name="cartes_acces")
    uid = models.CharField(max_length=100, help_text="Numéro lu par le lecteur RFID")
    personne = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cartes_acces")
    actif = models.BooleanField(default=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-cree_le"]
        constraints = [models.UniqueConstraint(fields=["ecole", "uid"], name="unique_carte_acces_ecole_uid")]
        verbose_name = "Carte d'accès"
        verbose_name_plural = "Cartes d'accès"

    def save(self, *args, **kwargs):
        self.uid = normaliser_uid(self.uid)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.uid} → {self.personne}"


def normaliser_uid(uid: str) -> str:
    """Les lecteurs RFID renvoient le même numéro avec ou sans séparateurs/zéros/casse selon le
    modèle : on ne garde que les caractères alphanumériques, en majuscules."""
    return "".join(c for c in (uid or "") if c.isalnum()).upper()


class Passage(models.Model):
    """Un passage (entrée ou sortie) enregistré par un équipement — ou une tentative refusée
    (identifiant inconnu, carte désactivée…)."""

    class Sens(models.TextChoices):
        ENTREE = "entree", "Entrée"
        SORTIE = "sortie", "Sortie"

    class Methode(models.TextChoices):
        QR = "qr", "QR code"
        RFID = "rfid", "Carte RFID"
        MATRICULE = "matricule", "Matricule (biométrie, caméra, saisie)"
        INCONNU = "inconnu", "Inconnu"

    ecole = models.ForeignKey("tenants.Ecole", on_delete=models.CASCADE, related_name="passages")
    equipement = models.ForeignKey(Equipement, on_delete=models.SET_NULL, null=True, blank=True, related_name="passages")
    personne = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="passages")
    nom_affiche = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=20, blank=True)
    classe = models.CharField(max_length=50, blank=True)
    sens = models.CharField(max_length=6, choices=Sens.choices, blank=True)
    horodatage = models.DateTimeField(default=timezone.now)
    methode = models.CharField(max_length=10, choices=Methode.choices, default=Methode.INCONNU)
    identifiant_lu = models.CharField(max_length=255, blank=True)
    autorise = models.BooleanField(default=True)
    motif_refus = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["-horodatage"]
        indexes = [models.Index(fields=["ecole", "horodatage"]), models.Index(fields=["personne", "horodatage"])]
        verbose_name = "Passage"
        verbose_name_plural = "Passages"

    def __str__(self):
        return f"{self.nom_affiche or '?'} — {self.get_sens_display() or 'refusé'} {self.horodatage:%d/%m/%Y %H:%M}"
