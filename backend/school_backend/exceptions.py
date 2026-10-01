import re

from django.http import Http404
from rest_framework import exceptions
from rest_framework.views import exception_handler as drf_exception_handler

# Noms lisibles des champs les plus courants — sinon le nom technique est « humanisé »
# (`date_echeance` -> « Date echeance »), voir `_libelle`.
LIBELLES = {
    "eleve": "l'élève", "classe": "la classe", "matiere": "la matière", "periode": "la période",
    "annee_scolaire": "l'année scolaire", "type_frais": "le type de frais", "frais": "le frais",
    "montant": "le montant", "montant_standard": "le montant", "mois": "le mois", "date": "la date",
    "date_echeance": "la date d'échéance", "date_debut": "la date de début", "date_fin": "la date de fin",
    "valeur": "la note", "coefficient": "le coefficient", "nom": "le nom", "prenom": "le prénom",
    "first_name": "le prénom", "last_name": "le nom", "username": "l'identifiant", "email": "l'e-mail",
    "phone": "le téléphone", "telephone": "le téléphone", "password": "le mot de passe",
    "matricule": "le matricule", "libelle": "le libellé", "titre": "le titre", "contenu": "le contenu",
    "motif": "le motif", "categorie": "la catégorie", "responsable": "le responsable",
    "mode_paiement": "le mode de paiement", "enseignant": "l'enseignant", "parent": "le parent",
    "niveau": "le niveau", "cycle": "le cycle", "code": "le code", "prix": "le prix",
    "salaire_base": "le salaire", "fichier": "le fichier", "photo": "la photo", "role": "le rôle",
    "jour": "le jour", "heure_debut": "l'heure de début", "heure_fin": "l'heure de fin",
    "capacite": "la capacité", "adresse": "l'adresse", "sexe": "le sexe",
}

# Codes d'erreur DRF/Django au message générique (« Ce champ est obligatoire. », « Clé primaire
# "0" non valide - l'objet n'existe pas. »…) remplacés par une phrase courte. Les messages écrits
# à la main dans les serializers (code « invalid » le plus souvent) sont gardés tels quels : ils
# sont déjà explicites.
OBLIGATOIRE = {"required", "blank", "null", "empty", "null_characters_not_allowed"}
CHOIX = {"does_not_exist", "incorrect_type", "invalid_choice", "invalid_pk_value"}
FORMAT = {"max_digits", "max_decimal_places", "max_whole_digits", "not_a_list", "invalid_image", "no_name"}
DEBUT_GENERIQUE = (
    "Un nombre", "Un entier", "Saisissez", "Entrez", "Format", "La date", "L'heure", "Type incorrect",
    "Valeur", "Veuillez", "Un booléen", "Une valeur", "Aucun fichier", "Le fichier soumis",
    "Assurez-vous", "Ce champ", "Enter", "A valid",
)


def _libelle(champ: str) -> str:
    return LIBELLES.get(champ) or f"« {champ.replace('_', ' ').capitalize()} »"


def _majuscule(texte: str) -> str:
    return texte[:1].upper() + texte[1:]


def _simplifier(champ: str | None, message: str, code: str | None) -> str:
    message = str(message)
    if not champ or champ in ("non_field_errors", "detail"):
        if code == "unique":
            return "Cet élément existe déjà."
        return message
    libelle = _libelle(champ)
    if code in OBLIGATOIRE:
        return _majuscule(f"{libelle} est obligatoire.")
    if code in CHOIX:
        return _majuscule(f"{libelle} : choix non valide.")
    if code == "unique":
        return _majuscule(f"{libelle} existe déjà.")
    if code in ("max_value", "min_value", "max_length", "min_length"):
        nombre = re.search(r"\d+(?:[.,]\d+)?", message)
        limite = nombre.group(0) if nombre else ""
        if code == "max_value":
            return _majuscule(f"{libelle} : maximum {limite}.")
        if code == "min_value":
            return _majuscule(f"{libelle} : minimum {limite}.")
        if code == "max_length":
            return _majuscule(f"{libelle} : {limite} caractères au maximum.")
        return _majuscule(f"{libelle} : {limite} caractères au minimum.")
    if code in FORMAT or code in ("date", "datetime", "time") or (code == "invalid" and message.startswith(DEBUT_GENERIQUE)):
        return _majuscule(f"{libelle} n'est pas valide.")
    return message


def _premiere_erreur(detail, champ=None):
    """(champ, message, code) de la première erreur d'un `ValidationError.detail` (dict/list
    éventuellement imbriqués — ex: serializers « many=True »)."""
    if isinstance(detail, dict):
        for cle, valeur in detail.items():
            trouve = _premiere_erreur(valeur, cle if champ is None or cle != "non_field_errors" else champ)
            if trouve:
                return trouve
        return None
    if isinstance(detail, list):
        for valeur in detail:
            trouve = _premiere_erreur(valeur, champ)
            if trouve:
                return trouve
        return None
    return champ, str(detail), getattr(detail, "code", None)


MESSAGES_SIMPLES = {
    exceptions.NotAuthenticated: "Veuillez vous connecter.",
    exceptions.AuthenticationFailed: "Votre session a expiré. Reconnectez-vous.",
    exceptions.PermissionDenied: "Vous n'avez pas le droit de faire cette action.",
    exceptions.NotFound: "Élément introuvable.",
    exceptions.MethodNotAllowed: "Action non autorisée.",
    exceptions.Throttled: "Trop de tentatives. Réessayez dans quelques instants.",
    exceptions.UnsupportedMediaType: "Format de fichier non pris en charge.",
    exceptions.ParseError: "Les données envoyées ne sont pas valides.",
}


def custom_exception_handler(exc, context):
    """Réponse d'erreur de l'API, avec deux ajouts à celle de DRF :

    1. `code` de l'exception quand il y en a un (ex: `AuthenticationFailed(message,
       code="maintenance")`) — par défaut DRF ne renvoie que `{"detail": "<message>"}`, le `code`
       reste interne. Le frontend en a besoin pour distinguer une simple session expirée d'un
       blocage plateforme (maintenance / établissement suspendu), voir `api/client.ts`.
    2. `message` : UNE phrase courte et simple, affichée telle quelle par le frontend
       (`extractErrorMessage`) — sans nom technique de champ (« type_frais: … ») ni formulation
       générique de Django (« Clé primaire "0" non valide - l'objet n'existe pas. »). Les autres
       clés de la réponse sont inchangées (certains écrans lisent encore les erreurs par champ)."""
    response = drf_exception_handler(exc, context)
    if response is None or not isinstance(response.data, dict):
        return response

    code = getattr(getattr(exc, "detail", None), "code", None)
    if code and "code" not in response.data:
        response.data["code"] = code

    if isinstance(exc, Http404):
        response.data["message"] = "Élément introuvable."
    elif isinstance(exc, exceptions.ValidationError):
        trouve = _premiere_erreur(exc.detail)
        if trouve:
            response.data["message"] = _simplifier(*trouve)
    else:
        message = str(response.data.get("detail", ""))
        for classe, simple in MESSAGES_SIMPLES.items():
            # Seul le message PAR DÉFAUT de DRF est remplacé — un message écrit exprès (ex:
            # « La fonctionnalité … est désactivée pour votre établissement. ») est gardé.
            # « Introuvable » : toujours simplifié — get_object_or_404 y met un texte technique
            # (« No EleveProfile matches the given query. »).
            if isinstance(exc, classe) and (message == str(classe.default_detail) or classe is exceptions.NotFound):
                response.data["message"] = simple
                break
        else:
            if message:
                response.data["message"] = message
    return response
