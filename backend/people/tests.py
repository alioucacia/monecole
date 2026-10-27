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

    def test_categorie_figee_des_le_premier_paiement_de_mensualite(self):
        from payments.models import Frais, Paiement, TypeFrais
        from rest_framework.test import APIClient

        eleve = self._enfant("9e A")
        admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        client = APIClient()
        client.force_authenticate(admin)
        url = f"/api/people/eleves/{eleve.id}/categorie-paiement/"

        # Avant tout paiement : modifiable.
        r = client.patch(url, {"categorie_paiement": "fondation_50"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIs(r.json()["categorie_figee"], False)
        self.assertIs(client.get(f"/api/people/eleves/{eleve.id}/").json()["categorie_figee"], False)

        mensuel = TypeFrais.objects.create(ecole=self.ecole, nom="Scolarité", montant_standard=100000, periodicite="mensuel")
        frais = Frais.objects.create(
            eleve=eleve, type_frais=mensuel, annee_scolaire=self.annee, montant=100000,
            date_echeance=date(2026, 10, 5), mois=date(2026, 10, 1),
        )
        Paiement.objects.create(frais=frais, montant=10000, mode_paiement="especes", mois=date(2026, 10, 1))

        # Après un paiement : la fiche signale la catégorie figée (liste grisée)...
        self.assertIs(client.get(f"/api/people/eleves/{eleve.id}/").json()["categorie_figee"], True)
        # ... et plus de changement de catégorie...
        r = client.patch(url, {"categorie_paiement": "fondation_gratuit"}, format="json")
        self.assertEqual(r.status_code, 400)
        # ... sauf renvoyer la même (ex: case fidélité cochée) ou revenir en Standard.
        r = client.patch(url, {"categorie_paiement": "fondation_50", "reduction_fidelite_mensualite": True}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        r = client.patch(url, {"categorie_paiement": "standard"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        r = client.patch(url, {"categorie_paiement": "fondation_50"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_paiement_par_tranche_fige_aussi_la_categorie(self):
        from payments.models import Frais, Paiement, TypeFrais
        from rest_framework.test import APIClient

        eleve = self._enfant("7e A")
        tranche = TypeFrais.objects.create(ecole=self.ecole, nom="1ère Tranche", montant_standard=300000, periodicite="trimestriel")
        inscription = TypeFrais.objects.create(ecole=self.ecole, nom="Inscription", montant_standard=50000, periodicite="annuel", usage="inscription")
        admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        client = APIClient()
        client.force_authenticate(admin)
        fiche = f"/api/people/eleves/{eleve.id}/"

        # Payer l'inscription ne fige rien.
        f_insc = Frais.objects.create(eleve=eleve, type_frais=inscription, annee_scolaire=self.annee, montant=50000, date_echeance=date(2026, 9, 30))
        Paiement.objects.create(frais=f_insc, montant=50000, mode_paiement="especes")
        self.assertIs(client.get(fiche).json()["categorie_figee"], False)

        # Une tranche de scolarité payée, si.
        f_tr = Frais.objects.create(eleve=eleve, type_frais=tranche, annee_scolaire=self.annee, montant=300000, date_echeance=date(2026, 12, 31))
        Paiement.objects.create(frais=f_tr, montant=1000, mode_paiement="especes")
        self.assertIs(client.get(fiche).json()["categorie_figee"], True)

    def test_eleve_bonus_ne_peut_pas_payer_la_scolarite(self):
        from payments.models import Frais, TypeFrais
        from rest_framework.test import APIClient

        for c in ["Term A", "11e A", "9e A", "7e A", "6e annee"]:
            self._enfant(c)
        bonus = self._enfant("3e annee")
        self.assertTrue(bonus.exonere_fratrie)

        mensuel = TypeFrais.objects.create(ecole=self.ecole, nom="Scolarité", montant_standard=100000, periodicite="mensuel")
        tranche = TypeFrais.objects.create(ecole=self.ecole, nom="1ère Tranche", montant_standard=300000, periodicite="trimestriel")
        cantine = TypeFrais.objects.create(ecole=self.ecole, nom="Cantine", montant_standard=50000, periodicite="autre")
        admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        client = APIClient()
        client.force_authenticate(admin)

        def creer(type_frais, **extra):
            return client.post("/api/payments/frais/", {
                "eleve": bonus.id, "type_frais": type_frais.id, "annee_scolaire": self.annee.id,
                "montant": str(type_frais.montant_standard), "date_echeance": "2026-10-05", **extra,
            }, format="json")

        self.assertEqual(creer(mensuel, mois="2026-10-01").status_code, 400)
        self.assertEqual(creer(tranche).status_code, 400)
        self.assertEqual(creer(cantine).status_code, 201)  # hors scolarité : reste dû

        # Frais de scolarité antérieur (créé avant l'exonération) : rien dû, encaissement refusé.
        ancien = Frais.objects.create(eleve=bonus, type_frais=tranche, annee_scolaire=self.annee, montant=300000, date_echeance="2026-12-31")
        self.assertEqual(ancien.montant_du, Decimal("0"))
        r = client.post("/api/payments/paiements/", {"frais": ancien.id, "montant": "1000", "mode_paiement": "especes"}, format="json")
        self.assertEqual(r.status_code, 400)

    def _fratrie_de_six(self):
        return [self._enfant(c) for c in ["Term A", "11e A", "9e A", "7e A", "6e annee", "3e annee"]]

    def test_super_admin_desactive_ou_change_le_seuil(self):
        enfants = self._fratrie_de_six()
        self.assertTrue(EleveProfile.objects.get(pk=enfants[-1].pk).exonere_fratrie)

        self.ecole.eleve_bonus_actif = False
        self.ecole.save()
        self.assertFalse(EleveProfile.objects.filter(exonere_fratrie=True).exists())

        self.ecole.eleve_bonus_actif = True
        self.ecole.eleve_bonus_seuil = 7
        self.ecole.save()
        self.assertFalse(EleveProfile.objects.filter(exonere_fratrie=True).exists())  # 6 < 7

        self.ecole.eleve_bonus_seuil = 3
        self.ecole.save()
        self.assertEqual(list(EleveProfile.objects.filter(exonere_fratrie=True)), [enfants[-1]])

    def test_super_admin_regle_l_option_par_l_api(self):
        from rest_framework.test import APIClient

        self._fratrie_de_six()
        sa = User.objects.create_user(username="sa", password="x", role="superadmin")
        client = APIClient()
        client.force_authenticate(sa)
        r = client.patch(f"/api/tenants/ecoles/{self.ecole.id}/", {"eleve_bonus_actif": False}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(EleveProfile.objects.filter(exonere_fratrie=True).exists())

    def test_admin_modifie_le_statut_bonus(self):
        from rest_framework.test import APIClient

        enfants = self._fratrie_de_six()
        auto = enfants[-1]
        admin = User.objects.create_user(username="ad", password="x", role="admin", ecole=self.ecole)
        client = APIClient()
        client.force_authenticate(admin)
        bonus = lambda: set(EleveProfile.objects.filter(exonere_fratrie=True).values_list("pk", flat=True))

        # Désigner un autre enfant : il remplace le Bonus automatique.
        r = client.patch(f"/api/people/eleves/{enfants[0].id}/bonus/", {"bonus_mode": "oui"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIs(r.json()["exonere_fratrie"], True)
        self.assertEqual(bonus(), {enfants[0].pk})

        # Retour en automatique, puis exclusion du benjamin : le Bonus passe au suivant.
        client.patch(f"/api/people/eleves/{enfants[0].id}/bonus/", {"bonus_mode": "auto"}, format="json")
        self.assertEqual(bonus(), {auto.pk})
        client.patch(f"/api/people/eleves/{auto.id}/bonus/", {"bonus_mode": "non"}, format="json")
        self.assertEqual(bonus(), {enfants[4].pk})  # 6e année

        # Élève sans parent désigné Bonus.
        u = User.objects.create_user(username="seul", password="x", role="student", ecole=self.ecole)
        seul = EleveProfile.objects.create(user=u, matricule="SEUL", classe=self.classes["GS"])
        self.assertFalse(seul.exonere_fratrie)
        r = client.patch(f"/api/people/eleves/{seul.id}/bonus/", {"bonus_mode": "oui"}, format="json")
        self.assertIs(r.json()["exonere_fratrie"], True)

        # Option désactivée : modification refusée.
        self.ecole.eleve_bonus_actif = False
        self.ecole.save()
        r = client.patch(f"/api/people/eleves/{auto.id}/bonus/", {"bonus_mode": "oui"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(EleveProfile.objects.filter(exonere_fratrie=True).exists())


class ArchivesElevesTests(TestCase):
    """Sortie (archivé / transféré / abandon / cycle terminé), reclassement et restauration d'un
    élève : rien n'est supprimé et l'historique survit à la restauration."""

    def setUp(self):
        from rest_framework.test import APIClient

        self.ecole = Ecole.objects.create(nom="Test", slug="test-archives")
        self.annee = AnneeScolaire.objects.create(
            ecole=self.ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True,
        )
        self.classe = Classe.objects.create(nom="7e A", niveau="7ème", cycle="college", annee_scolaire=self.annee)
        self.autre_classe = Classe.objects.create(nom="8e A", niveau="8ème", cycle="college", annee_scolaire=self.annee)
        self.admin = User.objects.create_user(username="adm", password="x", role="admin", ecole=self.ecole)
        u = User.objects.create_user(username="el1", password="x", role="student", ecole=self.ecole)
        self.eleve = EleveProfile.objects.create(user=u, matricule="EL1", classe=self.classe)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _url(self, action):
        return f"/api/people/eleves/{self.eleve.id}/{action}/"

    def test_transfert_puis_restauration_conserve_historique(self):
        r = self.client.post(self._url("sortie"), {
            "type_sortie": "transfert", "motif": "Déménagement", "etablissement_destination": "Lycée X",
        }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.data["actif"])
        self.assertEqual(r.data["type_sortie"], "transfert")
        self.assertEqual(r.data["etablissement_destination"], "Lycée X")
        self.assertEqual(r.data["classe"], self.classe.id)  # la classe n'est pas perdue

        r = self.client.get("/api/people/eleves/", {"actif": "false", "type_sortie": "transfert"})
        resultats = r.data["results"] if isinstance(r.data, dict) else r.data
        self.assertEqual([e["id"] for e in resultats], [self.eleve.id])
        self.assertEqual(self.client.get("/api/people/eleves/archives-resume/").data["transfert"], 1)

        r = self.client.post(self._url("restaurer"), {"classe": self.autre_classe.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data["actif"])
        self.assertEqual(r.data["type_sortie"], "")
        self.assertEqual(r.data["classe"], self.autre_classe.id)

        historique = self.client.get(self._url("historique-statut")).data
        self.assertEqual([h["evenement"] for h in historique], ["restauration", "sortie"])
        self.assertEqual(historique[1]["etablissement_destination"], "Lycée X")
        self.assertEqual(historique[1]["classe_nom"], "7e A")
        self.assertEqual(historique[0]["type_sortie"], "transfert")

    def test_reclassement_garde_la_date_de_sortie(self):
        self.client.post(self._url("sortie"), {"type_sortie": "archive", "date_sortie": "2027-01-15"}, format="json")
        r = self.client.post(self._url("sortie"), {"type_sortie": "abandon", "motif": "Abandon en cours d'année"}, format="json")
        self.assertEqual(r.data["type_sortie"], "abandon")
        self.assertEqual(r.data["date_sortie"], "2027-01-15")
        evenements = list(self.eleve.historique_statuts.values_list("evenement", flat=True))
        self.assertEqual(evenements, ["reclassement", "sortie"])

    def test_restaurer_un_eleve_actif_refuse(self):
        r = self.client.post(self._url("restaurer"), {}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_type_de_sortie_invalide(self):
        r = self.client.post(self._url("sortie"), {"type_sortie": "expulse"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_ancienne_api_marquer_non_reinscrit(self):
        r = self.client.post(self._url("marquer-non-reinscrit"), {"motif": "Parti"}, format="json")
        self.assertEqual(r.data["type_sortie"], "archive")
        r = self.client.post(self._url("reactiver"))
        self.assertTrue(r.data["actif"])
        self.assertEqual(self.eleve.historique_statuts.count(), 2)

    def test_sortie_groupee_ignore_les_inactifs(self):
        u = User.objects.create_user(username="el2", password="x", role="student", ecole=self.ecole)
        autre = EleveProfile.objects.create(user=u, matricule="EL2", classe=self.classe, actif=False, type_sortie="archive")
        r = self.client.post("/api/people/eleves/sortie-groupee/", {
            "ids": [self.eleve.id, autre.id], "type_sortie": "fin_cycle",
        }, format="json")
        self.assertEqual(r.data["sortis"], 1)
        autre.refresh_from_db()
        self.assertEqual(autre.type_sortie, "archive")


class CorbeilleElevesTests(TestCase):
    """Supprimer un élève le met à la corbeille (masqué partout, compte désactivé) ; seul
    l'administrateur la consulte, restaure ou supprime définitivement."""

    def setUp(self):
        from rest_framework.test import APIClient

        self.ecole = Ecole.objects.create(nom="Test", slug="test-corbeille")
        self.annee = AnneeScolaire.objects.create(
            ecole=self.ecole, libelle="2026-2027", date_debut=date(2026, 9, 1), date_fin=date(2027, 6, 30), active=True,
        )
        self.classe = Classe.objects.create(nom="7e A", niveau="7ème", cycle="college", annee_scolaire=self.annee)
        self.admin = User.objects.create_user(username="adm", password="x", role="admin", ecole=self.ecole)
        u = User.objects.create_user(username="el1", password="x", role="student", ecole=self.ecole)
        self.eleve = EleveProfile.objects.create(user=u, matricule="EL1", classe=self.classe)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _ids_liste(self):
        r = self.client.get("/api/people/eleves/")
        return [e["id"] for e in (r.data["results"] if isinstance(r.data, dict) else r.data)]

    def test_suppression_puis_restauration(self):
        r = self.client.delete(f"/api/people/eleves/{self.eleve.id}/")
        self.assertEqual(r.status_code, 204, r.content)
        self.assertNotIn(self.eleve.id, self._ids_liste())
        self.assertFalse(self.classe.eleves.exists())
        self.assertFalse(User.objects.get(username="el1").is_active)
        self.assertEqual([e["id"] for e in self.client.get("/api/people/eleves/corbeille/").data], [self.eleve.id])

        r = self.client.post("/api/people/eleves/corbeille/restaurer/", {"ids": [self.eleve.id]}, format="json")
        self.assertEqual(r.data["restaures"], 1)
        self.assertIn(self.eleve.id, self._ids_liste())
        self.eleve.refresh_from_db()
        self.assertTrue(self.eleve.actif)
        self.assertTrue(self.eleve.user.is_active)
        self.assertEqual(self.client.get("/api/people/eleves/corbeille/").data, [])

    def test_restauration_garde_le_statut_d_origine(self):
        self.eleve.actif = False
        self.eleve.save()
        User.objects.filter(pk=self.eleve.user_id).update(is_active=False)
        self.client.delete(f"/api/people/eleves/{self.eleve.id}/")
        self.client.post("/api/people/eleves/corbeille/restaurer/", {"ids": [self.eleve.id]}, format="json")
        self.eleve.refresh_from_db()
        self.assertFalse(self.eleve.actif)
        self.assertFalse(self.eleve.user.is_active)

    def test_suppression_definitive_et_vider(self):
        u = User.objects.create_user(username="el2", password="x", role="student", ecole=self.ecole)
        autre = EleveProfile.objects.create(user=u, matricule="EL2", classe=self.classe)
        r = self.client.post("/api/people/eleves/suppression-groupee/", {"ids": [self.eleve.id, autre.id]}, format="json")
        self.assertEqual(r.data["supprimes"], 2)

        r = self.client.post("/api/people/eleves/corbeille/supprimer/", {"ids": [self.eleve.id]}, format="json")
        self.assertEqual(r.data["supprimes"], 1)
        self.assertFalse(EleveProfile.tous.filter(pk=self.eleve.pk).exists())
        self.assertFalse(User.objects.filter(username="el1").exists())

        r = self.client.post("/api/people/eleves/corbeille/vider/")
        self.assertEqual(r.data["supprimes"], 1)
        self.assertFalse(User.objects.filter(username="el2").exists())

    def test_eleve_avec_paiement_jamais_a_la_corbeille(self):
        from payments.models import Frais, Paiement, TypeFrais

        type_frais = TypeFrais.objects.create(ecole=self.ecole, nom="Cantine", montant_standard=1000, periodicite="annuel")
        frais = Frais.objects.create(
            eleve=self.eleve, type_frais=type_frais, annee_scolaire=self.annee, montant=1000, date_echeance=date(2026, 10, 1),
        )
        Paiement.objects.create(frais=frais, montant=500)
        r = self.client.delete(f"/api/people/eleves/{self.eleve.id}/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.client.get("/api/people/eleves/corbeille/").data, [])

    def test_corbeille_reservee_a_l_administrateur(self):
        from rest_framework.test import APIClient

        self.client.delete(f"/api/people/eleves/{self.eleve.id}/")
        for role in ("directeur", "comptabilite"):
            client = APIClient()
            client.force_authenticate(User.objects.create_user(username=role, password="x", role=role, ecole=self.ecole))
            self.assertEqual(client.get("/api/people/eleves/corbeille/").status_code, 403)
            r = client.post("/api/people/eleves/corbeille/restaurer/", {"ids": [self.eleve.id]}, format="json")
            self.assertEqual(r.status_code, 403)

    def test_corbeille_limitee_a_l_ecole(self):
        from rest_framework.test import APIClient

        self.client.delete(f"/api/people/eleves/{self.eleve.id}/")
        autre_ecole = Ecole.objects.create(nom="Autre", slug="autre-corbeille")
        client = APIClient()
        client.force_authenticate(User.objects.create_user(username="adm2", password="x", role="admin", ecole=autre_ecole))
        self.assertEqual(client.get("/api/people/eleves/corbeille/").data, [])
        r = client.post("/api/people/eleves/corbeille/supprimer/", {"ids": [self.eleve.id]}, format="json")
        self.assertEqual(r.data["supprimes"], 0)
        self.assertTrue(EleveProfile.tous.filter(pk=self.eleve.pk).exists())
