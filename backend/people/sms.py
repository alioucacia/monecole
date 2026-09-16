"""Envoi de SMS et de messages WhatsApp — simulation par défaut (journalisée), ou envoi réel via
l'un de plusieurs fournisseurs SMS interchangeables (voir `SMS_PROVIDER` dans les settings/.env) :

- NimbaSMS (nimbasms.com) — `NIMBASMS_SID`/`NIMBASMS_SECRET_TOKEN`/`NIMBASMS_SENDER_NAME`.
- Infobip (infobip.com) — `INFOBIP_API_KEY`/`INFOBIP_BASE_URL`/`INFOBIP_SENDER`.
- Twilio (console.twilio.com), fournisseur historique — `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/
  `TWILIO_FROM_NUMBER` (WhatsApp : `TWILIO_WHATSAPP_FROM_NUMBER` en plus, même compte).

Un seul fournisseur actif à la fois, choisi par `SMS_PROVIDER` ("nimbasms" / "infobip" / "twilio"
/ vide) — passer de l'un à l'autre ne demande de changer QUE cette variable (et les identifiants
du fournisseur visé), jamais le code appelant : `send_sms`/`send_whatsapp` restent les deux seuls
points d'entrée utilisés ailleurs dans le projet, quel que soit le fournisseur actif. WhatsApp
reste pour l'instant propre à Twilio (seul fournisseur de ce projet qui le propose) ; NimbaSMS et
Infobip ne couvrent ici que le SMS.
"""
import logging

from django.conf import settings

logger = logging.getLogger("sms")


def _numero_e164(numero: str, indicatif: str | None = None) -> str:
    """Format international (ex: "+224624086668"). Les numéros de ce projet sont saisis sans
    indicatif (ex: "624086668") : on préfixe avec l'indicatif par défaut (`SMS_INDICATIF_DEFAUT`,
    Guinée par défaut), sauf si un "+" est déjà présent — et on retire un éventuel "0" de tête
    (préfixe de réseau local, absent du format international)."""
    nettoye = "".join(c for c in numero if c.isdigit() or c == "+")
    if nettoye.startswith("+"):
        return nettoye
    indicatif = indicatif or getattr(settings, "SMS_INDICATIF_DEFAUT", "+224")
    return f"{indicatif}{nettoye.lstrip('0')}"


def send_sms(to: str, message: str) -> bool:
    """Envoie un SMS à `to` via le fournisseur actif (`settings.SMS_PROVIDER`). Retourne True si
    l'envoi (ou la simulation) a réussi — False en cas d'échec réel (fournisseur configuré mais
    l'envoi a échoué), pour que l'appelant ne considère pas à tort le SMS comme délivré (ex:
    `sms_envoye` sur une alerte parent, retenté plus tard)."""
    if not to:
        return False

    provider = (getattr(settings, "SMS_PROVIDER", "") or "").strip().lower()

    if provider == "nimbasms":
        sid = getattr(settings, "NIMBASMS_SID", "")
        token = getattr(settings, "NIMBASMS_SECRET_TOKEN", "")
        if sid and token:
            return _envoyer_via_nimbasms(to, message, sid, token)
        logger.warning("SMS_PROVIDER=nimbasms mais NIMBASMS_SID/NIMBASMS_SECRET_TOKEN manquant(s) — SMS simulé.")

    elif provider == "infobip":
        api_key = getattr(settings, "INFOBIP_API_KEY", "")
        base_url = getattr(settings, "INFOBIP_BASE_URL", "")
        if api_key and base_url:
            return _envoyer_via_infobip(to, message, api_key, base_url)
        logger.warning("SMS_PROVIDER=infobip mais INFOBIP_API_KEY/INFOBIP_BASE_URL manquant(s) — SMS simulé.")

    elif provider == "twilio":
        account_sid = getattr(settings, "TWILIO_ACCOUNT_SID", "")
        auth_token = getattr(settings, "TWILIO_AUTH_TOKEN", "")
        from_number = getattr(settings, "TWILIO_FROM_NUMBER", "")
        if account_sid and auth_token and from_number:
            return _envoyer_via_twilio(to, message, account_sid, auth_token, from_number)
        logger.warning("SMS_PROVIDER=twilio mais les identifiants Twilio sont incomplets — SMS simulé.")

    print(f"[SMS SIMULE] -> {to} : {message}", flush=True)
    logger.info("SMS simulé vers %s : %s", to, message)
    return True


def _envoyer_via_nimbasms(to: str, message: str, sid: str, token: str) -> bool:
    from nimbasms import Client  # importé seulement si NimbaSMS est le fournisseur actif (paquet optionnel)

    try:
        client = Client(sid, token)
        sender_name = getattr(settings, "NIMBASMS_SENDER_NAME", "") or "Taly School"
        client.messages.create(to=[_numero_e164(to)], sender_name=sender_name, message=message)
        logger.info("SMS envoyé via NimbaSMS à %s", to)
        return True
    except Exception:  # noqa: BLE001 — un échec NimbaSMS ne doit jamais faire planter l'appelant
        logger.exception("Échec de l'envoi SMS via NimbaSMS vers %s", to)
        return False


def _envoyer_via_infobip(to: str, message: str, api_key: str, base_url: str) -> bool:
    import requests

    try:
        # Infobip attend le numéro au format international SANS le "+" de tête.
        numero = _numero_e164(to).lstrip("+")
        sender = getattr(settings, "INFOBIP_SENDER", "") or "Taly School"
        base = base_url if base_url.startswith("http") else f"https://{base_url}"
        reponse = requests.post(
            f"{base.rstrip('/')}/sms/2/text/advanced",
            headers={
                "Authorization": f"App {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"messages": [{"destinations": [{"to": numero}], "from": sender, "text": message}]},
            timeout=10,
        )
        reponse.raise_for_status()
        # Infobip renvoie 200 même si UN destinataire précis a échoué (statut par message dans le
        # corps de la réponse) — avec un seul destinataire ici, on vérifie ce statut individuel
        # plutôt que de se fier au seul code HTTP, sans quoi un numéro invalide serait compté
        # comme "envoyé".
        statuts = reponse.json().get("messages", [])
        groupe = (statuts[0].get("status", {}) or {}).get("groupId") if statuts else None
        # groupId Infobip : 1 = PENDING, 3 = DELIVERED — les deux valent un envoi accepté côté
        # opérateur ; 2 = UNDELIVERABLE, 4 = EXPIRED, 5 = REJECTED valent un échec réel.
        if groupe in (1, 3):
            logger.info("SMS envoyé via Infobip à %s", to)
            return True
        logger.error("Échec de l'envoi SMS via Infobip vers %s : %s", to, statuts)
        return False
    except Exception:  # noqa: BLE001 — un échec Infobip ne doit jamais faire planter l'appelant
        logger.exception("Échec de l'envoi SMS via Infobip vers %s", to)
        return False


def _envoyer_via_twilio(to: str, message: str, account_sid: str, auth_token: str, from_number: str) -> bool:
    from twilio.rest import Client  # importé seulement si Twilio est le fournisseur actif (paquet optionnel)

    try:
        client = Client(account_sid, auth_token)
        indicatif = getattr(settings, "TWILIO_INDICATIF_DEFAUT", None)
        client.messages.create(to=_numero_e164(to, indicatif), from_=from_number, body=message)
        logger.info("SMS envoyé via Twilio à %s", to)
        return True
    except Exception:  # noqa: BLE001 — un échec Twilio ne doit jamais faire planter l'appelant
        logger.exception("Échec de l'envoi SMS via Twilio vers %s", to)
        return False


def send_whatsapp(to: str, message: str) -> bool:
    """Envoie un message WhatsApp à `to`, via le canal WhatsApp de Twilio (même compte que le
    SMS Twilio, mais un numéro expéditeur WhatsApp-activé distinct — `TWILIO_WHATSAPP_FROM_NUMBER`,
    voir .env.example : en sandbox de test, ou un numéro validé par Meta en production). Reste
    propre à Twilio pour l'instant, indépendamment de `SMS_PROVIDER` (ni NimbaSMS ni Infobip ne
    sont utilisés ici pour WhatsApp dans ce projet). Même contrat que `send_sms` : True si envoyé
    (ou simulé), False si Twilio est configuré mais l'envoi a réellement échoué."""
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
