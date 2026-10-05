from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from academics.models import AnneeScolaire, Classe
from accounts.models import User
from people.models import EleveProfile, HistoriqueClasse
from tenants.models import Ecole


class AnneeVueTests(TestCase):
    def setUp(self):
        self.ecole = Ecole.objects.create(nom="Test", slug="test")
        self.a1 = AnneeScolaire.objects.create(ecole=self.ecole, libelle="2025-2026", date_debut=date(2025, 9, 1), date_fin=date(2026, 6, 30))
        self.a2 = AnneeScolaire.objects.create(ecole=self.ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True)
        self.c1 = Classe.objects.create(nom="6A-old", niveau="6", annee_scolaire=self.a1)
        self.c2 = Classe.objects.create(nom="5A-new", niveau="5", annee_scolaire=self.a2)
        u = User.objects.create_user(username="el", password="x", role="student", ecole=self.ecole)
        self.eleve = EleveProfile.objects.create(user=u, matricule="M1", classe=self.c2)
        HistoriqueClasse.objects.get_or_create(eleve=self.eleve, classe=self.c1, annee_scolaire=self.a1)
        u2 = User.objects.create_user(username="el2", password="x", role="student", ecole=self.ecole)
        self.parti = EleveProfile.objects.create(user=u2, matricule="M2", classe=self.c1, actif=False)
        self.admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        self.compta = User.objects.create_user(username="co", password="x", role="comptabilite", ecole=self.ecole)

    def _noms(self, client, url, **params):
        r = client.get(url, params)
        assert r.status_code == 200, r.content
        data = r.json()
        return sorted(x.get("nom") or x.get("matricule") for x in (data["results"] if isinstance(data, dict) else data))

    def test_filtre(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        self.assertEqual(self._noms(c, "/api/academics/classes/"), ["5A-new"])
        self.assertEqual(self._noms(c, "/api/academics/classes/", annee_vue=self.a1.id), ["6A-old"])
        self.assertEqual(self._noms(c, "/api/academics/classes/", toutes_annees=1), ["5A-new", "6A-old"])
        self.assertEqual(self._noms(c, "/api/people/eleves/"), ["M1"])
        self.assertEqual(self._noms(c, "/api/people/eleves/", annee_vue=self.a1.id), ["M1", "M2"])
        self.assertEqual(self._noms(c, "/api/people/eleves/", classe=self.c1.id), ["M2"])
        # Détail : jamais filtré.
        self.assertEqual(c.get(f"/api/academics/classes/{self.c1.id}/").status_code, 200)
        # Non-admin : `annee_vue` ignoré.
        c.force_authenticate(self.compta)
        self.assertEqual(self._noms(c, "/api/people/eleves/", annee_vue=self.a1.id), ["M1"])
        self.assertEqual(c.get("/api/dashboard/").status_code, 200)
        self.assertEqual(c.get("/api/payments/frais/", {"masquer_payes": 1}).status_code, 200)
        self.assertEqual(c.get("/api/payments/frais/summary/").status_code, 200)
        c.force_authenticate(self.admin)
        r = c.get("/api/dashboard/", {"annee_vue": self.a1.id})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["total_eleves"], 2)
        self.assertEqual(r.json()["total_classes"], 1)
        self.assertEqual(c.get("/api/payments/frais/suivi-mensuel-classe/", {"annee_vue": self.a1.id}).status_code, 200)

    def test_modules_annexes(self):
        """Cantine, transport, bibliothèque, messages, annonces : filtrés sans erreur, et un
        champ date-heure (message) borné par les dates de l'année, dernier jour inclus."""
        from datetime import datetime

        from django.utils import timezone

        from messaging.models import Message

        ancien = Message.objects.create(expediteur=self.admin, destinataire=self.compta, contenu="ancien")
        recent = Message.objects.create(expediteur=self.admin, destinataire=self.compta, contenu="récent")
        Message.objects.filter(pk=ancien.pk).update(date_envoi=timezone.make_aware(datetime(2026, 6, 30, 18, 0)))
        Message.objects.filter(pk=recent.pk).update(date_envoi=timezone.make_aware(datetime(2026, 10, 5, 9, 0)))

        c = APIClient()
        c.force_authenticate(self.admin)
        for url in (
            "/api/cantine/inscriptions/", "/api/cantine/tickets/", "/api/transport/affectations/",
            "/api/transport/tickets/", "/api/library/emprunts/", "/api/announcements/annonces/",
        ):
            self.assertIn(c.get(url, {"annee_vue": self.a1.id}).status_code, (200, 403), url)

        def contenus(**params):
            r = c.get("/api/messaging/messages/", params)
            self.assertEqual(r.status_code, 200, r.content)
            data = r.json()
            return [m["contenu"] for m in (data["results"] if isinstance(data, dict) else data)]

        self.assertEqual(contenus(), ["récent"])
        self.assertEqual(contenus(annee_vue=self.a1.id), ["ancien"])
