"""Rappels de paiement — envoyés aux parents (ou à l'élève à défaut) dont un ou plusieurs
frais sont en retard de règlement. Réutilisé par la commande planifiée `notifier_impayes`
(toutes écoles) et par l'action manuelle `FraisViewSet.notifier_impayes` (une école, à la demande
de son admin/comptabilité)."""

from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.mail import send_mail

from people.models import AlerteParent
from people.sms import send_sms
from tenants.messages_templates import rendre_modele

from .models import Frais

# On évite de relancer plus d'une fois par semaine la même famille, même si plusieurs
# frais distincts sont en retard (regroupés dans un seul message).
DELAI_RELANCE_JOURS = 7


def notifier_frais_impayes(ecole_id: int | None = None) -> int:
    """Envoie les rappels et renvoie le nombre de familles notifiées.
    `ecole_id=None` traite toutes les écoles (usage : tâche planifiée journalière)."""
    frais_qs = Frais.objects.select_related(
        "eleve__user", "eleve__parent", "type_frais"
    ).filter(date_echeance__lt=date.today())
    if ecole_id is not None:
        frais_qs = frais_qs.filter(eleve__user__ecole_id=ecole_id)

    par_eleve: dict[int, dict] = {}
    for frais in frais_qs:
        if frais.solde <= 0:
            continue
        par_eleve.setdefault(frais.eleve_id, {"eleve": frais.eleve, "frais": []})["frais"].append(frais)

    seuil = date.today() - timedelta(days=DELAI_RELANCE_JOURS)
    nb_notifies = 0
    for data in par_eleve.values():
        eleve = data["eleve"]
        if AlerteParent.objects.filter(eleve=eleve, type="frais_impaye", cree_le__gte=seuil).exists():
            continue

        destinataire = eleve.parent or eleve.user
        total_solde = sum((f.solde for f in data["frais"]), Decimal("0"))
        libelle_frais = ", ".join(sorted({f.type_frais.nom for f in data["frais"]}))
        ecole = eleve.user.ecole if eleve.user.ecole_id else None
        sujet, message = rendre_modele(
            ecole, "mensualite_impayee",
            nom_complet=eleve.user.get_full_name(),
            montant=f"{total_solde} GNF", frais=libelle_frais,
        )

        email_ok = False
        if destinataire.email:
            try:
                # `send_mail(..., fail_silently=True)` avale l'exception ET renvoie 0 (pas
                # d'exception levée) en cas d'échec (SMTP down, identifiants invalides...) — sans
                # vérifier ce retour, `email_ok` passait à `True` même quand rien n'était parti,
                # ce qui pouvait empêcher tout renvoi ultérieur (voir le compteur `nb_notifies` /
                # le garde-fou `AlerteParent` ci-dessous, qui se fient à `email_ok`).
                nb_envoyes = send_mail(
                    subject=sujet,
                    message=message,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[destinataire.email],
                    fail_silently=True,
                )
                email_ok = nb_envoyes > 0
            except Exception:  # noqa: BLE001 — un échec d'email ne doit pas bloquer les autres familles
                pass
        sms_ok = send_sms(destinataire.phone, message) if destinataire.phone else False

        if email_ok or sms_ok:
            AlerteParent.objects.create(
                parent=destinataire, eleve=eleve, type="frais_impaye",
                message=message, sms_envoye=sms_ok,
            )
            nb_notifies += 1
    return nb_notifies
