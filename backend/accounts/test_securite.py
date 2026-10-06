from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts import securite
from accounts.models import EvenementSecurite, SessionActive, User

MDP = "Sup3r-Secret!"


class SecuriteSuperAdminTests(TestCase):
    def setUp(self):
        cache.clear()
        self.sa = User.objects.create_user(username="sa", password=MDP, role=User.Role.SUPERADMIN, email="sa@x.test")
        self.client = APIClient()

    def _login(self, mdp=MDP, appareil="pc-1"):
        return self.client.post(
            "/api/auth/login/", {"username": "sa", "password": mdp}, format="json", HTTP_X_DEVICE_ID=appareil,
        )

    def _auth(self, access):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return client

    def test_session_revocable(self):
        reponse = self._login()
        self.assertEqual(reponse.status_code, 200, reponse.data)
        client = self._auth(reponse.data["access"])
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)
        self.assertEqual(SessionActive.objects.filter(user=self.sa).count(), 1)

        r = client.post("/api/auth/securite/sessions/revoquer-toutes/", {"inclure_courante": True}, format="json")
        self.assertEqual(r.data["revoquees"], 1)
        r = client.get("/api/auth/me/")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "session_expiree")
        # Le refresh token de la session fermée ne la ressuscite pas.
        r = APIClient().post("/api/auth/refresh/", {"refresh": reponse.data["refresh"]}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_revoquer_autres_sessions_garde_la_courante(self):
        a = self._login(appareil="pc-1").data
        b = self._login(appareil="pc-2").data
        client_a = self._auth(a["access"])
        self.assertEqual(client_a.post("/api/auth/securite/sessions/revoquer-toutes/", {}, format="json").data["revoquees"], 1)
        self.assertEqual(client_a.get("/api/auth/me/").status_code, 200)
        self.assertEqual(self._auth(b["access"]).get("/api/auth/me/").status_code, 401)

    def test_verrouillage_apres_echecs(self):
        for _ in range(securite.MAX_ECHECS):
            self.assertEqual(self._login(mdp="faux").status_code, 401)
        r = self._login()  # bon mot de passe, mais compte verrouillé
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data["code"], "compte_verrouille")
        self.assertTrue(EvenementSecurite.objects.filter(user=self.sa, type=EvenementSecurite.Type.COMPTE_VERROUILLE).exists())

        securite.deverrouiller(self.sa)
        self.assertEqual(self._login().status_code, 200)

    def test_alerte_nouvel_appareil(self):
        self._login(appareil="pc-1")
        self.assertFalse(EvenementSecurite.objects.filter(type=EvenementSecurite.Type.CONNEXION_INHABITUELLE).exists())
        self._login(appareil="pc-1")
        self.assertFalse(EvenementSecurite.objects.filter(type=EvenementSecurite.Type.CONNEXION_INHABITUELLE).exists())
        self._login(appareil="telephone-inconnu")
        alerte = EvenementSecurite.objects.get(type=EvenementSecurite.Type.CONNEXION_INHABITUELLE)
        self.assertFalse(alerte.lu)

    def test_totp_ticket_et_codes_de_secours(self):
        client = self._auth(self._login().data["access"])
        r = client.post("/api/auth/securite/totp/initialiser/", {"mot_de_passe": MDP}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        secret = r.data["secret"]

        with mock.patch("accounts.securite.time.time", return_value=1_000_000_000):
            code = securite._code_totp(secret, 1_000_000_000 // 30)
            r = client.post("/api/auth/securite/totp/activer/", {"code": code}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        codes_secours = r.data["codes_secours"]
        self.assertEqual(len(codes_secours), securite.NB_CODES_SECOURS)

        r = self._login()
        self.assertEqual(r.status_code, 401)
        self.assertEqual((r.data["code"], r.data["methode"]), ("otp_requis", "totp"))
        ticket = r.data["ticket"]

        t2 = 1_000_000_000 + 60
        code2 = securite._code_totp(secret, t2 // 30)
        with mock.patch("accounts.securite.time.time", return_value=t2):
            # Sans ticket (identifiant seul) : refusé, même avec le bon code.
            r = self.client.post("/api/auth/verifier-otp-connexion/", {"identifiant": "sa", "code": code2}, format="json")
            self.assertEqual(r.status_code, 400)
            r = self.client.post("/api/auth/verifier-otp-connexion/", {"ticket": ticket, "code": code2}, format="json")
            self.assertEqual(r.status_code, 200, r.data)
            # Rejeu du même code : refusé.
            r = self.client.post("/api/auth/verifier-otp-connexion/", {"ticket": ticket, "code": code2}, format="json")
            self.assertEqual(r.status_code, 400)

        r = self.client.post("/api/auth/verifier-otp-connexion/", {"ticket": ticket, "code": codes_secours[0]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        r = self.client.post("/api/auth/verifier-otp-connexion/", {"ticket": ticket, "code": codes_secours[0]}, format="json")
        self.assertEqual(r.status_code, 400)  # code de secours à usage unique

    def test_otp_non_modifiable_par_profil(self):
        client = self._auth(self._login().data["access"])
        self.assertEqual(client.patch("/api/auth/me/", {"otp_actif": False}, format="json").status_code, 400)
        r = client.post("/api/auth/securite/otp/", {"mot_de_passe": "faux", "actif": True}, format="json")
        self.assertEqual(r.status_code, 400)
        r = client.post("/api/auth/securite/otp/", {"mot_de_passe": MDP, "actif": True}, format="json")
        self.assertEqual(r.data["otp_actif"], True)

    def test_changement_mot_de_passe_ferme_les_autres_sessions(self):
        a = self._login(appareil="pc-1").data
        b = self._login(appareil="pc-2").data
        client_a = self._auth(a["access"])
        r = client_a.post("/api/auth/change-password/", {"old_password": MDP, "new_password": "Nouv3au-Secret!"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(client_a.get("/api/auth/me/").status_code, 200)
        self.assertEqual(self._auth(b["access"]).get("/api/auth/me/").status_code, 401)

    def test_autres_roles_inchanges(self):
        User.objects.create_user(username="prof", password=MDP, role=User.Role.TEACHER)
        for _ in range(securite.MAX_ECHECS + 1):
            self.client.post("/api/auth/login/", {"username": "prof", "password": "faux"}, format="json")
        r = self.client.post("/api/auth/login/", {"username": "prof", "password": MDP}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(SessionActive.objects.exists())
        self.assertFalse(EvenementSecurite.objects.exists())
