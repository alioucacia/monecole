"""Enregistrement et QR code de vérification des documents officiels (voir
core.models.DocumentOfficiel) — appelé à chaque génération d'un bulletin ou d'un certificat."""

import base64
import hashlib
import json
from io import BytesIO

import qrcode
from django.conf import settings

from .models import DocumentOfficiel


def url_verification(document: DocumentOfficiel) -> str:
    return f"{settings.FRONTEND_URL}/verifier-document/{document.token}"


def enregistrer_document(ecole, type_document: str, eleve, reference: str, donnees: dict) -> DocumentOfficiel:
    """Renvoie l'entrée correspondant à ce contenu exact — la même que la dernière fois si rien
    n'a changé (le QR imprimé reste identique), une nouvelle version sinon."""
    empreinte = hashlib.sha256(json.dumps(donnees, sort_keys=True, default=str).encode()).hexdigest()
    document, _cree = DocumentOfficiel.objects.get_or_create(
        ecole=ecole, type=type_document, eleve=eleve, reference=reference, empreinte=empreinte,
        defaults={"donnees": donnees},
    )
    return document


def qr_verification(document: DocumentOfficiel) -> dict:
    """Variables de gabarit PDF : `qr_verification_data_uri` (image) et `code_verification`."""
    image = qrcode.make(url_verification(document), border=1)
    tampon = BytesIO()
    image.save(tampon, format="PNG")
    return {
        "qr_verification_data_uri": f"data:image/png;base64,{base64.b64encode(tampon.getvalue()).decode()}",
        "code_verification": document.code_court,
        "url_verification_courte": f"{settings.FRONTEND_URL}/verifier-document",
    }
