"""Rappels de paiement — envoyés aux parents (ou à l'élève à défaut) dont un ou plusieurs
frais sont en retard de règlement. Réutilisé par la commande planifiée `notifier_impayes`
(toutes écoles) et par l'action manuelle `FraisViewSet.notifier_impayes` (une école, à la demande
de son admin/comptabilité)."""

from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from people.models import AlerteParent
from people.sms import send_sms, sms_eleves_parents_autorise
from tenants.messages_templates import rendre_modele

from .models import Frais

# La tâche planifiée (quotidienne) ne relance pas plus d'une fois par semaine la même famille.
# Le bouton « Relancer » de l'admin, lui, envoie à chaque clic (`forcer=True`) : sinon une famille
# déjà relancée le matin même par la tâche était ignorée et « rien ne partait ».
DELAI_RELANCE_JOURS = 7

MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]

# Voir AlerteParent.message (max_length=320) — au-delà, l'enregistrement échouait en base et
# faisait planter toute la relance.
LONGUEUR_MAX_ALERTE = 320


def _format_montant(montant: Decimal) -> str:
    return f"{montant:,.0f}".replace(",", " ")


def _impayes_par_eleve(ecole_id: int | None) -> dict[int, dict]:
    """{eleve_id: {"eleve", "lignes": [(libellé, reste)]}} — ce que chaque élève actif doit à ce jour :
    - frais mensuels : chaque mois échu (mois en cours compris) non soldé, d'après le même calcul
      que la page Suivi mensuel — y compris un mois dont le frais n'a pas encore été créé ;
    - autres frais (inscription, cantine, tranche…) : ceux dont l'échéance est passée et le solde > 0."""
    from .views import _calculer_suivi_mensuel

    aujourdhui = date.today()
    frais_qs = Frais.objects.select_related(
        "eleve__user__ecole", "eleve__parent", "type_frais", "annee_scolaire",
    ).filter(eleve__actif=True)
    if ecole_id is not None:
        frais_qs = frais_qs.filter(eleve__user__ecole_id=ecole_id)

    impayes: dict[int, dict] = {}

    def ajouter(eleve, libelle, reste):
        impayes.setdefault(eleve.id, {"eleve": eleve, "lignes": []})["lignes"].append((libelle, reste))

    suivis = {}
    for frais in frais_qs:
        if frais.type_frais.est_mensuel:
            suivis.setdefault((frais.eleve_id, frais.annee_scolaire_id), (frais.eleve, frais.annee_scolaire, set()))[2].add(
                frais.type_frais.nom
            )
        elif frais.date_echeance <= aujourdhui and frais.solde > 0:
            ajouter(frais.eleve, frais.type_frais.nom, frais.solde)

    for eleve, annee, noms_types in suivis.values():
        mois_dus = [m for m in _calculer_suivi_mensuel(eleve, annee) if not m["a_venir"] and m["reste"] > 0]
        if mois_dus:
            libelles = ", ".join(
                f"{MOIS_COURTS[int(m['mois'][5:7]) - 1]} {m['mois'][:4]}" for m in mois_dus
            )
            ajouter(eleve, f"{' / '.join(sorted(noms_types))} ({libelles})", sum((m["reste"] for m in mois_dus), Decimal("0")))
    return impayes


def notifier_frais_impayes(ecole_id: int | None = None, forcer: bool = False) -> dict:
    """Envoie les rappels (SMS + e-mail) et renvoie un compte-rendu :
    `notifies` (familles jointes par au moins un canal), `sms_envoyes`, `sms_echecs`,
    `emails_envoyes`, `sans_contact` (ni téléphone ni e-mail — noms dans `sans_contact_noms`),
    `deja_relances` (ignorées : relancées il y a moins de 7 jours, hors `forcer`),
    `sms_desactives` (SMS coupés pour l'école par le Super Admin ou la plateforme).
    `ecole_id=None` traite toutes les écoles (usage : tâche planifiée journalière)."""
    from tenants.models import ParametresPlateforme

    sms_plateforme = ParametresPlateforme.charger().sms_actif
    seuil = timezone.now() - timedelta(days=DELAI_RELANCE_JOURS)
    bilan = {
        "notifies": 0, "familles_en_retard": 0, "sms_envoyes": 0, "sms_echecs": 0, "emails_envoyes": 0,
        "sans_contact": 0, "sans_contact_noms": [], "deja_relances": 0, "sms_desactives": False,
    }

    for data in _impayes_par_eleve(ecole_id).values():
        eleve = data["eleve"]
        bilan["familles_en_retard"] += 1
        if not forcer and AlerteParent.objects.filter(eleve=eleve, type="frais_impaye", cree_le__gte=seuil).exists():
            bilan["deja_relances"] += 1
            continue

        parent = eleve.parent if eleve.parent_id and eleve.parent.is_active else None
        destinataire = parent or eleve.user
        # Numéro/e-mail du parent, sinon ceux de l'élève : un parent sans numéro enregistré ne doit
        # pas empêcher de joindre la famille si l'élève en a un.
        telephone = (parent.phone if parent else "") or eleve.user.phone
        email = (parent.email if parent else "") or eleve.user.email

        total = sum((reste for _libelle, reste in data["lignes"]), Decimal("0"))
        ecole = eleve.user.ecole if eleve.user.ecole_id else None
        sujet, message = rendre_modele(
            ecole, "mensualite_impayee",
            nom_complet=eleve.user.get_full_name(),
            montant=_format_montant(total),
            frais="; ".join(libelle for libelle, _reste in data["lignes"]),
        )

        email_ok = False
        if email:
            try:
                # `fail_silently=True` renvoie 0 (sans lever) en cas d'échec : on vérifie ce retour.
                email_ok = send_mail(
                    subject=sujet, message=message, from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[email], fail_silently=True,
                ) > 0
            except Exception:  # noqa: BLE001 — un échec d'email ne doit pas bloquer les autres familles
                email_ok = False
        if email_ok:
            bilan["emails_envoyes"] += 1

        sms_ok = False
        if telephone:
            if not sms_plateforme or not sms_eleves_parents_autorise(ecole):
                bilan["sms_desactives"] = True
            elif send_sms(telephone, message):
                sms_ok = True
                bilan["sms_envoyes"] += 1
            else:
                bilan["sms_echecs"] += 1

        if not telephone and not email:
            bilan["sans_contact"] += 1
            if len(bilan["sans_contact_noms"]) < 10:
                bilan["sans_contact_noms"].append(eleve.user.get_full_name())

        if email_ok or sms_ok:
            AlerteParent.objects.create(
                parent=destinataire, eleve=eleve, type="frais_impaye",
                message=message[:LONGUEUR_MAX_ALERTE], sms_envoye=sms_ok,
            )
            bilan["notifies"] += 1
    return bilan
