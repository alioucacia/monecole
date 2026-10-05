from datetime import date
from decimal import Decimal

from django.test import TestCase

from academics.models import AnneeScolaire, Classe
from accounts.models import User
from people.fratrie import SEUIL_FRATRIE, rang_niveau
from people.models import EleveProfile
from tenants.models import Ecole


class FratrieTests(TestCase):
    def setUp(self):
        self.ecole = Ecole.objects.create(nom="Test", slug="test")
        self.annee = AnneeScolaire.objects.create(
            ecole=self.ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True,
        )
        self.parent = User.objects.create_user(username="papa", password="x", role="parent", ecole=self.ecole)
        # Guinée : primaire 1ère→6ème année, collège 7ème→10ème, lycée 11ème, 12ème, Terminale.
        self.classes = {
            nom: Classe.objects.create(nom=nom, niveau=niveau, cycle=cycle, annee_scolaire=self.annee)
            for nom, niveau, cycle in [
                ("Term A", "Terminale", "lycee"), ("11e A", "11ème", "lycee"), ("9e A", "9ème", "college"),
                ("7e A", "7ème", "college"), ("6e annee", "6ème année", "primaire"), ("3e annee", "3ème année", "primaire"),
                ("GS", "Grande Section", "prescolaire"),
            ]
        }
        self.n = 0

    def _enfant(self, classe, parent=None, actif=True):
        self.n += 1
        u = User.objects.create_user(username=f"e{self.n}", password="x", role="student", ecole=self.ecole)
        return EleveProfile.objects.create(
            user=u, matricule=f"M{self.n}", classe=self.classes[classe], parent=parent or self.parent, actif=actif,
        )

    def test_ordre_des_niveaux(self):
        ordre = sorted(self.classes.values(), key=rang_niveau)
        self.assertEqual([c.nom for c in ordre], ["GS", "3e annee", "6e annee", "7e A", "9e A", "11e A", "Term A"])
        francais = [
            Classe(nom=n, niveau=n, cycle=c, annee_scolaire=self.annee)
            for n, c in [("Terminale", "lycee"), ("2nde", "lycee"), ("1ère", "lycee"), ("3ème", "college"), ("6ème", "college"), ("CM2", "primaire"), ("CP", "primaire")]
        ]
        self.assertEqual(
            [c.nom for c in sorted(francais, key=rang_niveau)],
            ["CP", "CM2", "6ème", "3ème", "2nde", "1ère", "Terminale"],
        )

    def test_benjamin_exonere_a_partir_de_6_enfants(self):
        enfants = [self._enfant(c) for c in ["Term A", "11e A", "9e A", "7e A", "6e annee"]]
        self.assertEqual(SEUIL_FRATRIE, 6)
        self.assertFalse(EleveProfile.objects.filter(exonere_fratrie=True).exists())  # 5 enfants : rien

        sixieme = self._enfant("3e annee")
        self.assertTrue(sixieme.exonere_fratrie)
        sixieme.refresh_from_db()
        self.assertTrue(sixieme.exonere_fratrie)
        self.assertEqual(sixieme.facteur_mensualite, Decimal("0"))
        self.assertEqual(EleveProfile.objects.filter(exonere_fratrie=True).count(), 1)

        # Un 7e enfant encore plus petit prend la place.
        petit = self._enfant("GS")
        sixieme.refresh_from_db()
        petit.refresh_from_db()
        self.assertTrue(petit.exonere_fratrie)
        self.assertFalse(sixieme.exonere_fratrie)

        # Le petit quitte l'école : on retombe à 6 actifs, le 3e année redevient exonéré.
        petit.actif = False
        petit.save()
        sixieme.refresh_from_db()
        petit.refresh_from_db()
        self.assertTrue(sixieme.exonere_fratrie)
        self.assertFalse(petit.exonere_fratrie)

        # Un enfant change de parent : la fratrie passe à 5, plus personne n'est exonéré.
        enfants[0].parent = User.objects.create_user(username="autre", password="x", role="parent", ecole=self.ecole)
        enfants[0].save()
        self.assertFalse(EleveProfile.objects.filter(exonere_fratrie=True).exists())

    def test_api_expose_le_champ(self):
        for c in ["Term A", "11e A", "9e A", "7e A", "6e annee", "3e annee"]:
            self._enfant(c)
        from rest_framework.test import APIClient

        admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        client = APIClient()
        client.force_authenticate(admin)
        r = client.get("/api/people/eleves/", {"parent": self.parent.id})
        data = r.json()
        lignes = data["results"] if isinstance(data, dict) else data
        self.assertEqual([e["classe_nom"] for e in lignes if e["exonere_fratrie"]], ["3e annee"])
