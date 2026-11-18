from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from tenants.models import Ecole


class CreationEcoleTests(TestCase):
    def setUp(self):
        self.sa = User.objects.create_user(username="sa", password="x", role=User.Role.SUPERADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.sa)

    def _payload(self, **kw):
        p = {
            "nom": "École Test", "ville": "Conakry", "pays": "Guinée",
            "admin_username": "admintest", "admin_first_name": "A", "admin_last_name": "B",
            "admin_email": "a@example.com", "annee_scolaire_libelle": "2026-2027",
        }
        p.update(kw)
        return p

    def test_creation(self):
        r = self.client.post("/api/tenants/ecoles/", self._payload(), format="multipart")
        self.assertEqual(r.status_code, 201, r.content[:500])
        self.assertTrue(User.objects.filter(username="admintest", ecole__nom="École Test").exists())

    def test_identifiant_deja_pris_ne_cree_pas_d_ecole(self):
        User.objects.create_user(username="AdminTest", password="x", role=User.Role.ADMIN)
        r = self.client.post("/api/tenants/ecoles/", self._payload(), format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("admin_username", r.json())
        self.assertFalse(Ecole.objects.filter(nom="École Test").exists())

    def test_panne_d_envoi_ne_fait_pas_echouer_la_creation(self):
        from unittest import mock

        with mock.patch("accounts.notifications.notifier_creation_admin_ecole", side_effect=OSError("SMTP")):
            r = self.client.post("/api/tenants/ecoles/", self._payload(), format="multipart")
        self.assertEqual(r.status_code, 201, r.content[:500])
        self.assertFalse(r.json()["notification_admin"]["email_envoye"])


class SuppressionEcoleTests(TestCase):
    def test_suppression_ecole_avec_donnees(self):
        from io import StringIO

        from django.core.management import call_command

        from accounts.services import definir_code_suppression

        call_command("seed_data", stdout=StringIO())
        ecole = Ecole.objects.first()
        sa = User.objects.create_user(username="sa2", password="x", role=User.Role.SUPERADMIN)
        definir_code_suppression(sa, "1234")
        client = APIClient()
        client.force_authenticate(sa)
        r = client.delete(f"/api/tenants/ecoles/{ecole.id}/", {"code_suppression": "1234"}, format="json")
        self.assertEqual(r.status_code, 204, r.content[:500])
        self.assertFalse(Ecole.objects.filter(pk=ecole.id).exists())
