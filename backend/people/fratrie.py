"""Réduction « fratrie » : un parent qui a au moins `SEUIL_FRATRIE` enfants inscrits (actifs)
dans l'établissement ne paie pas la mensualité de celui qui est dans la classe la plus basse.

Le bénéficiaire est recalculé automatiquement (voir people/signals.py) et mémorisé dans
`EleveProfile.exonere_fratrie`, lu par `EleveProfile.facteur_mensualite`.
"""

import re
import unicodedata

SEUIL_FRATRIE = 6

_ORDRE_CYCLES = {"prescolaire": 0, "primaire": 1, "college": 2, "lycee": 3}
# Niveaux reconnus par mot-clé, dans l'ordre croissant au sein de leur cycle.
_MOTS_CLES = [
    ("creche", 0), ("garderie", 0), ("petite section", 1), ("ps", 1), ("moyenne section", 2), ("ms", 2),
    ("grande section", 3), ("gs", 3),
    ("cp1", 1), ("cp2", 2), ("cp", 1), ("ce1", 3), ("ce2", 4), ("cm1", 5), ("cm2", 6),
    ("seconde", 1), ("2nde", 1), ("2de", 1), ("premiere", 2), ("terminale", 20), ("tle", 20), ("term", 20),
]


def _normaliser(texte):
    texte = unicodedata.normalize("NFKD", texte or "")
    return "".join(c for c in texte if not unicodedata.combining(c)).lower()


def rang_niveau(classe) -> tuple:
    """Clé de tri croissante d'une classe (la plus basse en premier) : cycle, puis rang dans
    le cycle d'après le libellé du niveau. Gère les deux usages courants :
    - guinéen : 1ère…6ème année (primaire), 7ème…10ème (collège), 11ème, 12ème, Terminale ;
    - français : CP…CM2, 6ème→3ème (collège, le chiffre DÉCROÎT), 2nde, 1ère, Terminale.
    Classe absente ou niveau non reconnu : après toutes les classes reconnues."""
    if classe is None:
        return (99, 99)
    cycle = _ORDRE_CYCLES.get(classe.cycle, 9)
    texte = _normaliser(f"{classe.niveau} {classe.nom}")
    tokens = set(re.findall(r"[a-z0-9]+", texte))
    for mot, rang in _MOTS_CLES:
        if (" " in mot and mot in texte) or mot in tokens:
            return (cycle, rang)
    nombre = re.search(r"\d+", texte)
    if nombre:
        n = int(nombre.group())
        if classe.cycle == "college" and 3 <= n <= 6:
            return (cycle, 10 - n)  # collège français : 6ème (la plus basse) → 3ème
        if classe.cycle == "lycee" and n in (1, 2):
            return (cycle, 3 - n)  # lycée français : 2nde → 1ère
        return (cycle, n)
    return (cycle, 50)


def cle_beneficiaire(eleve) -> tuple:
    """Classe la plus basse d'abord ; à égalité, le plus jeune, puis le premier inscrit."""
    naissance = eleve.user.date_of_birth
    return (*rang_niveau(eleve.classe), -(naissance.toordinal() if naissance else 0), eleve.id)


def recalculer_exoneration_fratrie(parent_id, modele=None) -> None:
    """Désigne (ou retire) l'enfant exonéré de mensualité parmi les enfants actifs du parent.
    `modele` : EleveProfile (ou sa version historique, depuis une migration)."""
    if not parent_id:
        return
    if modele is None:
        from .models import EleveProfile as modele
    enfants = list(modele.objects.filter(parent_id=parent_id, actif=True).select_related("classe", "user"))
    beneficiaire = min(enfants, key=cle_beneficiaire) if len(enfants) >= SEUIL_FRATRIE else None
    tous = modele.objects.filter(parent_id=parent_id)
    if beneficiaire:
        tous.exclude(pk=beneficiaire.pk).filter(exonere_fratrie=True).update(exonere_fratrie=False)
        tous.filter(pk=beneficiaire.pk, exonere_fratrie=False).update(exonere_fratrie=True)
    else:
        tous.filter(exonere_fratrie=True).update(exonere_fratrie=False)
