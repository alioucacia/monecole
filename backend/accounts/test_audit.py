from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import JournalUtilisateur, User
from academics.models import Matiere
from tenants.models import Ecole


class JournalAuditTests(TestCase):
    """Chaque création/modification/suppression faite via l'API est tracée (voir accounts.audit)."""

    def setUp(self):
        self.ecole = Ecole.objects.create(nom="Test", slug="test")
        self.admin = User.objects.create_user(
            username="ad", password="AncienMdp!2026", role="admin", ecole=self.ecole, first_name="Awa", last_name="Camara",
        )
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.admin)

    def _derniere(self):
        return JournalUtilisateur.objects.order_by("-id").first()

    def test_creation_modification_suppression(self):
        r = self.client_api.post("/api/academics/matieres/", {"nom": "Physique", "code": "PC"})
        self.assertEqual(r.status_code, 201, r.content)
        entree = self._derniere()
        self.assertEqual(entree.action, "creation")
        self.assertEqual(entree.categorie, "academique")
        self.assertEqual(entree.utilisateur, self.admin)
        self.assertEqual(entree.ecole, self.ecole)
        self.assertIn("Physique", entree.description)

        matiere_id = r.data["id"]
        r = self.client_api.patch(f"/api/academics/matieres/{matiere_id}/", {"coefficient": 3})
        self.assertEqual(r.status_code, 200, r.content)
        entree = self._derniere()
        self.assertEqual(entree.action, "modification")
        champs = entree.details[0]["champs"]
        self.assertEqual(len(champs), 1)
        self.assertEqual((champs[0]["avant"], champs[0]["apres"]), ("1", "3"))

        nb = JournalUtilisateur.objects.count()
        r = self.client_api.patch(f"/api/academics/matieres/{matiere_id}/", {"coefficient": 3})
        self.assertEqual(JournalUtilisateur.objects.count(), nb + 1)  # tracée même sans changement
        self.assertEqual(self._derniere().details, [])

        r = self.client_api.delete(f"/api/academics/matieres/{matiere_id}/")
        self.assertEqual(r.status_code, 204, r.content)
        entree = self._derniere()
        self.assertEqual(entree.action, "suppression")
        self.assertIn("Physique", entree.description)
        self.assertFalse(Matiere.objects.filter(pk=matiere_id).exists())

    def test_requete_refusee_non_tracee(self):
        nb = JournalUtilisateur.objects.count()
        r = self.client_api.post("/api/academics/matieres/", {})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(JournalUtilisateur.objects.count(), nb)

    def test_mot_de_passe_jamais_en_clair(self):
        r = self.client_api.post(
            "/api/auth/change-password/",
            {"old_password": "AncienMdp!2026", "new_password": "NouveauMdp!2026"},
        )
        self.assertEqual(r.status_code, 200, r.content)
        entree = self._derniere()
        self.assertNotIn("NouveauMdp", str(entree.details))
        self.assertNotIn("pbkdf2", str(entree.details))

    def test_historique_conserve_apres_suppression_du_compte(self):
        comptable = User.objects.create_user(username="cpt", password="x", role="comptabilite", ecole=self.ecole)
        client = APIClient()
        client.force_authenticate(comptable)
        client.patch("/api/auth/me/", {"first_name": "Moussa"})
        self.assertTrue(JournalUtilisateur.objects.filter(utilisateur=comptable).exists())

        comptable.delete()
        entree = JournalUtilisateur.objects.filter(utilisateur_nom="Moussa").first()
        self.assertIsNotNone(entree)
        self.assertIsNone(entree.utilisateur)
        self.assertEqual(entree.ecole, self.ecole)

    def test_journal_ecole_reserve_a_l_admin_et_cloisonne(self):
        autre_ecole = Ecole.objects.create(nom="Autre", slug="autre")
        autre_admin = User.objects.create_user(username="ad2", password="x", role="admin", ecole=autre_ecole)
        client_autre = APIClient()
        client_autre.force_authenticate(autre_admin)
        client_autre.post("/api/academics/matieres/", {"nom": "Secret", "code": "S"})
        self.client_api.post("/api/academics/matieres/", {"nom": "Physique", "code": "PC"})

        r = self.client_api.get("/api/auth/journal-ecole/", {"action": "creation"})
        self.assertEqual(r.status_code, 200, r.content)
        descriptions = [e["description"] for e in r.data["results"]]
        self.assertTrue(any("Physique" in d for d in descriptions))
        self.assertFalse(any("Secret" in d for d in descriptions))

        comptable = User.objects.create_user(username="cpt", password="x", role="comptabilite", ecole=self.ecole)
        client = APIClient()
        client.force_authenticate(comptable)
        self.assertEqual(client.get("/api/auth/journal-ecole/").status_code, 403)
