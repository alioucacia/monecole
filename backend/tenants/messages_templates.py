"""Registre des modèles de message personnalisables par l'admin de chaque école (voir
`ModeleMessage`) : pour chaque clé, son libellé, les jetons `{entre_accolades}` qu'on peut y
utiliser (documentés ici pour que le frontend les affiche comme aide), son objet d'e-mail par
défaut et son texte par défaut — repris tel quel tant que l'admin ne personnalise rien, pour ne
rien changer au comportement (déjà en place, textes codés en dur) qui existait avant ce
registre.

`{nom_ecole}` est toujours disponible, quelle que soit la clé (ajouté automatiquement par
`rendre_modele` ci-dessous) — inutile de le lister dans chaque `jetons`."""

MODELES_MESSAGE = {
    "compte_cree": {
        "label": "Création de compte",
        "description": "Envoyé à l'élève (et à son parent) à la création du compte, avec les identifiants de connexion.",
        "jetons": ["{nom_complet}", "{identifiant}", "{mot_de_passe}"],
        "sujet_defaut": "{nom_ecole} — Votre compte a été créé",
        "contenu_defaut": (
            "{nom_ecole} : votre compte a été créé.\n"
            "Identifiant : {identifiant}\n"
            "Mot de passe temporaire : {mot_de_passe}\n"
            "Connectez-vous puis changez-le dès que possible."
        ),
    },
    "mensualite_impayee": {
        "label": "Mensualité / frais impayé",
        "description": "Rappel envoyé au parent (ou à l'élève à défaut) quand un frais est en retard de règlement.",
        "jetons": ["{nom_complet}", "{montant}", "{frais}"],
        "sujet_defaut": "{nom_ecole} — Rappel de paiement",
        "contenu_defaut": (
            "{nom_ecole} : {nom_complet} a un solde impayé de {montant} GNF ({frais}). "
            "Merci de régulariser rapidement."
        ),
    },
    "absence": {
        "label": "Absences répétées",
        "description": "Envoyé au parent quand un élève cumule 3 absences ou plus dans la même semaine.",
        "jetons": ["{nom_complet}", "{nombre_absences}", "{periode}"],
        "sujet_defaut": "{nom_ecole} — Absences répétées",
        "contenu_defaut": (
            "{nom_ecole} : {nom_complet} a été absent(e) {nombre_absences} fois cette semaine "
            "({periode}). Merci de nous contacter si besoin."
        ),
    },
    "reunion_parents": {
        "label": "Réunion des parents",
        "description": "Modèle de départ proposé dans « Nouvelle annonce » pour convoquer les parents à une réunion.",
        "jetons": [],
        "sujet_defaut": "{nom_ecole} — Réunion des parents",
        "contenu_defaut": "{nom_ecole} vous invite à une réunion des parents. Merci de votre présence.",
    },
    "classement_eleve": {
        "label": "Classement de l'élève",
        "description": "Envoyé à l'élève (et à son parent) avec son rang, sa moyenne et sa décision d'admission, depuis « Résultats ».",
        "jetons": ["{nom_complet}", "{periode}", "{rang}", "{effectif}", "{moyenne}", "{decision}"],
        "sujet_defaut": "{nom_ecole} — Résultats de {nom_complet}",
        "contenu_defaut": (
            "{nom_ecole} : résultats de {nom_complet} ({periode}).\n"
            "Rang : {rang}/{effectif} — Moyenne : {moyenne}/20 — {decision}."
        ),
    },
    "resultats_disponibles": {
        "label": "Résultats disponibles",
        "description": "Modèle de départ proposé dans « Nouvelle annonce » pour prévenir que les résultats/bulletins sont consultables.",
        "jetons": [],
        "sujet_defaut": "{nom_ecole} — Résultats disponibles",
        "contenu_defaut": "{nom_ecole} : les résultats sont maintenant disponibles. Connectez-vous à la plateforme pour les consulter.",
    },
}


def rendre_modele(ecole, cle: str, **jetons) -> tuple[str, str]:
    """Résout le modèle `cle` pour `ecole` (personnalisé s'il existe, sinon le texte par
    défaut du registre) et y substitue les `jetons` fournis. Retourne (sujet, contenu).

    Si le modèle personnalisé utilise un jeton qui n'a pas été fourni (faute de frappe de
    l'admin, ex: `{Nom_complet}` au lieu de `{nom_complet}`), on retombe sur le texte par
    défaut plutôt que de faire échouer tout l'envoi — mieux vaut un message générique
    correctement envoyé qu'aucun message du tout."""
    from .models import ModeleMessage

    info = MODELES_MESSAGE[cle]
    valeurs = {"nom_ecole": ecole.nom if ecole else "Taly-School", **jetons}

    modele = ModeleMessage.objects.filter(ecole=ecole, cle=cle).first() if ecole else None
    sujet = modele.sujet if modele and modele.sujet else info["sujet_defaut"]
    contenu = modele.contenu if modele and modele.contenu else info["contenu_defaut"]

    try:
        return sujet.format(**valeurs), contenu.format(**valeurs)
    except (KeyError, IndexError):
        return info["sujet_defaut"].format(**valeurs), info["contenu_defaut"].format(**valeurs)
