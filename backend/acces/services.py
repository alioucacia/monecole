"""Logique du contrôle d'accès : retrouver la personne derrière un identifiant lu par un
équipement, décider du sens (entrée / sortie) et enregistrer le passage."""

import re
from datetime import timedelta

from django.utils import timezone

from .models import CarteAcces, Passage, normaliser_uid

UUID = re.compile(r"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}")

# Un même badge présenté deux fois de suite (double lecture, hésitation au portillon) dans ce
# délai ne crée pas de second passage : on renvoie le précédent.
DELAI_ANTI_DOUBLON = timedelta(seconds=45)


def resoudre_personne(ecole, identifiant: str):
    """(utilisateur, méthode, motif_refus) pour un identifiant lu : contenu du QR code d'une
    carte élève/enseignant (qui contient l'adresse de vérification avec son jeton), numéro de
    carte RFID enregistré, ou matricule (biométrie, caméra, saisie manuelle)."""
    from people.models import EleveBadge, EleveProfile, EnseignantBadge, EnseignantProfile

    texte = (identifiant or "").strip()
    if not texte:
        return None, Passage.Methode.INCONNU, "Identifiant vide"

    jeton = UUID.search(texte)
    if jeton:
        jeton = jeton.group(0)
        badge = EleveBadge.objects.select_related("eleve__user").filter(qr_token=jeton, eleve__user__ecole=ecole).first()
        if badge:
            return (badge.eleve.user, Passage.Methode.QR, None) if badge.actif else (badge.eleve.user, Passage.Methode.QR, "Carte désactivée")
        badge = EnseignantBadge.objects.select_related("enseignant__user").filter(qr_token=jeton, enseignant__user__ecole=ecole).first()
        if badge:
            return (badge.enseignant.user, Passage.Methode.QR, None) if badge.actif else (badge.enseignant.user, Passage.Methode.QR, "Carte désactivée")

    carte = CarteAcces.objects.select_related("personne").filter(ecole=ecole, uid=normaliser_uid(texte)).first()
    if carte:
        return (carte.personne, Passage.Methode.RFID, None) if carte.actif else (carte.personne, Passage.Methode.RFID, "Carte désactivée")

    eleve = EleveProfile.objects.select_related("user").filter(user__ecole=ecole, matricule__iexact=texte).first()
    if eleve:
        return eleve.user, Passage.Methode.MATRICULE, None
    enseignant = EnseignantProfile.objects.select_related("user").filter(user__ecole=ecole, matricule__iexact=texte).first()
    if enseignant:
        return enseignant.user, Passage.Methode.MATRICULE, None

    return None, Passage.Methode.INCONNU, "Badge inconnu"


def _sens_automatique(personne) -> str:
    """Premier passage de la journée = entrée, puis alternance entrée / sortie."""
    debut_jour = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    dernier = Passage.objects.filter(personne=personne, autorise=True, horodatage__gte=debut_jour).order_by("-horodatage").first()
    return Passage.Sens.SORTIE if dernier and dernier.sens == Passage.Sens.ENTREE else Passage.Sens.ENTREE


def enregistrer_passage(ecole, identifiant: str, equipement=None, sens: str | None = None) -> Passage:
    """Enregistre le passage (ou le refus) et le renvoie. `sens` : imposé par l'appelant ;
    sinon celui de l'équipement (entrées / sorties uniquement) ; sinon automatique."""
    from people.models import EleveProfile

    maintenant = timezone.now()
    if equipement is not None:
        type(equipement).objects.filter(pk=equipement.pk).update(derniere_activite=maintenant)

    personne, methode, motif = resoudre_personne(ecole, identifiant)
    if personne is not None and motif is None:
        if not personne.is_active:
            motif = "Compte désactivé"
        elif personne.role == "student":
            eleve = EleveProfile.objects.filter(user=personne).only("actif").first()
            if eleve and not eleve.actif:
                motif = "Élève inactif"

    if personne is not None and motif is None:
        recent = Passage.objects.filter(personne=personne, autorise=True, horodatage__gte=maintenant - DELAI_ANTI_DOUBLON).first()
        if recent:
            return recent

    classe = ""
    if personne is not None and personne.role == "student":
        eleve = EleveProfile.objects.select_related("classe").filter(user=personne).first()
        classe = eleve.classe.nom if eleve and eleve.classe else ""

    if motif is None:
        if sens not in (Passage.Sens.ENTREE, Passage.Sens.SORTIE):
            sens = equipement.sens if equipement is not None and equipement.sens != "auto" else _sens_automatique(personne)
    else:
        sens = ""

    return Passage.objects.create(
        ecole=ecole, equipement=equipement, personne=personne,
        nom_affiche=personne.get_full_name() if personne else "", role=personne.role if personne else "",
        classe=classe, sens=sens, methode=methode, identifiant_lu=(identifiant or "")[:255],
        autorise=motif is None, motif_refus=motif or "", horodatage=maintenant,
    )


def message_passage(passage: Passage) -> str:
    """« 🟢 Mamadou Barry — entrée 07:42 » / « 🔵 … — sortie 16:18 » / « ⛔ Refusé — motif »."""
    heure = timezone.localtime(passage.horodatage).strftime("%H:%M")
    if not passage.autorise:
        qui = f"{passage.nom_affiche} — " if passage.nom_affiche else ""
        return f"⛔ {qui}accès refusé ({passage.motif_refus}) {heure}"
    pastille = "🟢" if passage.sens == Passage.Sens.ENTREE else "🔵"
    return f"{pastille} {passage.nom_affiche} — {passage.get_sens_display().lower()} {heure}"


def reponse_passage(passage: Passage, request=None) -> dict:
    """Réponse renvoyée à l'équipement / à la borne. `ouvrir` : à utiliser par un contrôleur de
    porte ou un tourniquet pour déverrouiller."""
    photo = None
    if passage.personne_id and passage.personne.photo and request is not None:
        photo = request.build_absolute_uri(passage.personne.photo.url)
    return {
        "ouvrir": passage.autorise,
        "autorise": passage.autorise,
        "sens": passage.sens or None,
        "nom": passage.nom_affiche or None,
        "role": passage.role or None,
        "classe": passage.classe or None,
        "heure": timezone.localtime(passage.horodatage).strftime("%H:%M"),
        "horodatage": passage.horodatage,
        "motif_refus": passage.motif_refus or None,
        "message": message_passage(passage),
        "photo": photo,
        "passage_id": passage.id,
    }
