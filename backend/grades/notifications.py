"""Notification du classement (rang, moyenne, décision) à un élève et à son parent — action
groupée depuis la page Résultats (voir `ResultatsNotifierView`), une fois le classement d'une
classe arrêté. Même stratégie « best-effort » (e-mail + SMS, chacun indépendant de l'autre, ne
bloque jamais le reste) que pour la création de compte (`accounts.notifications`) et les élèves
(`people.notifications`)."""

from django.conf import settings
from django.core.mail import send_mail

from people.sms import send_sms

DECISION_LABELS = {
    "admis": "Admis(e)",
    "repeche": "Admis(e) sous réserve (repêchage)",
    "redouble": "Doit redoubler",
}


def _envoyer_email(destinataire_email: str, sujet: str, message: str) -> bool:
    if not destinataire_email:
        return False
    try:
        nb_envoyes = send_mail(
            subject=sujet, message=message, from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[destinataire_email], fail_silently=True,
        )
        return nb_envoyes > 0
    except Exception:  # noqa: BLE001 — un échec d'envoi ne doit jamais bloquer les autres notifications
        return False


def _envoyer_sms(destinataire_phone: str, message: str) -> bool:
    from tenants.models import ParametresPlateforme

    if not destinataire_phone:
        return False
    if not ParametresPlateforme.charger().sms_actif:
        return False
    return send_sms(destinataire_phone, message)


def notifier_classement(classe, periode_nom: str, resultats: list) -> int:
    """`resultats` : liste renvoyée par `_class_results` (eleve_id, moyenne_generale, rang,
    decision...). Notifie chaque élève (self) et son parent s'il en a un — élèves sans moyenne
    (aucune note saisie) ignorés silencieusement. Retourne le nombre d'élèves pour lesquels au
    moins un canal a été envoyé avec succès."""
    from people.models import EleveProfile
    from tenants.messages_templates import rendre_modele

    ecole = classe.annee_scolaire.ecole
    ids = [r["eleve_id"] for r in resultats if r["moyenne_generale"] is not None]
    eleves = {
        e.id: e for e in EleveProfile.objects.filter(id__in=ids).select_related("user", "parent")
    }
    effectif = len(resultats)

    nb_notifies = 0
    for r in resultats:
        if r["moyenne_generale"] is None:
            continue
        eleve = eleves.get(r["eleve_id"])
        if not eleve:
            continue
        sujet, message = rendre_modele(
            ecole, "classement_eleve",
            nom_complet=eleve.user.get_full_name(), periode=periode_nom,
            rang=r["rang"], effectif=effectif, moyenne=r["moyenne_generale"],
            decision=DECISION_LABELS.get(r["decision"], ""),
        )
        envoye = False
        if _envoyer_email(eleve.user.email, sujet, message):
            envoye = True
        if _envoyer_sms(eleve.user.phone, message):
            envoye = True
        if eleve.parent_id:
            if _envoyer_email(eleve.parent.email, sujet, message):
                envoye = True
            if _envoyer_sms(eleve.parent.phone, message):
                envoye = True
        if envoye:
            nb_notifies += 1
    return nb_notifies
