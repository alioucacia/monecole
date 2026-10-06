"""Sécurité avancée du compte Super Admin — accès à TOUTE la plateforme, donc protégé plus
strictement que les autres rôles :

- application d'authentification (TOTP, RFC 6238) + codes de secours, en plus du code par
  e-mail/SMS déjà disponible pour tous (voir services.generer_otp) ;
- sessions révocables : chaque connexion ouvre une `SessionActive` dont l'identifiant (`sid`) est
  embarqué dans les jetons JWT et revérifié à chaque requête (voir authentication.py) — c'est ce
  qui rend possible « déconnecter cet appareil » / « déconnecter toutes les sessions » malgré des
  JWT sans état ;
- verrouillage temporaire du compte après trop d'échecs de connexion ;
- journal de sécurité (`EvenementSecurite`) et alertes de connexion inhabituelle (nouvel
  appareil ou nouvelle adresse IP), envoyées par e-mail/SMS.

Tout passe par `est_protege(user)` : les autres rôles gardent exactement leur comportement
d'avant (pas de verrouillage qui permettrait de bloquer des comptes élèves en masse, pas de
requête supplémentaire par appel API)."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from io import BytesIO
from urllib.parse import quote

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed

from .models import AppareilConnu, EvenementSecurite, JournalUtilisateur, SessionActive, User
from .services import _adresse_ip, _resumer_appareil, journaliser

# Limitation des tentatives : MAX_ECHECS échecs (mot de passe ou code 2FA) dans FENETRE_ECHECS
# depuis la dernière connexion réussie verrouillent le compte pendant DUREE_VERROUILLAGE. Le
# throttling DRF « login » (par IP) reste en place en plus : celui-ci protège le COMPTE même
# contre des tentatives réparties sur de nombreuses adresses.
MAX_ECHECS = 5
FENETRE_ECHECS = timezone.timedelta(minutes=15)
DUREE_VERROUILLAGE = timezone.timedelta(minutes=15)

# Écriture de `SessionActive.derniere_activite` au plus une fois par minute (même logique que
# User.derniere_activite dans authentication.py).
_DELAI_MAJ_SESSION = timezone.timedelta(minutes=1)

_SALT_TICKET_2FA = "connexion-2fa"
DUREE_TICKET_2FA_SECONDES = 5 * 60

TOTP_PAS_SECONDES = 30
TOTP_CHIFFRES = 6
NB_CODES_SECOURS = 10


def est_protege(user) -> bool:
    return user is not None and user.role == User.Role.SUPERADMIN


# ---------------------------------------------------------------------------
# Contexte de la requête (IP, appareil)
# ---------------------------------------------------------------------------

def _user_agent(request) -> str:
    return request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else ""


def _empreinte_appareil(request) -> str:
    """Identifie le navigateur : l'identifiant aléatoire que le frontend conserve dans le
    navigateur (en-tête X-Device-Id, voir api/client.ts) — à défaut (client sans cet en-tête),
    le résumé du User-Agent (« Chrome sur Windows »). Toujours haché : l'identifiant brut ne sert
    qu'à être reconnu, inutile de le stocker tel quel."""
    brut = (request.META.get("HTTP_X_DEVICE_ID", "") if request is not None else "")[:128]
    if not brut:
        brut = "ua:" + (_resumer_appareil(_user_agent(request)) or _user_agent(request))
    return hashlib.sha256(brut.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Journal de sécurité et alertes
# ---------------------------------------------------------------------------

def evenement(user, type_: str, description: str, request=None, niveau: str = EvenementSecurite.Niveau.INFO,
              alerte: bool = False) -> EvenementSecurite:
    """Ajoute une entrée au journal de sécurité. `alerte=True` la signale comme non lue (badge
    d'alerte sur la page Sécurité) — réservé à ce qui mérite l'attention du titulaire, pas à
    chaque échec de mot de passe isolé."""
    return EvenementSecurite.objects.create(
        user=user, type=type_, niveau=niveau, description=description[:255],
        adresse_ip=_adresse_ip(request) if request is not None else None,
        appareil=_resumer_appareil(_user_agent(request)) if request is not None else "",
        lu=not alerte,
    )


def _notifier(user, sujet: str, message: str) -> None:
    """E-mail + SMS (chacun indépendant, best-effort) — une alerte de sécurité ne doit jamais
    faire échouer la connexion ou l'action qui la déclenche."""
    from .notifications import _envoyer_email, _envoyer_sms

    corps = (
        f"Bonjour {user.get_full_name() or user.username},\n\n{message}\n\n"
        "Si vous n'êtes pas à l'origine de cette action, changez immédiatement votre mot de passe "
        "et déconnectez toutes les sessions depuis la page « Sécurité du compte ».\n\n"
        "— L'équipe Taly-School"
    )
    _envoyer_email(user.email, f"Taly-School — {sujet}", corps)
    _envoyer_sms(user.phone, f"Taly-School : {sujet}. {message[:100]}")


def _decrire_contexte(request) -> str:
    morceaux = [
        f"Date : {timezone.localtime():%d/%m/%Y à %H:%M}",
        f"Adresse IP : {_adresse_ip(request) or 'inconnue'}",
        f"Appareil : {_resumer_appareil(_user_agent(request)) or 'inconnu'}",
    ]
    return "\n".join(morceaux)


def _enregistrer_appareil(user, request) -> tuple[AppareilConnu, bool]:
    """Enregistre/actualise l'appareil de cette connexion et indique si elle est inhabituelle :
    appareil jamais vu, ou adresse IP jamais utilisée pour une connexion réussie. La toute
    première connexion d'un compte (aucun appareil connu) n'est pas signalée — il n'y a encore
    rien d'« habituel » à quoi la comparer. À appeler AVANT de journaliser la connexion réussie
    (sinon l'IP courante serait toujours « déjà vue »)."""
    ip = _adresse_ip(request)
    libelle = _resumer_appareil(_user_agent(request))
    avait_des_appareils = user.appareils_connus.exists()
    appareil, cree = AppareilConnu.objects.get_or_create(
        user=user, empreinte=_empreinte_appareil(request),
        defaults={"libelle": libelle, "derniere_ip": ip},
    )
    if not cree:
        appareil.derniere_connexion = timezone.now()
        appareil.derniere_ip = ip
        if libelle:
            appareil.libelle = libelle
        appareil.save(update_fields=["derniere_connexion", "derniere_ip", "libelle"])

    ip_connue = ip is None or EvenementSecurite.objects.filter(
        user=user, type=EvenementSecurite.Type.CONNEXION_REUSSIE, adresse_ip=ip,
    ).exists()
    inhabituelle = avait_des_appareils and (cree or not ip_connue)
    return appareil, inhabituelle


# ---------------------------------------------------------------------------
# Limitation des tentatives / verrouillage
# ---------------------------------------------------------------------------

def minutes_restantes_verrou(user) -> int:
    if not user.verrouille_jusqu_a or user.verrouille_jusqu_a <= timezone.now():
        return 0
    return max(1, int((user.verrouille_jusqu_a - timezone.now()).total_seconds() // 60) + 1)


def verifier_verrou(user, request=None) -> None:
    """Lève `AuthenticationFailed(code="compte_verrouille")` si le compte est verrouillé — à
    appeler AVANT toute vérification du mot de passe ou du code, pour qu'un attaquant ne puisse
    pas continuer à essayer pendant le verrouillage."""
    restant = minutes_restantes_verrou(user)
    if restant:
        evenement(user, EvenementSecurite.Type.CONNEXION_BLOQUEE,
                  "Tentative de connexion pendant le verrouillage du compte", request,
                  niveau=EvenementSecurite.Niveau.AVERTISSEMENT)
        raise AuthenticationFailed(
            f"Compte temporairement verrouillé après trop de tentatives échouées. Réessayez dans {restant} min.",
            code="compte_verrouille",
        )


def enregistrer_echec_connexion(user, request, type_: str) -> bool:
    """Journalise l'échec et verrouille le compte au-delà de MAX_ECHECS échecs récents. Renvoie
    True si ce dernier échec vient de déclencher le verrouillage."""
    libelles = {
        EvenementSecurite.Type.ECHEC_MOT_DE_PASSE: "Mot de passe incorrect",
        EvenementSecurite.Type.ECHEC_2FA: "Code de double authentification incorrect",
    }
    evenement(user, type_, libelles.get(type_, "Échec de connexion"), request,
              niveau=EvenementSecurite.Niveau.AVERTISSEMENT)

    maintenant = timezone.now()
    depuis = maintenant - FENETRE_ECHECS
    dernier_succes = (
        EvenementSecurite.objects.filter(user=user, type=EvenementSecurite.Type.CONNEXION_REUSSIE)
        .values_list("horodatage", flat=True).first()
    )
    # Un verrouillage déjà purgé « remet le compteur à zéro » : sans ça, le premier échec qui
    # suit la fin d'un verrouillage reverrouillerait aussitôt (les 5 échecs d'avant sont encore
    # dans la fenêtre).
    for borne in (dernier_succes, user.verrouille_jusqu_a):
        if borne and borne > depuis:
            depuis = borne
    nb_echecs = EvenementSecurite.objects.filter(
        user=user, type__in=EvenementSecurite.TYPES_ECHEC, horodatage__gte=depuis,
    ).count()
    if nb_echecs < MAX_ECHECS:
        return False

    user.verrouille_jusqu_a = maintenant + DUREE_VERROUILLAGE
    user.save(update_fields=["verrouille_jusqu_a"])
    minutes = int(DUREE_VERROUILLAGE.total_seconds() // 60)
    evenement(user, EvenementSecurite.Type.COMPTE_VERROUILLE,
              f"Compte verrouillé {minutes} min après {nb_echecs} tentatives échouées", request,
              niveau=EvenementSecurite.Niveau.CRITIQUE, alerte=True)
    _notifier(
        user, "Compte verrouillé",
        f"Votre compte a été verrouillé pendant {minutes} minutes après {nb_echecs} tentatives de "
        f"connexion échouées.\n\n{_decrire_contexte(request)}",
    )
    return True


def deverrouiller(user, par=None, request=None) -> None:
    user.verrouille_jusqu_a = None
    user.save(update_fields=["verrouille_jusqu_a"])
    auteur = f" par {par.get_full_name() or par.username}" if par is not None and par.pk != user.pk else ""
    evenement(user, EvenementSecurite.Type.COMPTE_DEVERROUILLE, f"Compte déverrouillé{auteur}", request)


# ---------------------------------------------------------------------------
# Sessions et jetons
# ---------------------------------------------------------------------------

def emettre_jetons(user, request, appareil: AppareilConnu | None = None) -> dict:
    """access/refresh pour `user`. Pour un Super Admin, ouvre une `SessionActive` et embarque
    son identifiant (`sid`) dans les jetons — revendication recopiée par SimpleJWT dans chaque
    access token dérivé et conservée lors de la rotation du refresh token."""
    from .serializers import CustomTokenObtainPairSerializer

    refresh = CustomTokenObtainPairSerializer.get_token(user)
    if est_protege(user):
        session = SessionActive.objects.create(
            user=user, sid=secrets.token_urlsafe(32), appareil=appareil,
            adresse_ip=_adresse_ip(request), appareil_libelle=_resumer_appareil(_user_agent(request)),
            user_agent=_user_agent(request),
            expire_le=timezone.now() + settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"],
        )
        refresh["sid"] = session.sid
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def session_valide(user, sid: str | None, request=None, prolonger: bool = False) -> SessionActive:
    """Session active correspondant à `sid` — lève `AuthenticationFailed(code="session_expiree")`
    sinon (révoquée, expirée, ou jeton antérieur à cette fonctionnalité, sans `sid`).
    `prolonger=True` (rafraîchissement du jeton) repousse son expiration comme le fait la
    rotation du refresh token côté SimpleJWT."""
    session = SessionActive.objects.filter(sid=sid, user_id=user.pk).first() if sid else None
    if session is None or not session.active:
        raise AuthenticationFailed(
            "Cette session a été fermée. Merci de vous reconnecter.", code="session_expiree",
        )
    maintenant = timezone.now()
    champs = []
    if maintenant - session.derniere_activite >= _DELAI_MAJ_SESSION:
        session.derniere_activite = maintenant
        champs.append("derniere_activite")
        ip = _adresse_ip(request) if request is not None else None
        if ip and ip != session.adresse_ip:
            session.adresse_ip = ip
            champs.append("adresse_ip")
    if prolonger:
        session.expire_le = maintenant + settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
        champs.append("expire_le")
    if champs:
        session.save(update_fields=champs)
    return session


def sessions_actives(user):
    return SessionActive.objects.filter(user=user, revoquee_le__isnull=True, expire_le__gt=timezone.now())


def revoquer_sessions(user, sauf_sid: str | None = None, appareil: AppareilConnu | None = None) -> int:
    qs = sessions_actives(user)
    if sauf_sid:
        qs = qs.exclude(sid=sauf_sid)
    if appareil is not None:
        qs = qs.filter(appareil=appareil)
    return qs.update(revoquee_le=timezone.now())


def sid_de_requete(request) -> str | None:
    token = getattr(request, "auth", None)
    return token.get("sid") if token is not None else None


# ---------------------------------------------------------------------------
# Connexion
# ---------------------------------------------------------------------------

def finaliser_connexion(user, request, description: str, jetons: dict | None = None) -> dict:
    """Dernière étape commune à toute connexion réussie (avec ou sans 2FA) : jetons, journaux,
    et — pour le Super Admin — session révocable + détection de connexion inhabituelle.
    `jetons` : ceux déjà émis par SimpleJWT, réutilisés tels quels hors Super Admin."""
    if jetons is None:
        # Connexion en deux temps (2FA) : SimpleJWT ne l'a pas fait lors du premier temps.
        from django.contrib.auth.models import update_last_login

        update_last_login(None, user)
    if not est_protege(user):
        journaliser(user, JournalUtilisateur.Categorie.CONNEXION, description, request)
        return jetons or emettre_jetons(user, request)

    appareil, inhabituelle = _enregistrer_appareil(user, request)
    jetons = emettre_jetons(user, request, appareil)
    journaliser(user, JournalUtilisateur.Categorie.CONNEXION, description, request)
    evenement(user, EvenementSecurite.Type.CONNEXION_REUSSIE, description, request)
    if user.verrouille_jusqu_a:
        user.verrouille_jusqu_a = None
        user.save(update_fields=["verrouille_jusqu_a"])
    if inhabituelle:
        evenement(user, EvenementSecurite.Type.CONNEXION_INHABITUELLE,
                  "Connexion depuis un nouvel appareil ou une nouvelle adresse IP", request,
                  niveau=EvenementSecurite.Niveau.AVERTISSEMENT, alerte=True)
        _notifier(user, "Nouvelle connexion à votre compte",
                  f"Une connexion inhabituelle à votre compte Super Admin vient d'avoir lieu.\n\n{_decrire_contexte(request)}")
    return jetons


def creer_ticket_2fa(user) -> str:
    """Preuve signée et de courte durée que le mot de passe vient d'être vérifié — exigée pour
    valider un code TOTP (contrairement au code e-mail/SMS, un code TOTP ne dépend pas d'un envoi
    déclenché par le mot de passe : sans ce ticket, l'identifiant + un code d'application
    suffiraient à se connecter)."""
    return signing.dumps({"uid": user.pk, "n": secrets.token_hex(4)}, salt=_SALT_TICKET_2FA)


def lire_ticket_2fa(ticket: str) -> User | None:
    try:
        donnees = signing.loads(ticket, salt=_SALT_TICKET_2FA, max_age=DUREE_TICKET_2FA_SECONDES)
    except signing.BadSignature:
        return None
    return User.objects.filter(pk=donnees.get("uid"), is_active=True).first()


# ---------------------------------------------------------------------------
# TOTP (RFC 6238) — implémenté ici plutôt qu'avec une dépendance (pyotp) : quelques lignes de
# HMAC-SHA1, compatibles Google Authenticator, Microsoft Authenticator, Authy, 1Password...
# ---------------------------------------------------------------------------

def generer_secret_totp() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code_totp(secret: str, pas: int) -> str:
    cle = base64.b32decode(secret + "=" * (-len(secret) % 8))
    condensat = hmac.new(cle, struct.pack(">Q", pas), hashlib.sha1).digest()
    decalage = condensat[-1] & 0x0F
    valeur = struct.unpack(">I", condensat[decalage:decalage + 4])[0] & 0x7FFFFFFF
    return f"{valeur % 10 ** TOTP_CHIFFRES:0{TOTP_CHIFFRES}d}"


def uri_totp(user, secret: str) -> str:
    from tenants.models import ParametresPlateforme

    emetteur = getattr(ParametresPlateforme.charger(), "nom_plateforme", "") or "Taly-School"
    compte = user.email or user.username
    return (
        f"otpauth://totp/{quote(emetteur)}:{quote(compte)}"
        f"?secret={secret}&issuer={quote(emetteur)}&digits={TOTP_CHIFFRES}&period={TOTP_PAS_SECONDES}"
    )


def qr_code_data_uri(texte: str) -> str:
    import qrcode

    buffer = BytesIO()
    qrcode.make(texte).save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}"


def verifier_code_totp(user, code: str, secret: str | None = None) -> bool:
    """Accepte le pas courant ±1 (décalage d'horloge du téléphone) et refuse tout pas déjà
    utilisé (`totp_dernier_pas`) — un code intercepté ne peut pas être rejoué."""
    secret = secret or user.totp_secret
    code = (code or "").strip().replace(" ", "")
    if not secret or len(code) != TOTP_CHIFFRES or not code.isdigit():
        return False
    pas_courant = int(time.time()) // TOTP_PAS_SECONDES
    for pas in (pas_courant - 1, pas_courant, pas_courant + 1):
        if user.totp_dernier_pas is not None and pas <= user.totp_dernier_pas:
            continue
        if hmac.compare_digest(_code_totp(secret, pas), code):
            user.totp_dernier_pas = pas
            user.save(update_fields=["totp_dernier_pas"])
            return True
    return False


# ---------------------------------------------------------------------------
# Codes de secours
# ---------------------------------------------------------------------------

_ALPHABET_SECOURS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sans 0/O ni 1/I, souvent confondus


def _empreinte_code_secours(code: str) -> str:
    normalise = code.strip().upper().replace("-", "").replace(" ", "")
    return hmac.new(settings.SECRET_KEY.encode(), normalise.encode(), hashlib.sha256).hexdigest()


def generer_codes_secours(user) -> list[str]:
    """Remplace tous les codes existants — renvoyés en clair UNE seule fois (à afficher/
    télécharger immédiatement), seules leurs empreintes sont conservées. HMAC plutôt qu'un
    hachage de mot de passe lent : 40 bits d'entropie aléatoire par code suffisent, et il faut
    pouvoir en comparer 10 à chaque tentative."""
    codes = [
        "".join(secrets.choice(_ALPHABET_SECOURS) for _ in range(4)) + "-"
        + "".join(secrets.choice(_ALPHABET_SECOURS) for _ in range(4))
        for _ in range(NB_CODES_SECOURS)
    ]
    user.codes_secours = [_empreinte_code_secours(c) for c in codes]
    user.save(update_fields=["codes_secours"])
    return codes


def utiliser_code_secours(user, code: str) -> bool:
    empreinte = _empreinte_code_secours(code or "")
    restants = list(user.codes_secours or [])
    for existante in restants:
        if hmac.compare_digest(existante, empreinte):
            restants.remove(existante)
            user.codes_secours = restants
            user.save(update_fields=["codes_secours"])
            return True
    return False


def verifier_second_facteur_totp(user, code: str, request=None) -> bool:
    """Code de l'application d'authentification, ou à défaut un code de secours (consommé)."""
    if verifier_code_totp(user, code):
        return True
    if utiliser_code_secours(user, code):
        restants = len(user.codes_secours)
        evenement(user, EvenementSecurite.Type.CODE_SECOURS_UTILISE,
                  f"Connexion avec un code de secours ({restants} restant{'s' if restants > 1 else ''})", request,
                  niveau=EvenementSecurite.Niveau.AVERTISSEMENT, alerte=True)
        return True
    return False


def desactiver_totp(user) -> None:
    user.totp_actif = False
    user.totp_secret = ""
    user.totp_dernier_pas = None
    user.codes_secours = []
    user.save(update_fields=["totp_actif", "totp_secret", "totp_dernier_pas", "codes_secours"])


# ---------------------------------------------------------------------------
# Mot de passe
# ---------------------------------------------------------------------------

def apres_changement_mot_de_passe(user, request=None, garder_sid: str | None = None, reinitialisation=False) -> None:
    """Un mot de passe changé ferme toutes les autres sessions du Super Admin (si l'ancien a
    fuité, les sessions ouvertes avec lui ne doivent pas survivre) et prévient le titulaire."""
    if not est_protege(user):
        return
    nb = revoquer_sessions(user, sauf_sid=garder_sid)
    libelle = "Mot de passe réinitialisé" if reinitialisation else "Mot de passe changé"
    evenement(user, EvenementSecurite.Type.MOT_DE_PASSE_CHANGE,
              f"{libelle} — {nb} autre(s) session(s) fermée(s)", request,
              niveau=EvenementSecurite.Niveau.AVERTISSEMENT)
    _notifier(user, libelle, f"Le mot de passe de votre compte vient d'être modifié.\n\n{_decrire_contexte(request)}")
