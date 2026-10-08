"""Journal d'audit automatique : qui a fait quoi dans la plateforme.

Chaque requête API d'écriture (POST/PUT/PATCH/DELETE) réussie d'un utilisateur connecté, ainsi
que chaque export de données, donne UNE entrée `JournalUtilisateur` rattachée à son auteur et à
son école, avec le détail des éléments touchés :

- `AuditMiddleware` ouvre un contexte pour la durée de la requête, puis écrit l'entrée une fois
  la réponse connue (rien n'est enregistré pour une requête refusée ou en erreur) ;
- les signaux `pre_save`/`post_save` relèvent, pendant ce contexte, les créations et les champs
  modifiés (valeur avant → après) de chaque modèle enregistré ;
- pour une suppression (`DELETE`), l'élément visé est lu AVANT l'exécution de la vue (il n'existe
  plus après). Volontairement pas de signal `pre_delete`/`post_delete` global : sa seule présence
  désactive la suppression rapide de Django (« fast delete ») pour tous les modèles, ce qui
  rendrait très lentes les suppressions en cascade volumineuses (réinitialisation d'une école...).

Quand une vue appelle déjà `accounts.services.journaliser` pour son auteur (description métier
plus parlante), cette entrée est complétée avec le détail au lieu d'en créer une seconde.
Les champs sensibles (mots de passe, secrets, codes) ne sont jamais enregistrés en clair."""

from __future__ import annotations

import contextvars
import datetime
import decimal
import logging
import re

from django.db.models.signals import post_save, pre_save

logger = logging.getLogger(__name__)

METHODES_ECRITURE = {"POST", "PUT", "PATCH", "DELETE"}
# Au-delà, les éléments touchés sont seulement comptés (import en masse de centaines d'élèves...).
MAX_ELEMENTS_DETAILLES = 30
LONGUEUR_MAX_VALEUR = 120

# Requêtes d'écriture sans intérêt pour l'audit (lecture d'un message, rafraîchissement de jeton).
CHEMINS_IGNORES = re.compile(r"/(marquer-lu|refresh)/?$")

MODELES_IGNORES = {
    "accounts.JournalUtilisateur", "accounts.CodeOTP", "accounts.SessionActive",
    "accounts.AppareilConnu", "accounts.EvenementSecurite", "tenants.JournalActivite",
}
APPS_IGNOREES = {"admin", "auth", "contenttypes", "sessions", "token_blacklist"}

# Champs jamais affichés en clair : on indique seulement qu'ils ont changé.
_MOTS_SENSIBLES = ("password", "secret", "token", "code_suppression", "codes_secours", "otp_code", "api_key", "cle_api")
CHAMPS_IGNORES = {"last_login", "derniere_activite", "session_id"}

LIBELLES_MODELES = {
    "accounts.User": "Compte utilisateur",
    "academics.Classe": "Classe",
    "academics.Matiere": "Matière",
    "academics.Enseignement": "Enseignement",
    "academics.Creneau": "Créneau d'emploi du temps",
    "people.EleveProfile": "Élève",
    "people.EnseignantProfile": "Enseignant",
    "people.EleveBadge": "Badge élève",
    "people.EnseignantBadge": "Badge enseignant",
    "people.PointageEnseignant": "Pointage enseignant",
    "people.PaieEnseignant": "Paie enseignant",
    "people.GroupeRevision": "Groupe de révision",
    "people.AlerteParent": "Alerte parent",
    "grades.Periode": "Période",
    "grades.Note": "Note",
    "attendance.Presence": "Présence",
    "payments.TypeFrais": "Type de frais",
    "payments.Frais": "Frais",
    "payments.Paiement": "Paiement",
    "announcements.Annonce": "Annonce",
    "library.Livre": "Livre",
    "library.Emprunt": "Emprunt",
    "transport.Trajet": "Trajet",
    "transport.AffectationTransport": "Affectation transport",
    "cantine.Formule": "Formule cantine",
    "cantine.InscriptionCantine": "Inscription cantine",
    "messaging.Message": "Message",
}

LIBELLES_CHAMPS = {
    "username": "Identifiant", "first_name": "Prénom", "last_name": "Nom", "email": "E-mail",
    "phone": "Téléphone", "address": "Adresse", "date_of_birth": "Date de naissance",
    "is_active": "Actif", "role": "Rôle", "password": "Mot de passe", "photo": "Photo",
    "sexe": "Sexe", "classe": "Classe", "parent": "Parent", "matricule": "Matricule",
    "montant": "Montant", "valeur": "Valeur", "statut": "Statut", "nom": "Nom",
    "date": "Date", "matiere": "Matière", "eleve": "Élève", "enseignant": "Enseignant",
}

_CATEGORIES_PAR_APP = {
    "academics": "academique", "grades": "note", "attendance": "presence", "payments": "paiement",
    "announcements": "communication", "messaging": "communication", "visio": "communication",
    "sms": "communication", "school_messaging": "communication", "notifications": "communication",
    "library": "bibliotheque", "transport": "transport", "cantine": "cantine", "acces": "acces",
    "tenants": "parametres", "core": "parametres", "accounts": "compte", "support": "communication",
}
_CATEGORIES_PAR_MODELE = {
    "people.EleveProfile": "eleve", "people.HistoriqueClasse": "eleve", "people.EleveBadge": "eleve",
    "people.EnseignantProfile": "enseignant", "people.EnseignantBadge": "enseignant",
    "people.PointageEnseignant": "enseignant", "people.PaieEnseignant": "enseignant",
}


class _Etat:
    def __init__(self, request):
        self.request = request
        self.elements: list[dict] = []
        self.total = 0
        self.valeurs_avant: dict[tuple, dict] = {}
        self.entrees_explicites: list = []


_etat_courant: contextvars.ContextVar[_Etat | None] = contextvars.ContextVar("audit_etat", default=None)


# --------------------------------------------------------------------------------------------
# Libellés et valeurs
# --------------------------------------------------------------------------------------------

def _est_audite(modele) -> bool:
    return modele._meta.app_label not in APPS_IGNOREES and modele._meta.label not in MODELES_IGNORES


def libelle_modele(modele) -> str:
    return LIBELLES_MODELES.get(modele._meta.label) or str(modele._meta.verbose_name).capitalize()


def _libelle_instance(instance) -> str:
    try:
        texte = str(instance)
    except Exception:  # noqa: BLE001 — un __str__ qui lit une relation disparue ne doit rien casser
        texte = ""
    return (texte or f"n°{instance.pk}")[:150]


def _libelle_champ(champ) -> str:
    if champ.name in LIBELLES_CHAMPS:
        return LIBELLES_CHAMPS[champ.name]
    verbose = str(champ.verbose_name)
    return verbose[:1].upper() + verbose[1:]


def _est_sensible(nom: str) -> bool:
    return any(mot in nom for mot in _MOTS_SENSIBLES)


def _champs_suivis(modele):
    for champ in modele._meta.concrete_fields:
        if champ.primary_key or not champ.editable or champ.name in CHAMPS_IGNORES:
            continue
        if getattr(champ, "auto_now", False) or getattr(champ, "auto_now_add", False):
            continue
        yield champ


def _formater(champ, valeur) -> str:
    if valeur is None or valeur == "":
        return ""
    if champ.is_relation:
        try:
            liee = champ.related_model._base_manager.filter(pk=valeur).first()
            return _libelle_instance(liee) if liee else f"n°{valeur}"
        except Exception:  # noqa: BLE001
            return f"n°{valeur}"
    if champ.choices:
        valeur = dict(champ.flatchoices).get(valeur, valeur)
    if isinstance(valeur, bool):
        return "Oui" if valeur else "Non"
    if isinstance(valeur, datetime.datetime):
        return valeur.strftime("%d/%m/%Y %H:%M")
    if isinstance(valeur, datetime.date):
        return valeur.strftime("%d/%m/%Y")
    if isinstance(valeur, decimal.Decimal):
        valeur = valeur.normalize() if valeur == valeur.to_integral() else valeur
        return f"{valeur:f}"
    if hasattr(valeur, "name"):  # fichier
        valeur = valeur.name
    return str(valeur)[:LONGUEUR_MAX_VALEUR]


def _comparable(valeur):
    return valeur.name if hasattr(valeur, "name") and not isinstance(valeur, str) else valeur


# --------------------------------------------------------------------------------------------
# Signaux
# --------------------------------------------------------------------------------------------

def _avant_enregistrement(sender, instance, raw=False, **kwargs):
    etat = _etat_courant.get()
    if etat is None or raw or not _est_audite(sender) or instance._state.adding or instance.pk is None:
        return
    if len(etat.elements) >= MAX_ELEMENTS_DETAILLES:
        return
    noms = [c.attname for c in _champs_suivis(sender)]
    try:
        anciennes = sender._base_manager.filter(pk=instance.pk).values(*noms).first()
    except Exception:  # noqa: BLE001
        anciennes = None
    if anciennes is not None:
        etat.valeurs_avant[(sender._meta.label, instance.pk)] = anciennes


def _apres_enregistrement(sender, instance, created, raw=False, **kwargs):
    etat = _etat_courant.get()
    if etat is None or raw or not _est_audite(sender):
        return
    if created:
        etat.total += 1
        if len(etat.elements) < MAX_ELEMENTS_DETAILLES:
            etat.elements.append(_element(sender, instance, "creation"))
        return

    anciennes = etat.valeurs_avant.pop((sender._meta.label, instance.pk), None)
    if anciennes is None:
        if len(etat.elements) >= MAX_ELEMENTS_DETAILLES:
            etat.total += 1  # au-delà de la limite, compté sans comparer les valeurs
        return
    champs = []
    for champ in _champs_suivis(sender):
        avant = anciennes.get(champ.attname)
        apres = getattr(instance, champ.attname, None)
        if _comparable(avant) == _comparable(apres):
            continue
        if _est_sensible(champ.name):
            champs.append({"champ": _libelle_champ(champ), "avant": "", "apres": "", "masque": True})
        else:
            champs.append({"champ": _libelle_champ(champ), "avant": _formater(champ, avant), "apres": _formater(champ, apres)})
    if not champs:
        return  # enregistrement sans changement réel
    etat.total += 1
    element = _element(sender, instance, "modification")
    element["champs"] = champs
    etat.elements.append(element)


def _element(modele, instance, operation: str) -> dict:
    return {
        "modele": libelle_modele(modele), "cle": modele._meta.label, "id": instance.pk,
        "libelle": _libelle_instance(instance), "operation": operation,
    }


def connecter_signaux():
    pre_save.connect(_avant_enregistrement, dispatch_uid="audit_pre_save")
    post_save.connect(_apres_enregistrement, dispatch_uid="audit_post_save")


# --------------------------------------------------------------------------------------------
# Lien avec accounts.services.journaliser
# --------------------------------------------------------------------------------------------

def enregistrer_entree_explicite(entree) -> None:
    etat = _etat_courant.get()
    if etat is not None:
        etat.entrees_explicites.append(entree)


def action_requete_courante() -> str:
    """Action déduite de la requête en cours, pour une entrée créée par `journaliser`."""
    etat = _etat_courant.get()
    methode = etat.request.method if etat else ""
    return {"DELETE": "suppression", "PUT": "modification", "PATCH": "modification"}.get(methode, "autre")


# --------------------------------------------------------------------------------------------
# Middleware
# --------------------------------------------------------------------------------------------

def _est_export(request) -> bool:
    return request.method == "GET" and "export" in request.path


def _vue(request):
    """(classe de vue DRF, kwargs de l'URL) — None si la vue n'est pas une vue DRF."""
    correspondance = getattr(request, "resolver_match", None)
    if correspondance is None:
        return None, {}
    return getattr(correspondance.func, "cls", None), correspondance.kwargs


def _modele_vue(classe_vue):
    queryset = getattr(classe_vue, "queryset", None)
    return getattr(queryset, "model", None)


def _element_supprime(request) -> dict | None:
    """Élément visé par un DELETE, lu avant que la vue ne le supprime."""
    from django.urls import resolve
    from django.urls.exceptions import Resolver404

    try:
        correspondance = resolve(request.path_info)
    except Resolver404:
        return None
    classe_vue = getattr(correspondance.func, "cls", None)
    modele = _modele_vue(classe_vue)
    if modele is None:
        return None
    champ = getattr(classe_vue, "lookup_field", "pk")
    cle_url = getattr(classe_vue, "lookup_url_kwarg", None) or champ
    if cle_url not in correspondance.kwargs:
        return None
    try:
        instance = modele._base_manager.filter(**{champ: correspondance.kwargs[cle_url]}).first()
    except Exception:  # noqa: BLE001
        return None
    return _element(modele, instance, "suppression") if instance else None


def _libelle_segment(segment: str) -> str:
    texte = segment.replace("-", " ").replace("_", " ").strip()
    return texte[:1].upper() + texte[1:]


def _segments(request) -> list[str]:
    # /api/<app>/<ressource>/<id>/<action>/ → ["<app>", "<ressource>", ...]
    return [s for s in request.path.split("/") if s and s != "api"]


def _nom_action(request) -> str:
    """Nom d'une action personnalisée (@action) — ex. « marquer-non-reinscrit » — sinon ""."""
    segments = _segments(request)
    return segments[-1] if len(segments) >= 3 and not segments[-1].isdigit() else ""


class AuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        a_suivre = (
            (request.method in METHODES_ECRITURE or _est_export(request))
            and request.path.startswith("/api/") and not CHEMINS_IGNORES.search(request.path)
        )
        if not a_suivre:
            return self.get_response(request)

        etat = _Etat(request)
        if request.method == "DELETE":
            try:
                element = _element_supprime(request)
            except Exception:  # noqa: BLE001
                element = None
            if element:
                etat.elements.append(element)
                etat.total += 1
        jeton = _etat_courant.set(etat)
        try:
            response = self.get_response(request)
        finally:
            _etat_courant.reset(jeton)

        try:
            self._journaliser(request, response, etat)
        except Exception:  # noqa: BLE001 — l'audit ne doit jamais faire échouer une requête
            logger.exception("Échec de l'enregistrement du journal d'audit")
        return response

    def _journaliser(self, request, response, etat: _Etat):
        from .models import JournalUtilisateur
        from .services import journaliser

        utilisateur = getattr(request, "user", None)
        if utilisateur is None or not utilisateur.is_authenticated or response.status_code >= 400:
            return

        # Une vue a déjà décrit l'action de cet auteur : on y ajoute seulement le détail.
        propres = [e for e in etat.entrees_explicites if e.utilisateur_id == utilisateur.id]
        if propres:
            entree = propres[0]
            if etat.elements and not entree.details:
                entree.details = etat.elements
                entree.save(update_fields=["details"])
            return

        classe_vue, kwargs = _vue(request)
        modele_vue = _modele_vue(classe_vue)
        principal = self._element_principal(etat.elements, modele_vue, kwargs)

        if _est_export(request):
            action = JournalUtilisateur.Action.EXPORT
        elif request.path.rstrip("/").endswith("/auth/logout"):
            action = JournalUtilisateur.Action.CONNEXION
        elif principal:
            action = principal["operation"]
        else:
            action = {"DELETE": "suppression", "PUT": "modification", "PATCH": "modification"}.get(request.method, "autre")

        description = self._description(request, action, principal, etat.total, modele_vue)
        categorie = self._categorie(request, principal, modele_vue, action)
        entree = journaliser(utilisateur, categorie, description, request, action=action)
        if etat.elements:
            entree.details = etat.elements
            entree.save(update_fields=["details"])

    @staticmethod
    def _element_principal(elements, modele_vue, kwargs):
        if not elements:
            return None
        if modele_vue is not None:
            cle = modele_vue._meta.label
            identifiant = next((str(v) for v in kwargs.values()), None)
            for element in elements:
                if element["cle"] == cle and str(element["id"]) == identifiant:
                    return element
            for element in elements:
                if element["cle"] == cle:
                    return element
        return elements[0]

    @staticmethod
    def _description(request, action, principal, total, modele_vue) -> str:
        if action == "connexion":
            return "Déconnexion"
        segments = _segments(request)
        ressource = libelle_modele(modele_vue) if modele_vue else _libelle_segment(segments[1] if len(segments) > 1 else (segments[0] if segments else ""))
        if action == "export":
            return f"Export : {ressource} ({_libelle_segment(segments[-1])})" if segments else "Export de données"

        nom_action = _nom_action(request)
        verbes = {"creation": "Création", "modification": "Modification", "suppression": "Suppression"}
        if principal:
            texte = f"{principal['modele']} « {principal['libelle']} »"
            if nom_action:
                texte = f"{_libelle_segment(nom_action)} — {texte}"
            else:
                texte = f"{verbes.get(principal['operation'], 'Action')} — {texte}"
            if principal.get("champs"):
                texte += " : " + ", ".join(c["champ"] for c in principal["champs"][:6])
            if total > 1:
                texte += f" (+ {total - 1} autre(s) élément(s))"
            return texte[:255]
        if nom_action:
            return f"{_libelle_segment(nom_action)} — {ressource}"[:255]
        return f"{verbes.get(action, 'Action')} — {ressource}"[:255]

    @staticmethod
    def _categorie(request, principal, modele_vue, action) -> str:
        if action == "connexion":
            return "connexion"
        cle = principal["cle"] if principal else (modele_vue._meta.label if modele_vue else "")
        if cle in _CATEGORIES_PAR_MODELE:
            return _CATEGORIES_PAR_MODELE[cle]
        app = cle.split(".")[0] if cle else (_segments(request) or [""])[0]
        if app == "people":
            return "eleve"
        return _CATEGORIES_PAR_APP.get(app, "autre")
