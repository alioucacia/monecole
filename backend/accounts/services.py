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


def journaliser(utilisateur, categorie: str, description: str, request=None) -> None:
    """Ajoute une entrée à l'historique d'activité de `utilisateur` (voir `JournalUtilisateur`)
    — appelé explicitement aux points clés de chaque app (connexion, gestion de compte, élèves,
    enseignants, notes, paiements) plutôt que par un signal générique, pour ne garder que des
    actions significatives. `request`, quand disponible, permet d'enregistrer l'IP d'origine."""
    JournalUtilisateur.objects.create(
        utilisateur=utilisateur, categorie=categorie, description=description,
        adresse_ip=_adresse_ip(request) if request is not None else None,
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
                subject="École Manager — Votre mot de passe a été réinitialisé",
                message=(
                    f"Bonjour {utilisateur.get_full_name() or utilisateur.username},\n\n"
                    "Un administrateur vient de réinitialiser votre mot de passe.\n"
                    f"Nouveau mot de passe temporaire : {nouveau_mot_de_passe}\n\n"
                    "Connectez-vous puis changez-le dès que possible depuis votre profil.\n\n"
                    "— L'équipe École Manager"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[utilisateur.email],
                fail_silently=True,
            )
            email_envoye = nb_envoyes > 0
        except Exception:  # noqa: BLE001 — l'échec d'envoi ne doit jamais bloquer la réinitialisation
            pass

    return {"nouveau_mot_de_passe": nouveau_mot_de_passe, "email_envoye": email_envoye}
