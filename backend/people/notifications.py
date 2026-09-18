"""Notification automatique de bienvenue à la création d'un compte élève — envoyée à l'élève
lui-même et au parent rattaché (nouveau compte créé en même temps, ou parent déjà existant
simplement lié), avec les identifiants de connexion en clair. C'est la seule occasion de les
voir : le mot de passe n'est jamais stocké ni renvoyé par l'API au-delà de cet instant (il est
haché immédiatement, voir EleveProfileWriteSerializer.create()).

Trois canaux, tous en best-effort (un échec sur l'un n'empêche jamais les autres, ni la création
du compte elle-même) : e-mail, SMS (respectant le coupe-circuit global
`ParametresPlateforme.sms_actif`, contrairement à payments/notifications.py — voir sa note
d'incohérence connue), et un message dans la messagerie interne de l'application — celui-ci est
le seul dont on est SÛR que le destinataire le verra tôt ou tard (email/SMS peuvent échouer
silencieusement, ou l'élève n'a simplement pas d'adresse/numéro renseigné) : il attend
l'utilisateur dès sa première connexion, dans sa messagerie."""

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
    """Dépose le message dans la messagerie interne de `destinataire_user`, signé par
    `expediteur` (l'administrateur qui vient de créer le compte) — silencieux si la messagerie
    est désactivée pour cette école (fonctionnalité optionnelle, voir `Ecole.a_fonctionnalite`)
    ou si `expediteur` est absent (ex: import Excel en masse, sans requête HTTP/admin identifié).
    Un échec ici (import, contrainte DB...) ne doit pas non plus faire échouer la création du
    compte — même best-effort que l'e-mail/SMS ci-dessus."""
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


def notifier_creation_compte_eleve(
    eleve_user, mot_de_passe_eleve: str,
    parent_user=None, mot_de_passe_parent: str | None = None, parent_est_nouveau: bool = False,
    expediteur=None,
) -> None:
    """`eleve_user` : le compte élève tout juste créé. `parent_user` : le parent rattaché, qu'il
    s'agisse d'un nouveau compte (créé dans la même requête — voir `parent_creer` côté
    serializer) ou d'un parent déjà existant simplement lié. `mot_de_passe_parent` n'est fourni
    (et donc communiqué) que si `parent_est_nouveau` — jamais pour un parent déjà existant, dont
    le mot de passe n'a pas changé. `expediteur` : l'administrateur à l'origine de la création
    (utilisateur de la requête HTTP) — signe le message interne envoyé à l'élève/au parent ;
    `None` si l'appelant n'en a pas (ex: import Excel en masse), auquel cas seul l'e-mail/SMS
    partent, comme avant l'introduction du message interne.

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
    _envoyer_message_interne(expediteur, eleve_user, message_eleve)

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
    _envoyer_message_interne(expediteur, parent_user, message_parent)
