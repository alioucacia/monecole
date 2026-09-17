"""Actions sur un compte utilisateur partagées entre plusieurs vues (réinitialisation de
mot de passe déclenchée par un administrateur — Super Admin sur n'importe quel compte via
l'Annuaire, ou Admin d'établissement sur les comptes de sa propre école)."""

import secrets

from django.conf import settings
from django.core.mail import send_mail

from .models import JournalUtilisateur


def _adresse_ip(request) -> str | None:
    """`X-Forwarded-For` d'abord (l'app tourne derrière un reverse proxy en production — voir
    backend/DEPLOYMENT.md — REMOTE_ADDR y vaudrait sinon toujours l'IP interne du proxy)."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


# Reconnus dans cet ordre (le premier qui matche gagne) — volontairement une simple liste de
# mots-clés plutôt qu'une dépendance externe (user-agents/httpagentparser) : suffisant pour un
# résumé lisible dans l'historique de connexion ("Chrome sur Windows"), pas pour une détection
# de compatibilité fine. iPad/iPhone doivent être testés avant "Mac" (Safari sur iPadOS annonce
# aussi "Macintosh" dans son user-agent depuis iOS 13).
_OS_MOTS_CLES = [
    ("Windows", "Windows"), ("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"),
    ("Macintosh", "Mac"), ("Linux", "Linux"),
]
_NAVIGATEUR_MOTS_CLES = [
    ("Edg/", "Edge"), ("OPR/", "Opera"), ("Chrome/", "Chrome"), ("CriOS/", "Chrome"),
    ("Firefox/", "Firefox"), ("FxiOS/", "Firefox"), ("Safari/", "Safari"),
]


def _resumer_appareil(user_agent: str) -> str:
    """« Chrome sur Windows », « Safari sur iPhone »... — vide si le User-Agent est absent ou
    non reconnu plutôt que d'enregistrer une chaîne technique illisible."""
    if not user_agent:
        return ""
    navigateur = next((nom for cle, nom in _NAVIGATEUR_MOTS_CLES if cle in user_agent), "")
    systeme = next((nom for cle, nom in _OS_MOTS_CLES if cle in user_agent), "")
    if navigateur and systeme:
        return f"{navigateur} sur {systeme}"
    return navigateur or systeme


def journaliser(utilisateur, categorie: str, description: str, request=None) -> None:
    """Ajoute une entrée à l'historique d'activité de `utilisateur` (voir `JournalUtilisateur`)
    — appelé explicitement aux points clés de chaque app (connexion, gestion de compte, élèves,
    enseignants, notes, paiements) plutôt que par un signal générique, pour ne garder que des
    actions significatives. `request`, quand disponible, permet d'enregistrer l'IP d'origine et
    un résumé de l'appareil/navigateur utilisé."""
    JournalUtilisateur.objects.create(
        utilisateur=utilisateur, categorie=categorie, description=description,
        adresse_ip=_adresse_ip(request) if request is not None else None,
        appareil=_resumer_appareil(request.META.get("HTTP_USER_AGENT", "")) if request is not None else "",
    )


def reinitialiser_mot_de_passe(utilisateur) -> dict:
    """Génère un nouveau mot de passe temporaire, l'applique, tente de l'envoyer par
    e-mail, et le retourne en clair — seule occasion de le voir, il n'est jamais stocké
    ni consultable ensuite. Force aussi son changement à la prochaine connexion."""
    nouveau_mot_de_passe = secrets.token_urlsafe(9)  # ex: "kQ3f8n-2ZpY1aW" (12 caractères)
    utilisateur.set_password(nouveau_mot_de_passe)
    utilisateur.doit_changer_mot_de_passe = True
    utilisateur.save()

    email_envoye = False
    if utilisateur.email:
        try:
            # send_mail(..., fail_silently=True) n'appellera jamais le except ci-dessous en cas
            # d'échec SMTP (identifiants invalides, serveur injoignable...) : il avale l'erreur
            # et renvoie simplement 0 message envoyé. Il faut donc vérifier cette valeur de retour
            # pour savoir si l'e-mail est réellement parti, plutôt que déduire le succès de
            # l'absence d'exception.
            nb_envoyes = send_mail(
                subject="Taly-School — Votre mot de passe a été réinitialisé",
                message=(
                    f"Bonjour {utilisateur.get_full_name() or utilisateur.username},\n\n"
                    "Un administrateur vient de réinitialiser votre mot de passe.\n"
                    f"Nouveau mot de passe temporaire : {nouveau_mot_de_passe}\n\n"
                    "Connectez-vous puis changez-le dès que possible depuis votre profil.\n\n"
                    "— L'équipe Taly-School"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[utilisateur.email],
                fail_silently=True,
            )
            email_envoye = nb_envoyes > 0
        except Exception:  # noqa: BLE001 — l'échec d'envoi ne doit jamais bloquer la réinitialisation
            pass

    return {"nouveau_mot_de_passe": nouveau_mot_de_passe, "email_envoye": email_envoye}


# ---------------------------------------------------------------------------
# Codes à usage unique (OTP) — double authentification, réinitialisation de mot de passe,
# vérification d'e-mail/téléphone (voir CodeOTP.Objectif). Fonctions partagées par les 3 usages.
# ---------------------------------------------------------------------------

DUREE_VALIDITE_OTP_MINUTES = 10
# Un seul envoi toutes les 60 secondes par (utilisateur, objectif) — empêche un clic répété
# (ou un script) de vider le crédit SMS/la boîte mail en boucle.
DELAI_MIN_RENVOI_SECONDES = 60


def generer_otp(utilisateur, objectif: str, cible: str = "") -> dict:
    """Invalide les codes en attente de ce (utilisateur, objectif), en génère un nouveau à 6
    chiffres, l'envoie par e-mail ET SMS — sur CHAQUE canal où `utilisateur` a une valeur
    renseignée (pas un choix exclusif : la demande était « par mail ET SMS ») — et retourne un
    résumé indiquant sur quel(s) canal(aux) l'envoi a réellement réussi.

    `cible` : pour `VERIFICATION` uniquement, l'e-mail ou le téléphone à vérifier (peut différer
    de `utilisateur.email`/`utilisateur.phone` si la personne est en train de le CHANGER — auquel
    cas le code doit partir vers la NOUVELLE valeur, pas l'ancienne)."""
    from django.core.cache import cache
    from django.utils import timezone

    from people.sms import send_sms

    from .models import CodeOTP

    cache_key = f"otp_recent:{utilisateur.id}:{objectif}"
    if cache.get(cache_key):
        return {"cree": False, "raison": "trop_recent"}

    CodeOTP.objects.filter(user=utilisateur, objectif=objectif, utilise=False).update(utilise=True)

    code = f"{secrets.randbelow(1_000_000):06d}"
    maintenant = timezone.now()
    otp = CodeOTP.objects.create(
        user=utilisateur, code=code, objectif=objectif, cible=cible,
        expire_le=maintenant + timezone.timedelta(minutes=DUREE_VALIDITE_OTP_MINUTES),
    )

    libelles_objectif = {
        CodeOTP.Objectif.CONNEXION: "pour confirmer votre connexion",
        CodeOTP.Objectif.REINITIALISATION: "pour réinitialiser votre mot de passe",
        CodeOTP.Objectif.VERIFICATION: "pour vérifier cette adresse/ce numéro",
    }
    ecole = utilisateur.ecole if utilisateur.ecole_id else None
    nom_ecole = ecole.nom if ecole else "Taly-School"
    texte = (
        f"{nom_ecole} : votre code {libelles_objectif.get(objectif, '')} est {code}. "
        f"Valable {DUREE_VALIDITE_OTP_MINUTES} minutes. Ne le partagez avec personne."
    )

    email_cible = cible if objectif == CodeOTP.Objectif.VERIFICATION and "@" in cible else utilisateur.email
    telephone_cible = cible if objectif == CodeOTP.Objectif.VERIFICATION and "@" not in cible else utilisateur.phone

    email_envoye = False
    if email_cible:
        try:
            nb_envoyes = send_mail(
                subject=f"{nom_ecole} — Votre code de vérification",
                message=texte,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email_cible],
                fail_silently=True,
            )
            email_envoye = nb_envoyes > 0
        except Exception:  # noqa: BLE001 — un canal en échec ne doit jamais bloquer l'autre
            pass

    sms_envoye = False
    if telephone_cible:
        sms_envoye = send_sms(telephone_cible, texte)

    cache.set(cache_key, True, timeout=DELAI_MIN_RENVOI_SECONDES)
    return {"cree": True, "otp": otp, "email_envoye": email_envoye, "sms_envoye": sms_envoye}


def verifier_otp(utilisateur, objectif: str, code: str) -> bool:
    """`True` si `code` correspond au dernier OTP valide (non utilisé, non expiré, sous
    `CodeOTP.MAX_TENTATIVES`) de ce (utilisateur, objectif) — le marque alors utilisé (un code
    ne sert qu'une fois, même correct). Chaque appel avec un mauvais code incrémente le compteur
    de tentatives de CE code, jusqu'à l'invalider définitivement (protège contre l'essai des
    10⁶ codes possibles pendant sa fenêtre de validité de 10 minutes)."""
    from .models import CodeOTP

    otp = (
        CodeOTP.objects.filter(user=utilisateur, objectif=objectif, utilise=False)
        .order_by("-cree_le").first()
    )
    if not otp or otp.expire or otp.tentatives >= CodeOTP.MAX_TENTATIVES:
        return False
    if otp.code != code:
        otp.tentatives += 1
        otp.save(update_fields=["tentatives"])
        return False
    otp.utilise = True
    otp.save(update_fields=["utilise"])
    return True


# ---------------------------------------------------------------------------
# Code secret de suppression définitive d'une école (Super Admin uniquement) — voir
# User.code_suppression et tenants.views.EcoleViewSet.destroy.
# ---------------------------------------------------------------------------

def definir_code_suppression(utilisateur, code: str) -> None:
    """Enregistre (ou remplace) le code — toujours haché, jamais stocké en clair. L'appelant
    (la vue) est responsable d'avoir déjà vérifié le mot de passe habituel de `utilisateur`
    avant d'appeler cette fonction : la définir directement accessible sans ce garde-fou
    permettrait à quiconque détournerait une session déjà ouverte de fixer lui-même un code
    qu'il connaît, ce que ce mécanisme est justement censé empêcher."""
    from django.contrib.auth.hashers import make_password

    utilisateur.code_suppression = make_password(code)
    utilisateur.save(update_fields=["code_suppression"])


def verifier_code_suppression(utilisateur, code: str) -> bool:
    """`False` si `utilisateur` n'a encore défini aucun code (suppression bloquée tant que ce
    filet de sécurité n'a pas été mis en place — voir le champ), ou si `code` ne correspond pas."""
    from django.contrib.auth.hashers import check_password

    if not utilisateur.code_suppression:
        return False
    return check_password(code, utilisateur.code_suppression)
