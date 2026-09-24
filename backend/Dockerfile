FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Dimensionnement Gunicorn — règle de base 2×cœurs+1 pour les workers ; ajuster à la machine
# cible réelle (voir DEPLOYMENT.md), pas des valeurs à prendre telles quelles en prod.
ENV WEB_CONCURRENCY=4
ENV WEB_THREADS=4

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Fichiers statiques compressés + manifeste (whitenoise) générés à la construction de l'image,
# pas au démarrage du conteneur — évite que plusieurs réplicas ne réécrivent le manifeste en
# même temps au lancement. settings.py exige DATABASE_URL, absent à la construction (.env exclu
# par .dockerignore) : on lui passe une URL factice, limitée à cette commande — collectstatic ne
# se connecte jamais à la base, et le conteneur utilise la vraie DATABASE_URL à l'exécution.
RUN DATABASE_URL=postgres://build:build@localhost:5432/build python manage.py collectstatic --noinput

EXPOSE 8000

# Commande de production par défaut de l'image (voir DEPLOYMENT.md) : Gunicorn multi-worker/
# thread, pas `runserver` (mono-thread, dev uniquement). docker-compose.yml (dev local) écrase
# volontairement cette commande pour garder `runserver` — rechargement à chaud, migrations/seed
# automatiques à chaque démarrage.
# `exec` (et la forme JSON ci-dessous) : Gunicorn devient le PID 1 du conteneur et reçoit
# directement SIGTERM à l'arrêt (docker stop, rolling update...) — sans `exec`, ce serait le
# `sh -c` intermédiaire qui le recevrait, sans le relayer, empêchant un arrêt propre.
CMD ["sh", "-c", "exec gunicorn school_backend.wsgi:application --bind 0.0.0.0:8000 --workers ${WEB_CONCURRENCY} --threads ${WEB_THREADS} --worker-class gthread --timeout 30 --access-logfile - --error-logfile -"]
