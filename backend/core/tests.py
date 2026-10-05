import os
from datetime import date, timedelta
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

    def test_nouveau_frais_echeance_date_du_jour_quel_que_soit_le_type(self):
        from academics.models import AnneeScolaire, Classe
        from people.models import EleveProfile
        from payments.models import TypeFrais

        annee = AnneeScolaire.objects.create(
            ecole=self.ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True,
        )
        classe = Classe.objects.create(nom="7e A", niveau="7ème", annee_scolaire=annee)
        u = User.objects.create_user(username="el", password="x", role="student", ecole=self.ecole)
        eleve = EleveProfile.objects.create(user=u, matricule="M1", classe=classe)
        for periodicite in ("annuel", "trimestriel", "autre"):
            type_frais = TypeFrais.objects.create(ecole=self.ecole, nom=f"Frais {periodicite}", montant_standard=1000, periodicite=periodicite)
            r = self.client_api.post("/api/payments/frais/", {
                "eleve": eleve.id, "type_frais": type_frais.id, "annee_scolaire": annee.id,
                "montant": "1000", "date_echeance": "2027-06-30",
            }, format="json")
            self.assertEqual(r.status_code, 201, (periodicite, r.content))
            self.assertEqual(r.json()["date_echeance"], timezone.localdate().isoformat(), periodicite)

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

        # Le lancement n'est plus refusé (409) à cause de l'ancienne entrée bloquée, et part dans
        # un processus séparé (`backup_daily --log-id`), pas dans le processus web.
        from core import sauvegarde

        with TemporaryDirectory() as dossier, \
                mock.patch.object(sauvegarde, "dossier_sauvegardes", return_value=Path(dossier)), \
                mock.patch("core.sauvegarde.subprocess.Popen") as popen:
            r = self.client_api.post("/api/dashboard/sauvegardes/lancer/")
        self.assertEqual(r.status_code, 202, r.content)
        commande = popen.call_args.args[0]
        self.assertEqual(commande[-3:], ["backup_daily", "--log-id", str(r.json()["id"])])

    def test_commande_complete_l_entree_lancee_depuis_la_page(self):
        from django.core.management import call_command

        from core import sauvegarde

        log = SauvegardeLog.objects.create(statut=SauvegardeLog.Statut.EN_COURS, message="Sauvegarde en cours…")
        with TemporaryDirectory() as dossier, mock.patch.object(sauvegarde, "dossier_sauvegardes", return_value=Path(dossier)):
            call_command("backup_daily", log_id=log.pk, stdout=open(os.devnull, "w"))
        log.refresh_from_db()
        self.assertEqual(log.statut, SauvegardeLog.Statut.SUCCES, log.message)
        self.assertEqual(SauvegardeLog.objects.count(), 1)  # pas de seconde entrée créée

    def test_interruption_affiche_la_fin_du_journal(self):
        from core import sauvegarde

        log = SauvegardeLog.objects.create(statut=SauvegardeLog.Statut.EN_COURS, message="Sauvegarde en cours…")
        SauvegardeLog.objects.filter(pk=log.pk).update(date_lancement=timezone.now() - timedelta(hours=2))
        with TemporaryDirectory() as dossier, mock.patch.object(sauvegarde, "dossier_sauvegardes", return_value=Path(dossier)):
            (Path(dossier) / "derniere_sauvegarde.log").write_text(
                f"Sauvegarde #{log.pk} lancée le 05/10/2026 10:00:00\nTraceback...\nMemoryError\n", encoding="utf-8",
            )
            sauvegarde.marquer_sauvegardes_interrompues()
        log.refresh_from_db()
        self.assertEqual(log.statut, SauvegardeLog.Statut.ECHEC)
        self.assertIn("MemoryError", log.message)
