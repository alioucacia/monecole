"""Notification de bienvenue à la création d'un compte utilisateur "générique" (Comptabilité,
Surveillance, Directeur Général, Administrateur, Enseignant...) via `UserViewSet.perform_create`
— pendant de `people.notifications.notifier_creation_compte_eleve`, en plus simple (pas de
parent à prévenir séparément). Avant ce module, `UserCreateSerializer.create()` ne notifiait
personne : le compte était bien créé, mais son titulaire n'avait aucun moyen de connaître ses
identifiants (voir PersonnelAdminPage.tsx, "+ Nouveau compte") — c'est le bug corrigé ici.

Même stratégie « best-effort » que pour les élèves : e-mail, SMS et message dans la messagerie
interne, chacun indépendant des autres (un canal en échec — pas d'adresse renseignée, SMTP en
panne...) n'empêche jamais les autres ni la création du compte elle-même."""

from django.conf import settings
from django.core.mail import send_mail

from people.sms import send_sms


def _envoyer_email(destinataire_email: str, sujet: str, message: str) -> bool:
    if not destinataire_email:
        return False
    try:
        nb_envoyes = send_mail(
            subject=sujet, message=message, from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[destinataire_email], fail_silently=True,
        )
        return nb_envoyes > 0
    except Exception:  # noqa: BLE001 — un échec d'envoi ne doit jamais bloquer la création du compte
        return False


def _envoyer_sms(destinataire_phone: str, message: str) -> bool:
    from tenants.models import ParametresPlateforme

    if not destinataire_phone:
        return False
    if not ParametresPlateforme.charger().sms_actif:
        return False
    return send_sms(destinataire_phone, message)


def _envoyer_message_interne(expediteur, destinataire_user, contenu: str) -> bool:
    from messaging.models import Message

    if not expediteur or expediteur.id == destinataire_user.id:
        return False
    ecole = destinataire_user.ecole if destinataire_user.ecole_id else None
    if ecole and not ecole.a_fonctionnalite("messagerie"):
        return False
    try:
        Message.objects.create(expediteur=expediteur, destinataire=destinataire_user, contenu=contenu)
        return True
    except Exception:  # noqa: BLE001
        return False


def notifier_creation_compte(utilisateur, mot_de_passe: str, expediteur=None) -> None:
    """`utilisateur` : le compte tout juste créé (n'importe quel rôle géré par `UserViewSet` —
    admin, enseignant, comptabilité, surveillance, directeur...). `mot_de_passe` : le mot de
    passe EN CLAIR choisi à la création (voir `UserViewSet.perform_create`, seule occasion de le
    lire avant qu'il ne soit haché). `expediteur` : l'administrateur à l'origine de la création,
    pour signer le message interne — `None` si indisponible (aucun message interne dans ce cas,
    l'e-mail/SMS partent quand même)."""
    from tenants.messages_templates import rendre_modele

    ecole = utilisateur.ecole if utilisateur.ecole_id else None
    sujet, message = rendre_modele(
        ecole, "compte_cree",
        nom_complet=utilisateur.get_full_name() or utilisateur.username,
        identifiant=utilisateur.username, mot_de_passe=mot_de_passe,
    )
    _envoyer_email(utilisateur.email, sujet, message)
    _envoyer_sms(utilisateur.phone, message)
    _envoyer_message_interne(expediteur, utilisateur, message)
