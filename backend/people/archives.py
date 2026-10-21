"""Archives des élèves : sortie (archivage, transfert, abandon, fin de cycle), reclassement d'une
sortie et restauration. Une sortie ne supprime rien — l'élève garde sa classe, ses notes, frais
et paiements, il devient seulement inactif — et chaque opération est tracée dans
`HistoriqueStatutEleve`, qui survit à la restauration."""

from datetime import date

from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import EleveProfile, HistoriqueStatutEleve, TypeSortie, enregistrer_historique_classe


def _tracer(eleve, evenement, auteur, **champs):
    HistoriqueStatutEleve.objects.create(
        eleve=eleve, evenement=evenement, auteur=auteur,
        classe=eleve.classe, annee_scolaire=eleve.classe.annee_scolaire if eleve.classe else None,
        **champs,
    )


@transaction.atomic
def sortir_eleve(eleve, type_sortie, auteur, motif="", date_sortie=None, etablissement_destination=""):
    """Rend l'élève inactif avec la nature de sa sortie. Sur un élève déjà sorti, change la nature
    / le motif de sa sortie (reclassement) sans toucher à sa date de sortie d'origine."""
    if type_sortie not in TypeSortie.values:
        raise ValidationError({"type_sortie": "Type de sortie inconnu."})
    if type_sortie != TypeSortie.TRANSFERT:
        etablissement_destination = ""
    deja_sorti = not eleve.actif
    eleve.actif = False
    eleve.type_sortie = type_sortie
    eleve.motif_sortie = motif or ""
    eleve.etablissement_destination = etablissement_destination or ""
    if date_sortie:
        eleve.date_sortie = date_sortie
    elif not deja_sorti or not eleve.date_sortie:
        eleve.date_sortie = date.today()
    eleve.save(update_fields=["actif", "type_sortie", "motif_sortie", "etablissement_destination", "date_sortie"])
    _tracer(
        eleve,
        HistoriqueStatutEleve.Evenement.RECLASSEMENT if deja_sorti else HistoriqueStatutEleve.Evenement.SORTIE,
        auteur, type_sortie=type_sortie, date=eleve.date_sortie, motif=eleve.motif_sortie,
        etablissement_destination=eleve.etablissement_destination,
    )
    return eleve


@transaction.atomic
def restaurer_eleve(eleve, auteur, classe=None, motif=""):
    """Remet l'élève en activité, éventuellement dans une nouvelle classe (sinon il retrouve sa
    dernière classe). Ses notes, frais, paiements et l'historique de ses sorties sont conservés."""
    if eleve.actif:
        raise ValidationError("Cet élève est déjà actif.")
    if classe is not None:
        if classe.annee_scolaire.ecole_id != eleve.user.ecole_id:
            raise ValidationError({"classe": "Classe introuvable dans votre établissement."})
        if classe.id != eleve.classe_id and classe.places_disponibles <= 0:
            raise ValidationError({"classe": f"« {classe.nom} » n'a plus de place disponible."})
    ancien_type = eleve.type_sortie
    eleve.actif = True
    eleve.type_sortie = ""
    eleve.date_sortie = None
    eleve.motif_sortie = ""
    eleve.etablissement_destination = ""
    champs = ["actif", "type_sortie", "date_sortie", "motif_sortie", "etablissement_destination"]
    if classe is not None:
        eleve.classe = classe
        champs.append("classe")
    eleve.save(update_fields=champs)
    if classe is not None:
        enregistrer_historique_classe(eleve, classe)
    _tracer(
        eleve, HistoriqueStatutEleve.Evenement.RESTAURATION, auteur,
        type_sortie=ancien_type, date=date.today(), motif=motif or "",
    )
    return eleve


def resume_archives(ecole_id) -> dict:
    """Nombre d'élèves inactifs de l'école par nature de sortie (+ total)."""
    from django.db.models import Count

    compte = dict(
        EleveProfile.objects.filter(user__ecole_id=ecole_id, actif=False)
        .values_list("type_sortie").annotate(n=Count("id")).values_list("type_sortie", "n")
    )
    resume = {t: compte.get(t, 0) for t in TypeSortie.values}
    # Sortie sans nature connue (ne devrait plus arriver après la migration 0014) : comptée en archivé.
    resume[TypeSortie.ARCHIVE] += compte.get("", 0)
    resume["total"] = sum(compte.values())
    return resume
