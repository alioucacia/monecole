import hashlib
import hmac
import logging

import requests

from django.conf import settings

logger = logging.getLogger(__name__)

# Délais courts : un paiement enchaîne authentification + appel Djomy dans la même requête HTTP,
# qui doit rester sous la limite de 30 s de nginx/gunicorn (sinon l'admin voit une erreur
# générique au lieu du vrai motif).
TIMEOUT_AUTH = 10
TIMEOUT_PAIEMENT = 15


class DjomyNonConfigure(Exception):
    pass


def _verifier_configuration():
    if not settings.DJOMY_CLIENT_ID or not settings.DJOMY_CLIENT_SECRET:
        raise DjomyNonConfigure(
            "le paiement en ligne n'est pas configuré sur le serveur (identifiants Djomy absents) — "
            "contactez l'administrateur de la plateforme."
        )


def _lever_si_erreur(response):
    """Comme `raise_for_status`, mais avec le motif renvoyé par Djomy (ex : numéro invalide,
    identifiants refusés) plutôt qu'un simple « 400 Client Error »."""
    if response.ok:
        return
    try:
        corps = response.json()
        motif = corps.get("message") or corps.get("error") or ""
    except ValueError:
        motif = ""
    raise Exception(f"Djomy a refusé la demande (HTTP {response.status_code}){f' : {motif}' if motif else ''}")


def _signature():
    return hmac.new(
        settings.DJOMY_CLIENT_SECRET.encode(),
        settings.DJOMY_CLIENT_ID.encode(),
        hashlib.sha256,
    ).hexdigest()


def _headers(access_token=None):
    headers = {
        "X-API-KEY": f"{settings.DJOMY_CLIENT_ID}:{_signature()}",
        "Content-Type": "application/json",
    }

    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    return headers


def get_access_token():
    _verifier_configuration()
    url = f"{settings.DJOMY_API_URL.rstrip('/')}/v1/auth"

    response = requests.post(
        url,
        headers=_headers(),
        timeout=TIMEOUT_AUTH,
    )

    # Jamais le corps de la réponse ici : il contient le jeton d'accès.
    logger.info("Djomy auth : HTTP %s", response.status_code)

    _lever_si_erreur(response)

    result = response.json()

    if not result.get("success"):
        raise Exception(
            result.get("message", "Erreur d'authentification Djomy")
        )

    return result["data"]["accessToken"]



def create_payment(amount, payer_number, description="Paiement TALY SCHOOL"):
    token = get_access_token()

    url = f"{settings.DJOMY_API_URL.rstrip('/')}/v1/payments/gateway"

    payload = {
        "amount": amount,
        "countryCode": "GN",
        "payerNumber": payer_number,
        "description": description,
    }

    response = requests.post(
        url,
        headers=_headers(token),
        json=payload,
        timeout=TIMEOUT_PAIEMENT,
    )

    logger.info("Djomy paiement : HTTP %s — %s", response.status_code, response.text[:500])

    _lever_si_erreur(response)

    result = response.json()
    if not (result.get("data") or {}).get("transactionId"):
        raise Exception(result.get("message") or "réponse Djomy sans identifiant de transaction")
    return result


def get_payment_status(transaction_id):
    token = get_access_token()

    url = f"{settings.DJOMY_API_URL.rstrip('/')}/v1/payments/{transaction_id}/status"

    response = requests.get(
        url,
        headers=_headers(token),
        timeout=TIMEOUT_AUTH,
    )

    logger.info("Djomy statut : HTTP %s — %s", response.status_code, response.text[:500])

    _lever_si_erreur(response)

    result = response.json()

    if not result.get("success"):
        raise Exception(
            result.get("message", "Erreur de vérification du paiement Djomy")
        )

    return result["data"]