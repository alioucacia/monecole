# Déploiement en production & charge élevée

## Ce que ce document répond, et ce qu'il ne répond pas

Objectif initial : « supporter 100 000 requêtes/seconde ». C'est le trafic d'un très grand site
public (échelle Twitter/Netflix). **Aucune configuration dans ce dépôt ne peut, à elle seule,
garantir ce chiffre** — ça dépend d'infrastructure (flotte de serveurs, base de données managée
avec réplicas, CDN, autoscaling derrière un vrai load balancer cloud) et de dépenses réelles, pas
de fichiers de config. Ce document ne prétend pas atteindre 100k req/s.

Ce qu'il fait : combler le vrai problème actuel — l'app tournait en pure configuration de
développement (serveur mono-thread, aucun cache, aucune protection contre les pics) et **n'aurait
tenu aucune charge concurrente sérieuse**. Elle est maintenant prête à scaler horizontalement.
Le débit final dépendra ensuite de la taille de l'infra qu'on branche dessus.

## Ce qui a changé

| Avant | Après |
|---|---|
| `runserver` (mono-thread, dev uniquement) | Gunicorn multi-worker/thread (`backend/Dockerfile`) |
| 1 seul processus backend | N réplicas derrière nginx (`docker-compose.prod.yml`) |
| Pas de cache | Redis (`CACHES`, `django-redis`) |
| Chaque requête authentifiée lisait `ParametresPlateforme` en base | Mis en cache, invalidé à l'écriture (`tenants/models.py`) |
| Pas de protection contre les pics/abus | Throttling DRF (`DEFAULT_THROTTLE_RATES`) |
| Fichiers statiques servis par Django | whitenoise (compressés, cache-busting) |
| Connexions Postgres 1:1 par worker | PgBouncer en pooling transaction devant Postgres |

## Démarrer la pile de production (locale ou sur un serveur)

```bash
# 1. Variables obligatoires (pas de valeur par défaut « pratique » pour la prod)
cp backend/.env.example .env.prod
# éditer .env.prod : SECRET_KEY (valeur longue et aléatoire, ex. `python -c "import secrets; print(secrets.token_urlsafe(50))"`),
# POSTGRES_PASSWORD, DJANGO_ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS, FRONTEND_URL, BACKEND_PUBLIC_URL

# 2. Construire et démarrer, avec 3 réplicas backend par exemple
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build --scale backend=3 -d

# 3. Migrations — À LA MAIN, une seule fois (pas dans le CMD de l'image : plusieurs réplicas
#    démarrant en même temps ne doivent pas lancer `migrate` en parallèle)
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend python manage.py migrate
```

Le service `nginx` écoute sur le port 80 et répartit entre les réplicas `backend` (voir
`nginx/nginx.conf` — répartition approximative par re-résolution DNS Docker, pas un vrai load
balancer ; suffisant pour mesurer un gain en local/staging, pas pour la production réelle).

## Recréer le compte Super Admin après une purge des données

Si toutes les données sont effacées (`flush`, restauration d'une base vide, incident...), plus
personne ne peut se connecter pour administrer la plateforme — `ensure_superadmin` recrée ce
premier compte :

```bash
python manage.py ensure_superadmin
# ou avec un identifiant/e-mail choisis :
python manage.py ensure_superadmin --username admin --email admin@monecole.com
# pour réinitialiser le mot de passe d'un Super Admin déjà existant :
python manage.py ensure_superadmin --force
```

Sans `--password`, un mot de passe aléatoire fort est généré et **affiché une seule fois** dans la
sortie de la commande (à noter immédiatement) — le changement de mot de passe est ensuite demandé
à la première connexion. La commande ne fait rien (sans `--force`) si un Super Admin existe déjà,
pour ne jamais écraser un compte par erreur.

## Tâches planifiées (cron)

Aucun ordonnanceur (Celery beat, django-crontab...) n'est utilisé dans ce projet — volontairement,
pour ne pas ajouter d'infrastructure supplémentaire (file de tâches, worker dédié) pour deux
commandes quotidiennes. Deux management commands sont **conçues pour tourner une fois par jour**
mais ne se déclenchent jamais toutes seules : c'est à l'ordonnanceur du système d'exploitation
(cron sur Linux, Planificateur de tâches sur Windows) de les invoquer.

- `backup_daily` — sauvegarde la base (dump JSON compressé), journalise le résultat dans
  `core.SauvegardeLog`, purge les sauvegardes de plus de 30 jours.
- `notifier_impayes` — envoie les rappels (email + SMS) aux parents dont un frais est en retard,
  toutes écoles confondues (limité à une relance par famille tous les 7 jours, voir
  `payments/notifications.py`).

Exemple de configuration cron (`/etc/cron.d/ecole-manager`, sur l'hôte qui exécute
`docker compose`) :

```cron
0 6 * * * root cd /chemin/vers/le/projet && docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend python manage.py backup_daily >> /var/log/ecole-manager/backup.log 2>&1
0 7 * * * root cd /chemin/vers/le/projet && docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend python manage.py notifier_impayes >> /var/log/ecole-manager/notifier.log 2>&1
```

Sans conteneurs (backend lancé directement dans un virtualenv) :

```cron
0 6 * * * www-data cd /chemin/vers/le/projet/backend && /chemin/vers/le/venv/bin/python manage.py backup_daily >> /var/log/ecole-manager/backup.log 2>&1
0 7 * * * www-data cd /chemin/vers/le/projet/backend && /chemin/vers/le/venv/bin/python manage.py notifier_impayes >> /var/log/ecole-manager/notifier.log 2>&1
```

Penser à créer `/var/log/ecole-manager/` (ou adapter le chemin) avant la première exécution, et à
vérifier que l'utilisateur qui exécute cron a le droit de lancer `docker compose`/d'écrire dans ce
dossier de logs.

## Dimensionner Gunicorn (`WEB_CONCURRENCY` / `WEB_THREADS`)

Règle de base : `workers = 2 × cœurs CPU + 1`. Avec `--worker-class gthread` et plusieurs
threads par worker, chaque worker peut traiter plusieurs requêtes I/O-bound (le cas de la
majorité des endpoints ici) en parallèle. Ajuster `WEB_CONCURRENCY`/`WEB_THREADS` dans
`.env.prod` selon la machine réelle, puis mesurer (voir plus bas) plutôt que deviner.

## Pourquoi PgBouncer

`CONN_MAX_AGE=600` (déjà réglé côté Django) fait qu'**un worker Gunicorn** réutilise sa connexion
Postgres pendant 10 minutes au lieu d'en ouvrir une par requête — bon point de départ, mais avec
`N réplicas × M workers`, on peut vite dépasser `max_connections` de Postgres (par défaut 100).
PgBouncer (mode `transaction`) mutualise un petit pool de vraies connexions Postgres derrière
un grand nombre de connexions clientes. En prod, `DATABASE_URL` du backend pointe sur PgBouncer,
jamais directement sur Postgres.

## Pourquoi Redis est obligatoire dès qu'il y a plus d'un worker/réplica

Sans `REDIS_URL`, le backend retombe sur un cache mémoire de processus (pratique en dev, voir
`school_backend/settings.py`) — **pas partagé** entre workers/réplicas. Deux conséquences en
prod sans Redis :
- Le cache de `ParametresPlateforme.charger()` (voir `tenants/models.py`) serait incohérent
  d'un worker à l'autre après une modification par le Super Admin.
- Les quotas de throttling DRF (`DEFAULT_THROTTLE_RATES`) seraient comptés séparément par
  worker — un client pourrait dépasser le quota réel en frappant des workers différents.

## Mesurer un débit réel (`locustfile.py`)

```bash
pip install -r backend/requirements-dev.txt
locust -f backend/locustfile.py --host http://localhost        # via nginx, pile prod locale
locust -f backend/locustfile.py --host http://localhost:8000   # dev (docker-compose.yml)
```

Ouvrir http://localhost:8089, lancer une montée en charge, lire le débit (req/s) obtenu. C'est
un chiffre **reproductible sur votre matériel**, pas une simulation de 100k req/s (cet
environnement ne peut ni provisionner ni charger-tester à cette échelle) — utile pour comparer
avant/après un changement (ex: passer de 1 à 3 réplicas).

## Étapes suivantes si un objectif chiffré précis (ex: 100k req/s) devient réel

À ne déclencher que lorsque l'usage réel le justifie (mesuré, pas anticipé) :

1. **Base de données managée avec réplicas de lecture** (RDS/Cloud SQL/etc.) — Postgres seul,
   même avec PgBouncer, plafonne avant l'application elle-même.
2. **Stockage objet + CDN pour les médias** (logos, photos, bulletins PDF) — `MEDIA_ROOT` sur
   disque local ne scale pas au-delà d'une machine ; voir `STORAGES["default"]` dans
   `settings.py` pour brancher un backend S3-compatible (ex. `django-storages`).
3. **Vrai load balancer cloud** (managé, avec health checks et retrait automatique d'un
   réplica en panne) à la place de l'nginx-DNS-resolve de `docker-compose.prod.yml`, qui est
   volontairement simple.
4. **Autoscaling** du nombre de réplicas backend selon la charge (Kubernetes HPA, ECS, etc.).
5. **Durcissement sécurité production** — `python manage.py check --deploy` liste déjà ce qui
   manque (HSTS, `SECURE_SSL_REDIRECT`, cookies `Secure`, `SECRET_KEY` fort) : à corriger avant
   toute exposition publique réelle, indépendamment du sujet débit.
