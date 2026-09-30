"""Évaluation des enseignants par la direction — indicateurs calculés, pour une année scolaire,
à partir des données déjà saisies dans la plateforme (rien à ressaisir) :

- présence et ponctualité : pointages de l'enseignant (Présent / Retard / Absent) ;
- volume de cours : heures hebdomadaires prévues à l'emploi du temps + heures pointées ;
- progression des programmes : chapitres terminés dans ses matières/classes ;
- résultats des classes : moyenne (ramenée sur 20) et taux de réussite de ses élèves dans ses
  matières ;
- évaluations des élèves : évaluations (devoirs, interrogations, compositions…) données et notes
  saisies.

Appelé par people.views.EvaluationEnseignantsView (tableau de l'année, et historique annuel d'un
enseignant).
"""

from datetime import date, datetime, timedelta
from decimal import Decimal


def _heures(debut, fin) -> float:
    if not debut or not fin:
        return 0.0
    ecart = datetime.combine(date.today(), fin) - datetime.combine(date.today(), debut)
    return max(ecart, timedelta(0)).total_seconds() / 3600


def _pourcentage(part, total):
    return round(part * 100 / total) if total else None


def evaluer_enseignant(enseignant, annee) -> dict:
    from academics.models import ChapitreProgramme, Creneau, Enseignement
    from grades.models import Note
    from grades.views import _moyenne_ponderee, _sur_20
    from people.models import EleveProfile, HistoriqueClasse, PointageEnseignant

    user = enseignant.user
    enseignements = list(
        Enseignement.objects.filter(enseignant=user, classe__annee_scolaire=annee).select_related("classe", "matiere")
    )

    # Présence et ponctualité.
    pointages = list(PointageEnseignant.objects.filter(
        enseignant=enseignant, date__gte=annee.date_debut, date__lte=annee.date_fin,
    ))
    presents = sum(1 for p in pointages if p.statut == PointageEnseignant.Statut.PRESENT)
    retards = sum(1 for p in pointages if p.statut == PointageEnseignant.Statut.RETARD)
    absents = sum(1 for p in pointages if p.statut == PointageEnseignant.Statut.ABSENT)
    heures_pointees = sum(_heures(p.heure_arrivee, p.heure_depart) for p in pointages)

    # Volume de cours prévu à l'emploi du temps (heures par semaine).
    heures_hebdo = sum(
        _heures(c.heure_debut, c.heure_fin) for c in Creneau.objects.filter(enseignement__in=enseignements)
    )

    # Progression des programmes de ses matières dans ses classes.
    chapitres_total = chapitres_termines = 0
    for e in enseignements:
        chapitres = ChapitreProgramme.objects.filter(classe=e.classe, matiere=e.matiere)
        chapitres_total += chapitres.count()
        chapitres_termines += chapitres.filter(statut=ChapitreProgramme.Statut.TERMINE).count()

    # Résultats de ses classes dans ses matières (moyennes des élèves, ramenées sur 20 pour que
    # primaire et collège soient comparables), classe par classe.
    detail_classes = []
    moyennes_20, reussites, effectif_total = [], 0, 0
    for e in enseignements:
        ids_eleves = set(HistoriqueClasse.objects.filter(classe=e.classe).values_list("eleve_id", flat=True))
        ids_eleves |= set(EleveProfile.objects.filter(classe=e.classe).values_list("id", flat=True))
        notes = Note.objects.filter(eleve_id__in=ids_eleves, matiere=e.matiere, periode__annee_scolaire=annee)
        par_eleve = {}
        for n in notes:
            par_eleve.setdefault(n.eleve_id, []).append(n)
        moyennes = [m for m in (_moyenne_ponderee(v) for v in par_eleve.values()) if m is not None]
        bareme = e.classe.bareme
        moyenne_classe = round(sum(moyennes) / len(moyennes), 2) if moyennes else None
        reussis = sum(1 for m in moyennes if m >= Decimal(bareme) / 2)
        if moyennes:
            moyennes_20 += [_sur_20(m, bareme) for m in moyennes]
            reussites += reussis
            effectif_total += len(moyennes)
        chapitres = ChapitreProgramme.objects.filter(classe=e.classe, matiere=e.matiere)
        total_ch = chapitres.count()
        detail_classes.append({
            "classe": e.classe.nom, "matiere": e.matiere.nom, "bareme": bareme,
            "moyenne": moyenne_classe, "taux_reussite": _pourcentage(reussis, len(moyennes)),
            "eleves_notes": len(moyennes),
            "programme": _pourcentage(chapitres.filter(statut=ChapitreProgramme.Statut.TERMINE).count(), total_ch),
        })

    # Évaluations données et notes saisies par l'enseignant.
    notes_saisies = Note.objects.filter(enseignant=user, periode__annee_scolaire=annee)
    evaluations = notes_saisies.values("matiere", "date", "type_evaluation").distinct().count()

    jours = len(pointages)
    return {
        "enseignant_id": enseignant.id,
        "nom_complet": user.get_full_name() or user.username,
        "matricule": enseignant.matricule,
        "specialite": enseignant.specialite,
        "annee_scolaire": annee.libelle,
        "annee_scolaire_id": annee.id,
        "classes": sorted({e.classe.nom for e in enseignements}),
        "presence": {
            "jours_pointes": jours, "presents": presents, "retards": retards, "absents": absents,
            "taux_presence": _pourcentage(presents + retards, jours),
            "taux_ponctualite": _pourcentage(presents, presents + retards),
        },
        "volume": {"heures_hebdo_prevues": round(heures_hebdo, 1), "heures_pointees": round(heures_pointees, 1)},
        "programme": {
            "chapitres": chapitres_total, "termines": chapitres_termines,
            "pourcentage": _pourcentage(chapitres_termines, chapitres_total),
        },
        "resultats": {
            "moyenne_sur_20": round(sum(moyennes_20) / len(moyennes_20), 2) if moyennes_20 else None,
            "taux_reussite": _pourcentage(reussites, effectif_total),
            "eleves_notes": effectif_total,
        },
        "evaluations": {"evaluations_donnees": evaluations, "notes_saisies": notes_saisies.count()},
        "detail_classes": detail_classes,
    }
