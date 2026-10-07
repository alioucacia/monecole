import zipfile
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from django.apps import apps
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, connection
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from academics.models import AnneeScolaire, Classe, Matiere
from accounts.models import User
from core.models import OperationSauvegardeEcole
from core.sauvegarde_ecole import (
    MODELES_HORS_PERIMETRE, PERIMETRE, ArchiveInvalide, chemin_archive, executer_restauration, executer_sauvegarde,
    verifier_archive,
)
from grades.models import Note, Periode
from payments.models import Frais, Paiement, TypeFrais
from people.models import EleveProfile
from tenants.models import Ecole, ParametresEcole

URL = "/api/dashboard/sauvegardes-ecole/"


def _peupler(ecole, suffixe):
    annee = AnneeScolaire.objects.create(
        ecole=ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True,
    )
    classe = Classe.objects.create(nom=f"7e A {suffixe}", niveau="7ème", annee_scolaire=annee)
    matiere = Matiere.objects.create(ecole=ecole, nom="Maths")
    periode = Periode.objects.create(nom="T1", annee_scolaire=annee, date_debut=date(2026, 9, 1), date_fin=date(2026, 12, 31))
    parent = User.objects.create_user(username=f"parent{suffixe}", password="x", role="parent", ecole=ecole)
    eleve_user = User.objects.create_user(username=f"eleve{suffixe}", password="ancien", role="student", ecole=ecole)
    eleve_user.photo.save("photo.png", ContentFile(b"PNG-" + suffixe.encode()), save=True)
    eleve = EleveProfile.objects.create(user=eleve_user, matricule=f"M-{suffixe}", classe=classe, parent=parent)
    Note.objects.create(eleve=eleve, matiere=matiere, periode=periode, valeur=15, date=date(2026, 10, 1))
    type_frais = TypeFrais.objects.create(ecole=ecole, nom="Scolarité", montant_standard=1000, periodicite="autre")
    frais = Frais.objects.create(eleve=eleve, type_frais=type_frais, annee_scolaire=annee, montant=1000, date_echeance=date(2026, 10, 1))
    Paiement.objects.create(frais=frais, montant=500)
    return eleve


class TemporaireMixin:
    def setUp(self):
        super().setUp()
        self._dossier = TemporaryDirectory()
        base = Path(self._dossier.name)
        self._settings = override_settings(BASE_DIR=base, MEDIA_ROOT=base / "media")
        self._settings.enable()

    def tearDown(self):
        self._settings.disable()
        self._dossier.cleanup()
        super().tearDown()


class PerimetreTests(TestCase):
    def test_tout_modele_rattache_a_une_ecole_est_classe(self):
        """Un nouveau modèle de données scolaires doit être ajouté au PERIMETRE (sinon il ne
        serait ni sauvegardé ni restauré) ou explicitement exclu."""
        classes = {label for label, _ in PERIMETRE} | MODELES_HORS_PERIMETRE
        ignores = {"admin", "auth", "contenttypes", "sessions", "token_blacklist"}
        oublies = [
            m._meta.label for m in apps.get_models()
            if m._meta.app_label not in ignores and m._meta.label not in classes
        ]
        self.assertEqual(oublies, [])


class SauvegardeRestaurationTests(TemporaireMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.ecole = Ecole.objects.create(nom="École A", slug="a", adresse="Conakry")
        self.autre = Ecole.objects.create(nom="École B", slug="b")
        self.admin = User.objects.create_user(username="admin_a", password="secret", role="admin", ecole=self.ecole)
        self.eleve = _peupler(self.ecole, "a")
        self.eleve_b = _peupler(self.autre, "b")

    def _sauvegarder(self):
        operation = OperationSauvegardeEcole.objects.create(ecole=self.ecole, type="sauvegarde", auteur=self.admin)
        operation = executer_sauvegarde(operation)
        self.assertEqual(operation.statut, "succes", operation.message)
        return operation

    def test_aller_retour_complet(self):
        sauvegarde = self._sauvegarder()
        self.assertEqual(sauvegarde.resume["eleves"], 1)
        self.assertEqual(sauvegarde.resume["paiements"], 1)
        archive = chemin_archive(sauvegarde)
        with zipfile.ZipFile(archive) as z:
            self.assertIn("media/" + self.eleve.user.photo.name, z.namelist())
            self.assertNotIn("media/" + self.eleve_b.user.photo.name, z.namelist())

        # Changements après la sauvegarde.
        photo = self.eleve.user.photo.name
        default_storage.delete(photo)
        Classe.objects.filter(annee_scolaire__ecole=self.ecole).update(nom="Renommée")
        nouveau = User.objects.create_user(username="nouveau", password="x", role="teacher", ecole=self.ecole)
        self.eleve.user.delete()
        self.admin.set_password("nouveau-mdp")
        self.admin.save()
        self.ecole.adresse = "Kindia"
        self.ecole.abonnement_mensuel = 1234
        self.ecole.save()
        ParametresEcole.objects.filter(ecole=self.ecole).delete()

        restauration = OperationSauvegardeEcole.objects.create(
            ecole=self.ecole, type="restauration", auteur=self.admin, source=sauvegarde,
        )
        restauration = executer_restauration(restauration)
        self.assertEqual(restauration.statut, "succes", restauration.message)

        eleve = EleveProfile.objects.get(pk=self.eleve.pk)
        self.assertEqual(eleve.matricule, "M-a")
        self.assertTrue(eleve.user.check_password("ancien"))
        self.assertEqual(eleve.notes.count(), 1)
        self.assertEqual(Paiement.objects.filter(frais__eleve=eleve).count(), 1)
        self.assertEqual(Classe.objects.get(pk=eleve.classe_id).nom, "7e A a")
        self.assertFalse(User.objects.filter(pk=nouveau.pk).exists())
        self.assertTrue(default_storage.exists(photo))
        self.assertTrue(ParametresEcole.objects.filter(ecole=self.ecole).exists())
        # L'administrateur garde son accès actuel ; l'abonnement n'est pas touché.
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.check_password("nouveau-mdp"))
        self.ecole.refresh_from_db()
        self.assertEqual(self.ecole.adresse, "Conakry")
        self.assertEqual(self.ecole.abonnement_mensuel, 1234)
        # L'autre école n'est pas touchée.
        self.assertEqual(EleveProfile.objects.filter(user__ecole=self.autre).count(), 1)
        self.assertEqual(Note.objects.filter(eleve=self.eleve_b).count(), 1)
        # L'état d'avant restauration a été sauvegardé.
        self.assertTrue(OperationSauvegardeEcole.objects.filter(
            ecole=self.ecole, origine="avant_restauration", statut="succes",
        ).exists())

    def test_archive_d_une_autre_ecole_refusee(self):
        operation = OperationSauvegardeEcole.objects.create(ecole=self.autre, type="sauvegarde")
        operation = executer_sauvegarde(operation)
        with self.assertRaisesMessage(ArchiveInvalide, "autre établissement"):
            verifier_archive(chemin_archive(operation), self.ecole)

    def test_archive_modifiee_refusee(self):
        archive = chemin_archive(self._sauvegarder())
        modifiee = archive.with_name("modifiee.zip")
        with zipfile.ZipFile(archive) as source, zipfile.ZipFile(modifiee, "w") as cible:
            for nom in source.namelist():
                contenu = source.read(nom)
                if nom == "donnees.json":
                    contenu = contenu.replace(b'"role": "student"', b'"role": "superadmin"')
                cible.writestr(nom, contenu)
        with self.assertRaisesMessage(ArchiveInvalide, "corrompues"):
            verifier_archive(modifiee, self.ecole)

    def test_echec_ne_modifie_rien(self):
        sauvegarde = self._sauvegarder()
        nouveau = User.objects.create_user(username="nouveau", password="x", role="teacher", ecole=self.ecole)
        # Panne à la toute fin (contrôle d'intégrité), après suppression et réinsertion.
        with mock.patch.object(connection, "check_constraints", side_effect=IntegrityError("panne")):
            restauration = executer_restauration(OperationSauvegardeEcole.objects.create(
                ecole=self.ecole, type="restauration", source=sauvegarde,
            ))
        self.assertEqual(restauration.statut, "echec")
        self.assertIn("panne", restauration.message)
        self.assertTrue(User.objects.filter(pk=nouveau.pk).exists())


@mock.patch("core.sauvegarde.subprocess.Popen")
class SauvegardeEcoleApiTests(TemporaireMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.ecole = Ecole.objects.create(nom="École A", slug="a")
        self.admin = User.objects.create_user(username="admin_a", password="secret", role="admin", ecole=self.ecole)
        self.client_api = APIClient()
        self.client_api.force_authenticate(self.admin)

    def test_reserve_a_l_administrateur(self, _popen):
        for role in ("directeur", "teacher", "comptabilite"):
            user = User.objects.create_user(username=role, password="x", role=role, ecole=self.ecole)
            client = APIClient()
            client.force_authenticate(user)
            self.assertEqual(client.get(URL).status_code, 403, role)

    def test_lancer_puis_restaurer(self, popen):
        r = self.client_api.post(f"{URL}lancer/")
        self.assertEqual(r.status_code, 202, r.content)
        self.assertIn("--operation-id", popen.call_args.args[0])
        # Une seule opération à la fois.
        self.assertEqual(self.client_api.post(f"{URL}lancer/").status_code, 400)

        operation = executer_sauvegarde(OperationSauvegardeEcole.objects.get(pk=r.json()["id"]))
        self.assertTrue(self.client_api.get(URL).json()["results"][0]["disponible"])
        telechargement = self.client_api.get(f"{URL}{operation.pk}/telecharger/")
        self.assertEqual(telechargement.status_code, 200)
        telechargement.close()

        r = self.client_api.post(f"{URL}{operation.pk}/restaurer/", {"mot_de_passe": "faux"}, format="json")
        self.assertEqual(r.status_code, 403)
        r = self.client_api.post(f"{URL}{operation.pk}/restaurer/", {"mot_de_passe": "secret"}, format="json")
        self.assertEqual(r.status_code, 202, r.content)
        self.assertEqual(r.json()["type"], "restauration")

    def test_importer(self, _popen):
        operation = executer_sauvegarde(OperationSauvegardeEcole.objects.create(ecole=self.ecole, type="sauvegarde"))
        contenu = chemin_archive(operation).read_bytes()
        r = self.client_api.post(f"{URL}importer/", {
            "fichier": SimpleUploadedFile("ma_sauvegarde.zip", contenu), "mot_de_passe": "secret",
        }, format="multipart")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["origine"], "importee")
        self.assertTrue(r.json()["disponible"])

        r = self.client_api.post(f"{URL}importer/", {
            "fichier": SimpleUploadedFile("autre.zip", b"pas un zip"), "mot_de_passe": "secret",
        }, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_isolation_entre_ecoles(self, _popen):
        autre = Ecole.objects.create(nom="École B", slug="b")
        operation = executer_sauvegarde(OperationSauvegardeEcole.objects.create(ecole=autre, type="sauvegarde"))
        self.assertEqual(self.client_api.get(f"{URL}{operation.pk}/telecharger/").status_code, 404)
        r = self.client_api.post(f"{URL}{operation.pk}/restaurer/", {"mot_de_passe": "secret"}, format="json")
        self.assertEqual(r.status_code, 404)
