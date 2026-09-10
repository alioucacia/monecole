"""Charge-test local — mesure un débit réel (req/s) sur VOTRE machine/infra, pas un chiffre
théorique. Voir DEPLOYMENT.md : cet environnement ne peut ni provisionner ni simuler une charge
de 100 000 req/s ; ce fichier sert à obtenir un premier nombre reproductible contre une pile
locale ou de staging, à comparer avant/après un changement (ex: activer plusieurs réplicas).

Utilisation :
    pip install -r requirements-dev.txt
    locust -f locustfile.py --host http://localhost:8000   # dev (docker-compose.yml)
    locust -f locustfile.py --host http://localhost         # prod locale, via nginx
                                                              # (docker-compose.prod.yml)
Puis ouvrir http://localhost:8089 pour lancer un run (nombre d'utilisateurs simulés, montée en
charge) et lire le débit (req/s) obtenu dans l'interface Locust.

Identifiants : par défaut ceux du Super Admin créé par `manage.py seed_data` (superadmin /
superadmin123) — uniquement valables sur une base seedée en local/staging, jamais en
production. Redéfinir via les variables d'environnement LOCUST_USERNAME/LOCUST_PASSWORD pour
tester avec un autre compte.
"""

import os

from locust import HttpUser, between, task

LOCUST_USERNAME = os.environ.get("LOCUST_USERNAME", "superadmin")
LOCUST_PASSWORD = os.environ.get("LOCUST_PASSWORD", "superadmin123")


class VisiteurAnonyme(HttpUser):
    """Simule le trafic non authentifié (page de connexion, notamment) — passe par
    `PlateformeBrandingView` -> `ParametresPlateforme.charger()`, le chemin le plus chaud de
    l'API (voir tenants/models.py), désormais mis en cache."""

    weight = 3
    wait_time = between(0.1, 1)

    @task
    def branding(self):
        self.client.get("/api/tenants/plateforme-branding/", name="/api/tenants/plateforme-branding/")


class UtilisateurConnecte(HttpUser):
    """Simule un utilisateur qui se connecte puis consulte quelques pages — exerce
    `PlateformeJWTAuthentication` (donc `ParametresPlateforme.charger()` en cache + la
    vérification d'abonnement de l'école) sur des requêtes authentifiées réelles."""

    weight = 1
    wait_time = between(1, 3)

    def on_start(self):
        response = self.client.post(
            "/api/auth/login/",
            json={"username": LOCUST_USERNAME, "password": LOCUST_PASSWORD},
            name="/api/auth/login/",
        )
        token = response.json().get("access") if response.ok else None
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}

    @task(2)
    def me(self):
        self.client.get("/api/auth/me/", headers=self.headers, name="/api/auth/me/")

    @task(1)
    def dashboard(self):
        self.client.get("/api/dashboard/", headers=self.headers, name="/api/dashboard/")
