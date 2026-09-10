"""Registre des fonctionnalités optionnelles qu'un Super Admin peut désactiver, école par
école, depuis la fiche établissement (`Ecole.fonctionnalites_desactivees`, une liste de clés
de ce dict). Backend (`tenants.permissions.fonctionnalite_requise`) et frontend s'appuient
tous les deux sur ce même registre pour rester synchronisés — toute nouvelle clé ajoutée ici
doit avoir sa contrepartie ajoutée aux `permission_classes` du ou des ViewSet concernés (voir
les usages de `fonctionnalite_requise` dans transport/cantine/library/messaging/announcements
/attendance/people/views.py)."""

FONCTIONNALITES = {
    "transport": "Transport scolaire",
    "cantine": "Cantine",
    "bibliotheque": "Bibliothèque",
    "messagerie": "Messagerie interne",
    "assistant_ia": "Assistant IA élève",
    "justificatifs": "Justificatifs d'absence",
    "groupes_revision": "Groupes de révision",
    "annonces": "Annonces internes",
    "visioconference": "Visioconférence",
}
