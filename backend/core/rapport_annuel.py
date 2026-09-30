"""Rapport annuel d'une école pour une année scolaire — statistiques calculées à partir des données
de la plateforme, puis mises en page dans un PDF prêt à imprimer (core/templates/core/
rapport_annuel_pdf.html).

Généré automatiquement à la fin de chaque année scolaire (commande `generer_rapports_annuels`,
planifiée chaque jour) et à la demande depuis la page « Rapports annuels ».
"""

from datetime import date
from decimal import Decimal
from io import BytesIO

from django.db.models import Count, Q, Sum
from django.template.loader import render_to_string


def _pct(part, total):
    return round(part * 100 / total, 1) if total else None


def _moyenne(valeurs):
    valeurs = [v for v in valeurs if v is not None]
    return round(sum(valeurs) / len(valeurs), 2) if valeurs else None


def _eleves_de_l_annee(annee):
    from academics.models import Classe
    from people.models import EleveProfile, HistoriqueClasse

    classes = Classe.objects.filter(annee_scolaire=annee)
    ids = set(HistoriqueClasse.objects.filter(classe__in=classes).values_list("eleve_id", flat=True))
    ids |= set(EleveProfile.objects.filter(classe__in=classes).values_list("id", flat=True))
    return EleveProfile.objects.filter(id__in=ids).select_related("user")


def _resultats_classes(annee, periodes):
    """Résultats de chaque classe (et du total) sur les périodes données — moyennes ramenées sur
    20 pour comparer primaire (sur 10) et collège/lycée (sur 20)."""
    from academics.models import Classe
    from grades.views import _class_results, _sur_20

    lignes, admis, notes, moyennes_20 = [], 0, 0, []
    for classe in Classe.objects.filter(annee_scolaire=annee).order_by("niveau", "nom"):
        resultats = _class_results(classe, periodes) if periodes else []
        valides = [r for r in resultats if r["moyenne_generale"] is not None]
        nb_admis = sum(1 for r in valides if r["decision"] == "admis")
        moyenne = _moyenne([r["moyenne_generale"] for r in valides])
        lignes.append({
            "classe": classe.nom, "niveau": classe.niveau, "bareme": classe.bareme,
            "effectif": len(resultats), "eleves_notes": len(valides), "moyenne": moyenne,
            "admis": nb_admis,
            "repeches": sum(1 for r in valides if r["decision"] == "repeche"),
            "redoublants": sum(1 for r in valides if r["decision"] == "redouble"),
            "taux_reussite": _pct(nb_admis, len(valides)),
        })
        admis += nb_admis
        notes += len(valides)
        moyennes_20 += [_sur_20(r["moyenne_generale"], classe.bareme) for r in valides]
    return lignes, {"admis": admis, "eleves_notes": notes, "taux_reussite": _pct(admis, notes), "moyenne_sur_20": _moyenne(moyennes_20)}


def _resume_resultats(annee):
    from grades.models import Periode

    periodes = list(Periode.objects.filter(annee_scolaire=annee))
    _lignes, total = _resultats_classes(annee, periodes)
    return total


def calculer_rapport(ecole, annee) -> dict:
    from academics.models import AnneeScolaire, Classe, Matiere
    from attendance.models import Presence
    from core.models import DocumentOfficiel
    from grades.models import Note, Periode
    from payments.models import Depense, Frais, Paiement
    from people.evaluation_enseignants import evaluer_enseignant
    from people.models import EleveProfile, EnseignantProfile, PaieEnseignant, RendezVous

    debut, fin = annee.date_debut, annee.date_fin
    periodes = list(Periode.objects.filter(annee_scolaire=annee).order_by("date_debut"))
    classes = Classe.objects.filter(annee_scolaire=annee)

    # --- Élèves ---------------------------------------------------------------------------
    eleves = _eleves_de_l_annee(annee)
    effectif = eleves.count()
    eleves_stats = {
        "total": effectif,
        "filles": eleves.filter(user__sexe="F").count(),
        "garcons": eleves.filter(user__sexe="M").count(),
        "nouveaux": eleves.filter(statut_inscription=EleveProfile.StatutInscription.NOUVEAU).count(),
        "reinscrits": eleves.filter(statut_inscription=EleveProfile.StatutInscription.REINSCRIPTION).count(),
        "sortis": eleves.filter(actif=False, date_sortie__gte=debut, date_sortie__lte=fin).count(),
    }

    # --- Résultats (année) et évolution (période par période, puis vs année précédente) -----
    lignes_classes, total_resultats = _resultats_classes(annee, periodes)
    evolution = []
    for p in periodes:
        _l, t = _resultats_classes(annee, [p])
        evolution.append({"periode": p.nom, "moyenne_sur_20": t["moyenne_sur_20"], "taux_reussite": t["taux_reussite"]})
    precedente = AnneeScolaire.objects.filter(ecole=ecole, date_fin__lt=debut).order_by("-date_fin").first()
    annee_precedente = None
    if precedente:
        resume = _resume_resultats(precedente)
        annee_precedente = {
            "libelle": precedente.libelle, "effectif": _eleves_de_l_annee(precedente).count(), **resume,
        }

    # --- Absences ---------------------------------------------------------------------------
    presences = Presence.objects.filter(eleve__in=eleves, date__gte=debut, date__lte=fin)
    agregat = presences.aggregate(
        total=Count("id"),
        absents=Count("id", filter=Q(statut=Presence.Statut.ABSENT)),
        retards=Count("id", filter=Q(statut=Presence.Statut.RETARD)),
        justifiees=Count("id", filter=Q(statut=Presence.Statut.ABSENT, justifie=True)),
    )
    absences = {**agregat, "taux_absence": _pct(agregat["absents"], agregat["total"]), "taux_retard": _pct(agregat["retards"], agregat["total"])}
    absences_par_classe = {
        l["eleve__classe__nom"]: _pct(l["abs"], l["tot"])
        for l in presences.values("eleve__classe__nom").annotate(tot=Count("id"), abs=Count("id", filter=Q(statut=Presence.Statut.ABSENT)))
    }
    for ligne in lignes_classes:
        ligne["taux_absence"] = absences_par_classe.get(ligne["classe"])

    # --- Finances ---------------------------------------------------------------------------
    frais = list(Frais.objects.filter(annee_scolaire=annee, eleve__user__ecole=ecole).select_related("type_frais", "eleve"))
    paiements = Paiement.objects.filter(frais__in=frais)
    recettes_total = paiements.aggregate(t=Sum("montant"))["t"] or Decimal("0")
    recettes_par_type = [
        {"libelle": l["frais__type_frais__nom"], "montant": l["total"]}
        for l in paiements.values("frais__type_frais__nom").annotate(total=Sum("montant")).order_by("-total")
    ]
    montant_du = sum((f.montant_du for f in frais), Decimal("0"))
    impayes = max(montant_du - recettes_total, Decimal("0"))

    depenses = Depense.objects.filter(ecole=ecole, date__gte=debut, date__lte=fin)
    depenses_par_categorie = [
        {"libelle": l["categorie__nom"], "montant": l["total"]}
        for l in depenses.values("categorie__nom").annotate(total=Sum("montant")).order_by("-total")
    ]
    depenses_total = depenses.aggregate(t=Sum("montant"))["t"] or Decimal("0")
    salaires = sum(
        (p.net_a_payer for p in PaieEnseignant.objects.filter(
            enseignant__user__ecole=ecole, mois__gte=debut.replace(day=1), mois__lte=fin, payee=True,
        )),
        Decimal("0"),
    )
    if salaires:
        depenses_par_categorie.append({"libelle": "Salaires enseignants", "montant": salaires})
    finances = {
        "recettes": recettes_total, "recettes_par_type": recettes_par_type,
        "montant_du": montant_du, "impayes": impayes, "taux_recouvrement": _pct(recettes_total, montant_du),
        "depenses": depenses_total + salaires, "depenses_par_categorie": depenses_par_categorie,
        "solde": recettes_total - depenses_total - salaires,
    }

    # --- Enseignants --------------------------------------------------------------------------
    enseignants = [
        evaluer_enseignant(e, annee)
        for e in EnseignantProfile.objects.filter(user__ecole=ecole).select_related("user")
    ]
    enseignants = sorted((e for e in enseignants if e["classes"]), key=lambda e: e["nom_complet"].lower())

    # --- Statistiques générales -----------------------------------------------------------
    notes = Note.objects.filter(periode__annee_scolaire=annee)
    statistiques = {
        "classes": classes.count(),
        "matieres": Matiere.objects.filter(ecole=ecole).count(),
        "enseignants": len(enseignants),
        "periodes": len(periodes),
        "notes_saisies": notes.count(),
        "evaluations": notes.values("matiere", "date", "type_evaluation", "eleve__classe").distinct().count(),
        "bulletins_emis": DocumentOfficiel.objects.filter(ecole=ecole, type=DocumentOfficiel.Type.BULLETIN, donnees__annee_scolaire=annee.libelle).count(),
        "rendez_vous": RendezVous.objects.filter(ecole=ecole, date__gte=debut, date__lte=fin).count(),
        "eleves_par_classe": round(effectif / classes.count(), 1) if classes.count() else None,
    }

    return {
        "ecole": ecole, "annee": annee, "provisoire": fin >= date.today(), "date_generation": date.today(),
        "eleves": eleves_stats, "resultats": total_resultats, "classes": lignes_classes, "evolution": evolution,
        "annee_precedente": annee_precedente, "absences": absences, "finances": finances,
        "enseignants": enseignants, "statistiques": statistiques,
    }


def rapport_pdf(ecole, annee) -> bytes:
    from xhtml2pdf import pisa

    from people.views import _image_data_uri, _mm_px

    contexte = calculer_rapport(ecole, annee)
    contexte["logo_data_uri"] = _image_data_uri(ecole.logo, _mm_px(20, 20), mode="contain") if ecole.logo else None
    contexte["couleur_principale"] = ecole.couleur_principale
    contexte["couleur_secondaire"] = ecole.couleur_secondaire
    # Largeur des barres (mm) de l'évolution des résultats, proportionnelle à la moyenne.
    for e in contexte["evolution"]:
        e["barre_mm"] = round(float(e["moyenne_sur_20"] or 0) * 3)
    html = render_to_string("core/rapport_annuel_pdf.html", contexte)
    tampon = BytesIO()
    pisa.CreatePDF(html, dest=tampon, encoding="utf-8")
    return tampon.getvalue()


def generer_et_enregistrer(ecole, annee, automatique=False):
    """Génère le PDF et l'archive (remplace le précédent pour cette année). Renvoie le
    RapportAnnuel."""
    from django.core.files.base import ContentFile
    from django.utils.text import slugify

    from .models import RapportAnnuel

    contenu = rapport_pdf(ecole, annee)
    rapport, _cree = RapportAnnuel.objects.get_or_create(ecole=ecole, annee_scolaire=annee)
    if rapport.fichier:
        rapport.fichier.delete(save=False)
    rapport.automatique = automatique
    rapport.provisoire = annee.date_fin >= date.today()
    rapport.fichier.save(f"rapport_annuel_{slugify(ecole.nom)}_{annee.libelle}.pdf", ContentFile(contenu), save=False)
    rapport.save()
    return rapport
