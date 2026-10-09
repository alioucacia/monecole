from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from academics.models import AnneeScolaire, Classe
from accounts.models import User
from people.models import EleveProfile, HistoriqueClasse
from tenants.models import Ecole


class AnneeVueTests(TestCase):
    """L'année affichée (sélecteur du haut, voir academics/annee.py) ne s'applique qu'à
    Paiements, Suivi mensuel, Dépenses, Caisse, Notes, Bulletins et Résultats."""

    def setUp(self):
        self.ecole = Ecole.objects.create(nom="Test", slug="test")
        self.a1 = AnneeScolaire.objects.create(ecole=self.ecole, libelle="2025-2026", date_debut=date(2025, 9, 1), date_fin=date(2026, 6, 30))
        self.a2 = AnneeScolaire.objects.create(ecole=self.ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True)
        self.c1 = Classe.objects.create(nom="6A-old", niveau="6", annee_scolaire=self.a1)
        self.c2 = Classe.objects.create(nom="5A-new", niveau="5", annee_scolaire=self.a2)
        u = User.objects.create_user(username="el", password="x", role="student", ecole=self.ecole)
        self.eleve = EleveProfile.objects.create(user=u, matricule="M1", classe=self.c2)
        HistoriqueClasse.objects.get_or_create(eleve=self.eleve, classe=self.c1, annee_scolaire=self.a1)
        self.admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        self.compta = User.objects.create_user(username="co", password="x", role="comptabilite", ecole=self.ecole)

        from grades.models import Periode
        from payments.models import CategorieDepense, Depense, Frais, TypeFrais

        cantine = TypeFrais.objects.create(ecole=self.ecole, nom="Cantine", montant_standard=1000, periodicite="autre")
        self.f1 = Frais.objects.create(eleve=self.eleve, type_frais=cantine, annee_scolaire=self.a1, montant=1000, date_echeance=date(2025, 10, 1))
        self.f2 = Frais.objects.create(eleve=self.eleve, type_frais=cantine, annee_scolaire=self.a2, montant=1000, date_echeance=date(2026, 10, 1))
        categorie = CategorieDepense.objects.create(ecole=self.ecole, nom="Divers")
        Depense.objects.create(ecole=self.ecole, categorie=categorie, motif="ancienne", montant=10, date=date(2026, 6, 30))
        Depense.objects.create(ecole=self.ecole, categorie=categorie, motif="récente", montant=10, date=date(2026, 10, 5))
        Periode.objects.create(nom="T1 old", annee_scolaire=self.a1, date_debut=date(2025, 9, 1), date_fin=date(2025, 12, 31))
        Periode.objects.create(nom="T1 new", annee_scolaire=self.a2, date_debut=date(2026, 9, 1), date_fin=date(2026, 12, 31))

    def _liste(self, client, url, champ, **params):
        r = client.get(url, params)
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        return sorted(str(x[champ]) for x in (data["results"] if isinstance(data, dict) else data))

    def test_ecrans_concernes_filtres_par_annee(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        self.assertEqual(self._liste(c, "/api/payments/frais/", "id"), [str(self.f2.id)])
        self.assertEqual(self._liste(c, "/api/payments/frais/", "id", annee_vue=self.a1.id), [str(self.f1.id)])
        self.assertEqual(self._liste(c, "/api/payments/depenses/", "motif"), ["récente"])
        self.assertEqual(self._liste(c, "/api/payments/depenses/", "motif", annee_vue=self.a1.id), ["ancienne"])
        self.assertEqual(self._liste(c, "/api/grades/periodes/", "nom", annee_vue=self.a1.id), ["T1 old"])
        self.assertEqual(self._liste(c, "/api/grades/periodes/", "nom", toutes_annees=1), ["T1 new", "T1 old"])
        self.assertEqual(c.get("/api/payments/frais/suivi-mensuel-classe/", {"annee_vue": self.a1.id}).status_code, 200)
        # Détail : jamais filtré.
        self.assertEqual(c.get(f"/api/payments/frais/{self.f1.id}/").status_code, 200)
        # Non-admin : `annee_vue` ignoré, toujours l'année active.
        c.force_authenticate(self.compta)
        self.assertEqual(self._liste(c, "/api/payments/frais/", "id", annee_vue=self.a1.id), [str(self.f2.id)])
        self.assertEqual(c.get("/api/payments/frais/", {"statut": "impaye"}).status_code, 200)
        self.assertEqual(c.get("/api/payments/frais/summary/").status_code, 200)

    def test_autres_ecrans_non_filtres(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        self.assertEqual(self._liste(c, "/api/academics/classes/", "nom", annee_vue=self.a1.id), ["5A-new", "6A-old"])
        self.assertEqual(self._liste(c, "/api/people/eleves/", "matricule", annee_vue=self.a1.id), ["M1"])
        r = c.get("/api/dashboard/", {"annee_vue": self.a1.id})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["total_classes"], 2)
