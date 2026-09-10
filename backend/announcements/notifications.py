"""Envoi (synchrone) d'une annonce par e-mail et/ou SMS aux destinataires ciblés.

Il n'y a pas de file de tâches (Celery/RQ) dans ce projet : l'envoi se fait donc dans le
cycle requête/réponse, comme les autres notifications de l'application (voir
`payments.notifications`). Pour une plateforme avec des milliers de comptes, un envoi en
tâche de fond serait préférable — à revoir si le volume le justifie un jour."""

from django.conf import settings
from django.core.mail import send_mail

from accounts.models import User
from people.sms import send_sms
from tenants.models import ParametresPlateforme

from .models import Annonce


def _destinataires(annonce: Annonce):
    """Utilisateurs concernés par cette annonce : son école (ou toutes si `ecole` est vide,
    cas des annonces plateforme diffusées à tout le monde) et son rôle cible."""
    qs = User.objects.filter(is_active=True).exclude(role=User.Role.SUPERADMIN)
    if annonce.ecole_id is not None:
        qs = qs.filter(ecole_id=annonce.ecole_id)
    if annonce.cible_role != Annonce.Cible.TOUS:
        qs = qs.filter(role=annonce.cible_role)
    if annonce.classe_id is not None:
        qs = qs.filter(eleve_profile__classe_id=annonce.classe_id)
    return qs


def envoyer_notifications_annonce(annonce: Annonce) -> dict:
    """Envoie l'annonce par e-mail/SMS selon ses drapeaux `envoyer_email`/`envoyer_sms`
    et marque `notifications_envoyees` pour ne jamais renvoyer deux fois. Retourne un
    petit résumé (nombre de destinataires touchés par canal)."""
    if annonce.notifications_envoyees or not (annonce.envoyer_email or annonce.envoyer_sms):
        return {"emails_envoyes": 0, "sms_envoyes": 0}

    parametres = ParametresPlateforme.charger()
    emails_envoyes = 0
    sms_envoyes = 0

    for destinataire in _destinataires(annonce).iterator():
        if annonce.envoyer_email and destinataire.email:
            try:
                send_mail(
                    subject=f"[{parametres.nom_plateforme}] {annonce.titre}",
                    message=annonce.contenu,
                    from_email=f"{parametres.email_expediteur_nom} <{settings.DEFAULT_FROM_EMAIL}>",
                    recipient_list=[destinataire.email],
                    fail_silently=True,
                )
                emails_envoyes += 1
            except Exception:  # noqa: BLE001 — l'échec d'un envoi ne doit jamais bloquer les autres
                pass
        if annonce.envoyer_sms and parametres.sms_actif and destinataire.phone:
            if send_sms(destinataire.phone, f"{annonce.titre} — {annonce.contenu}"):
                sms_envoyes += 1

    annonce.notifications_envoyees = True
    annonce.save(update_fields=["notifications_envoyees"])
    return {"emails_envoyes": emails_envoyes, "sms_envoyes": sms_envoyes}
