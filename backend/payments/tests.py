from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from academics.models import AnneeScolaire, Classe
from accounts.models import User
from grades.models import Periode
from people.models import EleveProfile
from tenants.models import Ecole

from .models import Frais, Paiement, TarifClasse, TypeFrais


class BaseTests(TestCase):
    def setUp(self):
        self.ecole = Ecole.objects.create(nom="Test", slug="test")
        self.annee = AnneeScolaire.objects.create(
            ecole=self.ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True,
        )
        self.classe = Classe.objects.create(nom="7e A", niveau="7ème", cycle="college", annee_scolaire=self.annee)
        self.admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _eleve(self, n=1):
        u = User.objects.create_user(username=f"e{n}", password="x", role="student", ecole=self.ecole)
        return EleveProfile.objects.create(user=u, matricule=f"M{n}", classe=self.classe)


class FraisInscriptionCreationTests(BaseTests):
    def setUp(self):
        super().setUp()
        self.inscription = TypeFrais.objects.create(
            ecole=self.ecole, nom="Inscription", montant_standard=100000, periodicite="annuel", usage="inscription",
        )
        self.reinscription = TypeFrais.objects.create(
            ecole=self.ecole, nom="Réinscription", montant_standard=60000, periodicite="annuel", usage="reinscription",
        )
        TarifClasse.objects.create(
            ecole=self.ecole, type_frais=self.reinscription, classe=self.classe, annee_scolaire=self.annee, montant=75000,
        )

    def _creer(self, statut):
        r = self.client.post("/api/people/eleves/", {
            "first_name": "Awa", "last_name": "Diallo", "classe": self.classe.id, "statut_inscription": statut,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return EleveProfile.objects.get(pk=r.json()["id"])

    def test_statut_reinscription_initie_le_frais_de_reinscription(self):
        eleve = self._creer("reinscription")
        frais = Frais.objects.get(eleve=eleve)
        self.assertEqual(frais.type_frais, self.reinscription)
        self.assertEqual(frais.montant, Decimal("75000"))  # tarif de la classe

    def test_nouvelle_inscription_initie_le_frais_d_inscription(self):
        eleve = self._creer("nouveau")
        self.assertEqual(Frais.objects.get(eleve=eleve).type_frais, self.inscription)

    def test_changement_de_statut_convertit_le_frais_impaye(self):
        eleve = self._creer("nouveau")
        r = self.client.patch(f"/api/people/eleves/{eleve.id}/", {"statut_inscription": "reinscription"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        frais = Frais.objects.get(eleve=eleve)
        self.assertEqual((frais.type_frais, frais.montant), (self.reinscription, Decimal("75000")))

        # Une fois payé, le frais n'est plus touché.
        Paiement.objects.create(frais=frais, montant=1000)
        self.client.patch(f"/api/people/eleves/{eleve.id}/", {"statut_inscription": "nouveau"}, format="json")
        self.assertEqual(Frais.objects.get(eleve=eleve).type_frais, self.reinscription)


class TranchepuisMensualiteTests(BaseTests):
    def setUp(self):
        super().setUp()
        self.eleve = self._eleve()
        for i, (debut, fin) in enumerate([
            (date(2026, 10, 1), date(2026, 12, 31)), (date(2027, 1, 1), date(2027, 3, 31)), (date(2027, 4, 1), date(2027, 6, 30)),
        ], start=1):
            Periode.objects.create(annee_scolaire=self.annee, nom=f"Trimestre {i}", date_debut=debut, date_fin=fin)
        self.periodes = list(Periode.objects.filter(annee_scolaire=self.annee).order_by("date_debut"))
        self.type_tranche = TypeFrais.objects.create(ecole=self.ecole, nom="Scolarité par tranche", montant_standard=300000, periodicite="trimestriel")
        self.type_mensuel = TypeFrais.objects.create(ecole=self.ecole, nom="Mensualité", montant_standard=100000, periodicite="mensuel")
        self.frais_tranche = Frais.objects.create(
            eleve=self.eleve, type_frais=self.type_tranche, annee_scolaire=self.annee, montant=300000, date_echeance=date(2026, 10, 1),
        )
        r = self.client.post("/api/payments/paiements/", {
            "frais": self.frais_tranche.id, "montant": "300000", "periode": self.periodes[0].id,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def _frais_mensuel(self, mois):
        return self.client.post("/api/payments/frais/", {
            "eleve": self.eleve.id, "type_frais": self.type_mensuel.id, "annee_scolaire": self.annee.id,
            "montant": "100000", "mois": mois.isoformat(), "date_echeance": mois.isoformat(),
        }, format="json")

    def test_mensualite_permise_apres_tranche_hors_mois_couverts(self):
        r = self._frais_mensuel(date(2027, 1, 1))
        self.assertEqual(r.status_code, 201, r.content)
        r = self.client.post("/api/payments/paiements/", {
            "frais": r.json()["id"], "montant": "100000", "mois": "2027-01-01",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)

        # La 2e tranche (Janvier → Mars) ne peut plus être payée : Janvier l'a été en mensualité.
        r = self.client.post("/api/payments/paiements/", {
            "frais": self.frais_tranche.id, "montant": "1000", "periode": self.periodes[1].id,
        }, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("periode", r.json())

        # Suivi : Octobre (tranche 1) et Janvier (mensualité) payés, Février dû une seule fois.
        suivi = {m["mois"]: m for m in self.client.get(
            "/api/payments/frais/suivi-mensuel/", {"eleve": self.eleve.id, "annee_scolaire": self.annee.id},
        ).json()["mois"]}
        self.assertEqual(suivi["2026-10"]["statut"], "paye")
        self.assertEqual(suivi["2027-01"]["statut"], "paye")
        self.assertEqual(Decimal(suivi["2027-02"]["montant_du"]), Decimal("100000"))

    def test_mois_couvert_par_une_tranche_payee_refuse(self):
        # Frais créé pour Novembre (1re tranche) : refusé.
        r = self._frais_mensuel(date(2026, 11, 1))
        self.assertEqual(r.status_code, 400, r.content)
        # Paiement d'un mois de la 1re tranche via un frais mensuel d'un autre mois : refusé.
        frais = Frais.objects.create(
            eleve=self.eleve, type_frais=self.type_mensuel, annee_scolaire=self.annee, montant=100000,
            date_echeance=date(2027, 1, 1), mois=date(2027, 1, 1),
        )
        r = self.client.post("/api/payments/paiements/", {"frais": frais.id, "montant": "100000", "mois": "2027-06-01"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("mois", r.json())


class HistoriquePaiementsPdfTests(BaseTests):
    def test_pdf_genere(self):
        eleve = self._eleve()
        type_mensuel = TypeFrais.objects.create(ecole=self.ecole, nom="Mensualité", montant_standard=100000, periodicite="mensuel")
        frais = Frais.objects.create(
            eleve=eleve, type_frais=type_mensuel, annee_scolaire=self.annee, montant=100000,
            date_echeance=date(2026, 10, 1), mois=date(2026, 10, 1),
        )
        Paiement.objects.create(frais=frais, montant=60000, mois=date(2026, 10, 1), enregistre_par=self.admin, reference="R-1")
        r = self.client.get("/api/payments/frais/historique-paiements-pdf/", {"eleve": eleve.id, "annee_scolaire": self.annee.id})
        self.assertEqual(r.status_code, 200, r.content[:500])
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertTrue(r.content.startswith(b"%PDF"))

    def test_signataires_parametres_par_le_super_admin(self):
        from unittest import mock

        from django.template.loader import render_to_string

        eleve = self._eleve()
        type_mensuel = TypeFrais.objects.create(ecole=self.ecole, nom="Mensualité", montant_standard=100000, periodicite="mensuel")
        Frais.objects.create(
            eleve=eleve, type_frais=type_mensuel, annee_scolaire=self.annee, montant=100000,
            date_echeance=date(2026, 10, 1), mois=date(2026, 10, 1),
        )
        self.ecole.signataire_caissier = True
        self.ecole.signataire_caissier_nom = "Mamadou Diallo"
        self.ecole.signataire_comptable_nom = "Aïssatou Bah"
        self.ecole.signataire_fondateur = True
        self.ecole.save()
        self.admin.first_name, self.admin.last_name = "Ibrahima", "Camara"
        self.admin.save()
        with mock.patch("payments.views.render_to_string", wraps=render_to_string) as rendu:
            r = self.client.get("/api/payments/frais/historique-paiements-pdf/", {"eleve": eleve.id, "annee_scolaire": self.annee.id})
        self.assertEqual(r.status_code, 200, r.content[:500])
        html = render_to_string(*rendu.call_args.args)
        self.assertIn("Le Caissier", html)
        self.assertIn("Mamadou Diallo", html)
        self.assertIn("Le Comptable", html)
        self.assertIn("Aïssatou Bah", html)
        self.assertIn("Le Fondateur", html)
        self.assertIn("Ibrahima Camara", html)
