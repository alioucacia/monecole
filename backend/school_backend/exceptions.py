from rest_framework.views import exception_handler as drf_exception_handler


def custom_exception_handler(exc, context):
    """Enrichit la réponse d'erreur standard de DRF avec le `code` de l'exception, quand il y en
    a un (ex: `AuthenticationFailed(message, code="maintenance")`).

    Par défaut, DRF ne renvoie que `{"detail": "<message>"}` — le `code` passé à l'exception
    reste un attribut Python interne (`ErrorDetail.code`), jamais sérialisé en JSON. Le frontend
    a besoin de ce `code` pour distinguer une simple session expirée d'un blocage plateforme
    (maintenance / établissement suspendu) et réagir différemment dans les deux cas (voir
    `api/client.ts`) plutôt que de deviner à partir du texte du message."""
    response = drf_exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict) and "code" not in response.data:
        code = getattr(getattr(exc, "detail", None), "code", None)
        if code:
            response.data["code"] = code
    return response
