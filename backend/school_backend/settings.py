"""
Configuration Django pour le projet school_backend.
"""
from datetime import time, timedelta
from pathlib import Path

import dj_database_url
from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("SECRET_KEY", default="dev-secret-key-change-in-production")
DEBUG = config("DEBUG", default=True, cast=bool)
ALLOWED_HOSTS = config("DJANGO_ALLOWED_HOSTS", default="*", cast=Csv())

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Tiers
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    # Applications de l'école
    "accounts",
    "academics",
    "people",
    "grades",
    "attendance",
    "payments",
    "announcements",
    "library",
    "transport",
    "cantine",
    "messaging",
    "visio",
    "tenants",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Sert les fichiers statiques (compressés, avec cache-busting) directement depuis Gunicorn —
    # voir DEPLOYMENT.md. Sans effet en dev (docker-compose.yml lance `runserver`, qui sert déjà
    # les statiques lui-même quand DEBUG=True).
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "school_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "school_backend.wsgi.application"

DATABASES = {
    "default": dj_database_url.parse(
        config("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=600,
    )
}

AUTH_USER_MODEL = "accounts.User"

# Permet de se connecter avec le nom d'utilisateur, l'e-mail ou le numéro de téléphone
# (voir accounts.backends.MultiFieldAuthBackend). ModelBackend reste en repli pour tout
# ce qui n'est pas la connexion (permissions, admin Django...).
AUTHENTICATION_BACKENDS = [
    "accounts.backends.MultiFieldAuthBackend",
    "django.contrib.auth.backends.ModelBackend",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# STORAGES["staticfiles"] active la compression + le manifeste cache-busting de whitenoise
# (voir Dockerfile : `collectstatic` tourne à la construction de l'image). "default" (fichiers
# uploadés — logos, photos) reste le stockage disque standard de Django ; le déporter vers un
# stockage objet (S3...) est une étape d'infra à part, voir DEPLOYMENT.md.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Cache — Redis en production (REDIS_URL défini, voir docker-compose.prod.yml), sinon repli sur
# un cache mémoire local pour le dev sans dépendance supplémentaire. Ce cache est aussi celui
# utilisé par le throttling DRF ci-dessous : en production avec plusieurs workers/réplicas,
# REDIS_URL n'est pas optionnel — un cache en mémoire de processus ne serait pas partagé entre
# eux (quotas de throttling et valeurs mises en cache incohérents d'un worker à l'autre).
REDIS_URL = config("REDIS_URL", default="")
if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

REST_FRAMEWORK = {
    # PlateformeJWTAuthentication (et non JWTAuthentication directement) : c'est ici, et
    # nulle part ailleurs, qu'est bloqué l'accès en cas de maintenance plateforme ou
    # d'établissement suspendu/impayé — voir accounts/authentication.py pour le pourquoi.
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "accounts.authentication.PlateformeJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.DefaultPagination",
    "PAGE_SIZE": 20,
    # Propage le `code` d'une AuthenticationFailed (ex: "maintenance", "ecole_inactive") dans le
    # JSON de la réponse — DRF ne le fait pas nativement (voir school_backend/exceptions.py).
    "EXCEPTION_HANDLER": "school_backend.exceptions.custom_exception_handler",
    # Protège la DB partagée d'un pic ou d'un client abusif (le cache CACHES ci-dessus, donc
    # Redis en prod) — un pic dégrade en 429 pour le client en cause plutôt que de saturer les
    # connexions DB pour tout le monde. Taux volontairement larges (usage normal = très en
    # dessous) ; à resserrer si un abus réel est observé plutôt qu'à l'aveugle.
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": config("THROTTLE_RATE_ANON", default="100/minute"),
        "user": config("THROTTLE_RATE_USER", default="1000/minute"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=6),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    # Utilisé par le Super Admin pour voir la dernière connexion de chaque compte
    # (supervision des écoles, recherche globale).
    "UPDATE_LAST_LOGIN": True,
}

# En développement (DEBUG=True), on autorise n'importe quelle origine localhost : le port du
# frontend change souvent (5173 déjà pris par un autre projet, etc.) et bloquer sur une liste
# figée n'apporte aucune sécurité en local. En production (DEBUG=False), on repasse sur une
# liste blanche stricte via la variable d'environnement CORS_ALLOWED_ORIGINS.
if DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True
else:
    CORS_ALLOWED_ORIGINS = config(
        "CORS_ALLOWED_ORIGINS",
        default="http://localhost:5173,http://127.0.0.1:5173",
        cast=Csv(),
    )
CORS_ALLOW_CREDENTIALS = True
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

# URL du frontend, utilisée pour construire le lien envoyé dans l'e-mail de réinitialisation
# et le lien de vérification des badges (QR code).
FRONTEND_URL = config("FRONTEND_URL", default="http://localhost:5173")

# URL publique du backend, utilisée pour construire le lien de téléchargement du bulletin
# envoyé par SMS (doit être joignable directement, sans passer par le frontend).
BACKEND_PUBLIC_URL = config("BACKEND_PUBLIC_URL", default="http://localhost:8000")

# E-mail — par défaut les messages sont affichés dans la console (utile en dev).
# Configurer EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend + les variables
# EMAIL_HOST/EMAIL_PORT/EMAIL_HOST_USER/EMAIL_HOST_PASSWORD pour un envoi réel.
EMAIL_BACKEND = config("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = config("EMAIL_HOST", default="localhost")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="no-reply@ecole-manager.local")

# Durée de validité (en secondes) du lien de réinitialisation de mot de passe. 3 jours par défaut.
PASSWORD_RESET_TIMEOUT = config("PASSWORD_RESET_TIMEOUT", default=60 * 60 * 24 * 3, cast=int)

# Heure au-delà de laquelle un pointage enseignant est considéré comme un retard.
HEURE_LIMITE_PONCTUALITE = time(8, 15)

# Assistant IA élève (people/assistant_ia.py) — laisser vide pour des réponses simulées ;
# renseigner une clé Anthropic (et installer le paquet "anthropic") pour un vrai chat IA.
ANTHROPIC_API_KEY = config("ANTHROPIC_API_KEY", default="")

# SMS (people/sms.py) — laisser vide pour des SMS simulés (journalisés en console, comme avant) ;
# renseigner les 3 variables Twilio pour un envoi réel. Les numéros sont saisis dans ce projet
# sans indicatif international (ex: "624086668") : TWILIO_INDICATIF_DEFAUT est préfixé avant
# l'envoi pour obtenir le format E.164 attendu par Twilio (+224624086668 par défaut, Guinée).
TWILIO_ACCOUNT_SID = config("TWILIO_ACCOUNT_SID", default="")
TWILIO_AUTH_TOKEN = config("TWILIO_AUTH_TOKEN", default="")
TWILIO_FROM_NUMBER = config("TWILIO_FROM_NUMBER", default="")
TWILIO_INDICATIF_DEFAUT = config("TWILIO_INDICATIF_DEFAUT", default="+224")
