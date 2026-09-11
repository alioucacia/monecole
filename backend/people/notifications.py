"""Notification automatique de bienvenue à la création d'un compte élève — envoyée à l'élève
lui-même et au parent rattaché (nouveau compte créé en même temps, ou parent déjà existant
simplement lié), avec les identifiants de connexion en clair. C'est la seule occasion de les
voir : le mot de passe n'est jamais stocké ni renvoyé par l'API au-delà de cet instant (il est
haché immédiatement, voir EleveProfileWriteSerializer.create()).

Suit le même schéma que payments/notifications.py et accounts/services.reinitialiser_mot_de_passe :
e-mail en best-effort (fail_silently — un échec SMTP ne doit jamais faire échouer la création du
compte), SMS respectant le coupe-circuit global `ParametresPlateforme.sms_actif` (contrairement à
payments/notifications.py, qui ne le vérifie pas — voir sa note d'incohérence connue)."""

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


def notifier_creation_compte_eleve(
    eleve_user, mot_de_passe_eleve: str,
    parent_user=None, mot_de_passe_parent: str | None = None, parent_est_nouveau: bool = False,
) -> None:
    """`eleve_user` : le compte élève tout juste créé. `parent_user` : le parent rattaché, qu'il
    s'agisse d'un nouveau compte (créé dans la même requête — voir `parent_creer` côté
    serializer) ou d'un parent déjà existant simplement lié. `mot_de_passe_parent` n'est fourni
    (et donc communiqué) que si `parent_est_nouveau` — jamais pour un parent déjà existant, dont
    le mot de passe n'a pas changé.

    Le texte envoyé au parent quand SON PROPRE compte vient aussi d'être créé (identifiants des
    deux comptes à la fois) reste codé en dur ici plutôt que dans le modèle `compte_cree` de
    l'admin — c'est un cas particulier avec deux jeux d'identifiants, pas juste une variante de
    formulation ; le modèle personnalisable couvre le cas standard (un seul jeu d'identifiants,
    élève ou parent déjà existant)."""
    from tenants.messages_templates import rendre_modele

    ecole = eleve_user.ecole if eleve_user.ecole_id else None
    nom_ecole = ecole.nom if ecole else "Taly-School"

    sujet_eleve, message_eleve = rendre_modele(
        ecole, "compte_cree",
        nom_complet=eleve_user.get_full_name() or eleve_user.username,
        identifiant=eleve_user.username, mot_de_passe=mot_de_passe_eleve,
    )
    _envoyer_email(eleve_user.email, sujet_eleve, message_eleve)
    _envoyer_sms(eleve_user.phone, message_eleve)

    if not parent_user:
        return

    if parent_est_nouveau and mot_de_passe_parent:
        message_parent = (
            f"{nom_ecole} : le compte de {eleve_user.get_full_name()} a été créé, ainsi que votre "
            "propre compte parent.\n"
            f"Vos identifiants : {parent_user.username} / {mot_de_passe_parent}\n"
            f"Identifiants de {eleve_user.first_name or eleve_user.username} : "
            f"{eleve_user.username} / {mot_de_passe_eleve}\n"
            "Connectez-vous puis changez votre mot de passe dès que possible."
        )
        sujet_parent = f"{nom_ecole} — Compte de {eleve_user.get_full_name()} créé"
    else:
        sujet_parent, message_parent = rendre_modele(
            ecole, "compte_cree",
            nom_complet=eleve_user.get_full_name() or eleve_user.username,
            identifiant=eleve_user.username, mot_de_passe=mot_de_passe_eleve,
        )
    _envoyer_email(parent_user.email, sujet_parent, message_parent)
    _envoyer_sms(parent_user.phone, message_parent)
