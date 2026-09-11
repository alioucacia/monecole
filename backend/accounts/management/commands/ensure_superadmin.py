"""Recrée le compte Super Admin de la plateforme s'il n'en existe aucun — utile après une purge
totale des données (`flush`, restauration d'une base vide...), qui laisserait sinon l'application
sans personne capable de s'y connecter pour gérer la plateforme.

Idempotent par défaut : ne fait rien (et le signale) si un Super Admin existe déjà — pour
réinitialiser son mot de passe malgré tout, ajouter --force.

Exemples :
    python manage.py ensure_superadmin
    python manage.py ensure_superadmin --username admin --email admin@ecole.com
    python manage.py ensure_superadmin --password "un-mot-de-passe-fort"
    python manage.py ensure_superadmin --force   # réinitialise même si un superadmin existe déjà
"""
import secrets

from django.core.management.base import BaseCommand
from django.db import IntegrityError

from accounts.models import User


class Command(BaseCommand):
    help = "Crée (ou réinitialise avec --force) le compte Super Admin de la plateforme."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="superadmin", help="Identifiant de connexion (défaut : superadmin)")
        parser.add_argument("--email", default="superadmin@taly-school.com", help="Adresse e-mail du compte")
        parser.add_argument(
            "--password", default=None,
            help="Mot de passe — un mot de passe aléatoire fort est généré et affiché si omis (recommandé)",
        )
        parser.add_argument(
            "--force", action="store_true",
            help="Réinitialise le mot de passe d'un Super Admin existant au lieu de ne rien faire",
        )

    def handle(self, *args, **options):
        existant = User.objects.filter(role=User.Role.SUPERADMIN).first()

        if existant and not options["force"]:
            self.stdout.write(self.style.WARNING(
                f"Un Super Admin existe déjà : « {existant.username} » — rien à faire. "
                "Utilisez --force pour réinitialiser son mot de passe."
            ))
            return

        mot_de_passe = options["password"] or secrets.token_urlsafe(12)

        if existant:
            existant.set_password(mot_de_passe)
            existant.is_active = True
            existant.doit_changer_mot_de_passe = True
            existant.save()
            self.stdout.write(self.style.SUCCESS(f"Mot de passe réinitialisé pour « {existant.username} »."))
        else:
            username = options["username"]
            try:
                superadmin = User.objects.create_superuser(
                    username=username, email=options["email"], password=mot_de_passe,
                    first_name="Super", last_name="Admin", role=User.Role.SUPERADMIN,
                )
            except IntegrityError:
                self.stderr.write(self.style.ERROR(
                    f"L'identifiant « {username} » est déjà utilisé par un compte non-superadmin — "
                    "choisissez-en un autre avec --username."
                ))
                return
            superadmin.doit_changer_mot_de_passe = True
            superadmin.save(update_fields=["doit_changer_mot_de_passe"])
            self.stdout.write(self.style.SUCCESS(f"Super Admin « {superadmin.username} » créé."))

        if not options["password"]:
            self.stdout.write(self.style.WARNING(
                f"Mot de passe généré (à noter, ne sera plus affiché) : {mot_de_passe}"
            ))
        self.stdout.write("Le changement de mot de passe sera demandé à la première connexion.")
