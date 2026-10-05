from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from django.conf import settings
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from core.models import SauvegardeLog


class DateTransactionTests(TestCase):
    """Date d'une transaction = date du jour, fixée par le serveur (dépenses, paie enseignant)."""

    def setUp(self):
        from tenants.models import Ecole

        self.ecole = Ecole.objects.create(nom="Test", slug="test")
        self.admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.admin)

    def test_depense_date_du_jour_non_modifiable(self):
        from payments.models import CategorieDepense

        categorie = CategorieDepense.objects.create(ecole=self.ecole, nom="Divers")
        r = self.client_api.post("/api/payments/depenses/", {
            "date": "2020-01-01", "categorie": categorie.id, "motif": "Craies", "montant": "5000",
            "mode_paiement": "especes", "responsable": "Directeur",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["date"], timezone.localdate().isoformat())
        r = self.client_api.patch(f"/api/payments/depenses/{r.json()['id']}/", {"date": "2020-01-01"}, format="json")
        self.assertEqual(r.json()["date"], timezone.localdate().isoformat())

    def test_paie_enseignant_date_du_jour(self):
        from datetime import date

        from people.models import EnseignantProfile, PaieEnseignant

        prof = User.objects.create_user(username="prof", password="x", role="teacher", ecole=self.ecole)
        enseignant = EnseignantProfile.objects.create(user=prof, matricule="E1")
        paie = PaieEnseignant.objects.create(enseignant=enseignant, mois=date(2026, 9, 1), salaire_base=1000)
        url = f"/api/people/paies-enseignants/{paie.id}/"
        r = self.client_api.patch(url, {"payee": True, "date_paiement": "2020-01-01"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["date_paiement"], timezone.localdate().isoformat())
        r = self.client_api.patch(url, {"payee": False}, format="json")
        self.assertIsNone(r.json()["date_paiement"])


class SauvegardeTests(TestCase):
    def setUp(self):
        self.superadmin = User.objects.create_user(username="sa", password="x", role="superadmin")
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.superadmin)

    def test_curseurs_serveur_desactives(self):
        """PgBouncer (mode transaction) en production : sans ce réglage, `dumpdata` échouait."""
        self.assertTrue(settings.DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"])

    def test_sauvegarde_complete_reussit(self):
        from core import sauvegarde

        with TemporaryDirectory() as dossier, mock.patch.object(sauvegarde, "dossier_sauvegardes", return_value=Path(dossier)):
            log = sauvegarde.executer_sauvegarde()
            self.assertEqual(log.statut, SauvegardeLog.Statut.SUCCES, log.message)
            self.assertTrue((Path(dossier) / log.fichier).exists())

    def test_sauvegarde_bloquee_en_cours_est_liberee(self):
        ancienne = SauvegardeLog.objects.create(statut=SauvegardeLog.Statut.EN_COURS, message="Sauvegarde en cours…")
        SauvegardeLog.objects.filter(pk=ancienne.pk).update(date_lancement=timezone.now() - timedelta(days=3))

        r = self.client_api.get("/api/dashboard/sauvegardes/")
        self.assertEqual(r.status_code, 200)
        ancienne.refresh_from_db()
        self.assertEqual(ancienne.statut, SauvegardeLog.Statut.ECHEC)

        # Le lancement n'est plus refusé (409) à cause de l'ancienne entrée bloquée.
        with mock.patch("core.sauvegarde.threading.Thread"):
            r = self.client_api.post("/api/dashboard/sauvegardes/lancer/")
        self.assertEqual(r.status_code, 202, r.content)
