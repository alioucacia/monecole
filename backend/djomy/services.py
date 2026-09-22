import hashlib
import hmac
import requests

from django.conf import settings


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
    url = f"{settings.DJOMY_API_URL.rstrip('/')}/v1/auth"

    response = requests.post(
        url,
        headers=_headers(),
        timeout=20,
    )

    print("Djomy status:", response.status_code)
    print("Djomy response:", response.text)

    response.raise_for_status()

    result = response.json()

    if not result.get("success"):
        raise Exception(
            result.get("message", "Erreur d'authentification Djomy")
        )

    return result["data"]["accessToken"]



def create_payment(amount, payer_number, description="Paiement Taly School"):
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
        timeout=30,
    )

    print("Djomy payment status:", response.status_code)
    print("Djomy payment response:", response.text)

    response.raise_for_status()

    return response.json()


def get_payment_status(transaction_id):
    token = get_access_token()

    url = f"{settings.DJOMY_API_URL.rstrip('/')}/v1/payments/{transaction_id}/status"

    response = requests.get(
        url,
        headers=_headers(token),
        timeout=20,
    )

    print("Djomy status check:", response.status_code)
    print("Djomy status response:", response.text)

    response.raise_for_status()

    result = response.json()

    if not result.get("success"):
        raise Exception(
            result.get("message", "Erreur de vérification du paiement Djomy")
        )

    return result["data"]