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
