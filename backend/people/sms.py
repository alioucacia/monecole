"""Envoi de SMS et de messages WhatsApp — simulation par défaut (journalisée), ou envoi réel via
Twilio si configuré (voir `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` pour le
SMS, `TWILIO_WHATSAPP_FROM_NUMBER` en plus pour WhatsApp — même compte Twilio, juste un numéro
WhatsApp-activé distinct — dans les settings et .env.example). Interchangeable pour un autre
fournisseur plus tard : il suffit de remplacer `_envoyer_via_twilio`/`_envoyer_whatsapp_via_twilio`
par l'appel à sa propre API, sans toucher au code appelant (`send_sms`/`send_whatsapp` sont les
seuls points d'entrée utilisés ailleurs dans le projet).
"""
import logging

from django.conf import settings

logger = logging.getLogger("sms")


def send_sms(to: str, message: str) -> bool:
    """Envoie un SMS à `to`. Retourne True si l'envoi (ou la simulation) a réussi — False en cas
    d'échec réel (Twilio configuré mais l'envoi a échoué), pour que l'appelant ne considère pas
    à tort le SMS comme délivré (ex: `sms_envoye` sur une alerte parent, retenté plus tard)."""
    if not to:
        return False

    account_sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
    auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
    from_number = getattr(settings, "TWILIO_FROM_NUMBER", "")
    if account_sid and auth_token and from_number:
        return _envoyer_via_twilio(to, message, account_sid, auth_token, from_number)

    print(f"[SMS SIMULE] -> {to} : {message}", flush=True)
    logger.info("SMS simulé vers %s : %s", to, message)
    return True


def _numero_e164(numero: str) -> str:
    """Twilio exige le format E.164 (+<indicatif><numéro>). Les numéros de ce projet sont saisis
    sans indicatif (ex: "624086668") : on préfixe avec `TWILIO_INDICATIF_DEFAUT` (Guinée par
    défaut), sauf si un "+" est déjà présent — et on retire un éventuel "0" de tête (préfixe
    de réseau local, absent du format international)."""
    nettoye = "".join(c for c in numero if c.isdigit() or c == "+")
    if nettoye.startswith("+"):
        return nettoye
    indicatif = getattr(settings, "TWILIO_INDICATIF_DEFAUT", "+224")
    return f"{indicatif}{nettoye.lstrip('0')}"


def _envoyer_via_twilio(to: str, message: str, account_sid: str, auth_token: str, from_number: str) -> bool:
    from twilio.rest import Client  # importé seulement si Twilio est configuré (paquet optionnel)

    try:
        client = Client(account_sid, auth_token)
        client.messages.create(to=_numero_e164(to), from_=from_number, body=message)
        logger.info("SMS envoyé via Twilio à %s", to)
        return True
    except Exception:  # noqa: BLE001 — un échec Twilio ne doit jamais faire planter l'appelant
        logger.exception("Échec de l'envoi SMS via Twilio vers %s", to)
        return False


def send_whatsapp(to: str, message: str) -> bool:
    """Envoie un message WhatsApp à `to`, via le canal WhatsApp de Twilio (même compte que le
    SMS, mais un numéro expéditeur WhatsApp-activé distinct — `TWILIO_WHATSAPP_FROM_NUMBER`,
    voir .env.example : en sandbox de test, ou un numéro validé par Meta en production). Même
    contrat que `send_sms` : True si envoyé (ou simulé), False si Twilio est configuré mais
    l'envoi a réellement échoué."""
    if not to:
        return False

    account_sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
    auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
    from_number = getattr(settings, "TWILIO_WHATSAPP_FROM_NUMBER", "")
    if account_sid and auth_token and from_number:
        return _envoyer_whatsapp_via_twilio(to, message, account_sid, auth_token, from_number)

    print(f"[WHATSAPP SIMULE] -> {to} : {message}", flush=True)
    logger.info("WhatsApp simulé vers %s : %s", to, message)
    return True


def _envoyer_whatsapp_via_twilio(to: str, message: str, account_sid: str, auth_token: str, from_number: str) -> bool:
    from twilio.rest import Client

    try:
        client = Client(account_sid, auth_token)
        numero = _numero_e164(to)
        expediteur = from_number if from_number.startswith("whatsapp:") else f"whatsapp:{from_number}"
        client.messages.create(
            to=numero if numero.startswith("whatsapp:") else f"whatsapp:{numero}",
            from_=expediteur, body=message,
        )
        logger.info("WhatsApp envoyé via Twilio à %s", to)
        return True
    except Exception:  # noqa: BLE001 — un échec Twilio ne doit jamais faire planter l'appelant
        logger.exception("Échec de l'envoi WhatsApp via Twilio vers %s", to)
        return False
