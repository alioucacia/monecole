"""Réinitialisation complète d'une école par le Super Admin (« repartir à zéro »).

Efface TOUTES les données de l'établissement — élèves, parents, enseignants et autres comptes du
personnel, classes, années scolaires, notes, présences, frais, paiements, dépenses, matières,
annonces, bibliothèque, transport, cantine, visioconférences, modèles de messages — et remet ses
réglages (couleurs, modèles de documents, en-têtes, fonctionnalités, paramètres) à leurs valeurs
par défaut.

Conservé : l'école elle-même (nom, adresse, contact, logo, plan, abonnement, statut), ses comptes
Administrateur (pour pouvoir se reconnecter et tout reconfigurer), l'historique de facturation de
la plateforme (paiements et transactions d'abonnement), les tickets de support et le journal
d'activité de la plateforme.

Tout se fait dans UNE transaction : si une étape échoue, rien n'est effacé.
"""

from django.db import transaction

from accounts.models import User

# Réglages de l'école remis à leur valeur par défaut (identité et abonnement non touchés).
CHAMPS_REGLAGES_ECOLE = [
    "couleur_principale", "couleur_secondaire",
    "modele_recu", "modele_badge", "modele_bulletin", "modele_fiche_inscription", "modele_certificat",
    "ire", "dpe", "dsee",
    "entete_ministere_1", "entete_ministere_2", "entete_republique", "entete_devise",
    "fonctionnalites_desactivees",
    "signataire_comptable", "signataire_comptable_nom", "signataire_caissier", "signataire_caissier_nom",
    "signataire_fondateur",
]


def _valeur_par_defaut(modele, champ: str):
    field = modele._meta.get_field(champ)
    return field.get_default()


@transaction.atomic
def reinitialiser_ecole(ecole) -> dict:
    """Efface les données de `ecole` et remet ses réglages par défaut. Renvoie le nombre
    d'éléments supprimés par catégorie (pour le compte-rendu affiché au Super Admin)."""
    from academics.models import AnneeScolaire, Matiere
    from announcements.models import Annonce
    from cantine.models import Formule
    from library.models import Livre
    from payments.models import CategorieDepense, Depense, Frais, TarifClasse, TypeFrais, creer_categories_depense_par_defaut
    from tenants.models import ModeleMessage, ParametresEcole
    from transport.models import Trajet
    from visio.models import Reunion

    bilan = {}

    # 1. Comptes (sauf administrateurs) : entraîne en cascade fiches élèves/enseignants, notes,
    #    présences, frais et paiements des élèves, badges, messages, paies, pointages...
    comptes = User.objects.filter(ecole=ecole).exclude(role=User.Role.ADMIN)
    bilan["comptes"] = comptes.count()
    bilan["eleves"] = comptes.filter(role=User.Role.STUDENT).count()
    # Les frais (liés à un type de frais PROTÉGÉ) partent d'abord, avec leurs paiements.
    Frais.objects.filter(eleve__user__ecole=ecole).delete()
    comptes.delete()

    # 2. Structure pédagogique : années scolaires (classes, périodes, emplois du temps...) et
    #    matières.
    bilan["annees_scolaires"] = AnneeScolaire.objects.filter(ecole=ecole).count()
    AnneeScolaire.objects.filter(ecole=ecole).delete()
    Matiere.objects.filter(ecole=ecole).delete()

    # 3. Finances : tarifs, types de frais, dépenses (avant leurs catégories, protégées).
    TarifClasse.objects.filter(ecole=ecole).delete()
    TypeFrais.objects.filter(ecole=ecole).delete()
    bilan["depenses"] = Depense.objects.filter(ecole=ecole).count()
    Depense.objects.filter(ecole=ecole).delete()
    CategorieDepense.objects.filter(ecole=ecole).delete()

    # 4. Modules : annonces, bibliothèque, transport, cantine, visioconférence, modèles de messages.
    for modele in (Annonce, Livre, Trajet, Formule, Reunion, ModeleMessage):
        modele.objects.filter(ecole=ecole).delete()

    # 5. Réglages remis par défaut.
    for champ in CHAMPS_REGLAGES_ECOLE:
        setattr(ecole, champ, _valeur_par_defaut(type(ecole), champ))
    ecole.save()
    ParametresEcole.objects.filter(ecole=ecole).delete()
    ParametresEcole.objects.create(ecole=ecole)
    # Catégories de dépense de départ, comme à la création d'une école.
    creer_categories_depense_par_defaut(sender=type(ecole), instance=ecole, created=True)

    return bilan
