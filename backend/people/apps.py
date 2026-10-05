from django.apps import AppConfig


class PeopleConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "people"
    verbose_name = "Élèves & Enseignants"

    def ready(self):
        from . import signals  # noqa: F401 — réduction fratrie (voir people/signals.py)
