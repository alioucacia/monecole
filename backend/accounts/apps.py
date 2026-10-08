from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"
    verbose_name = "Comptes utilisateurs"

    def ready(self):
        from .audit import connecter_signaux

        connecter_signaux()
