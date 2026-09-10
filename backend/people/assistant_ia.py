"""Cerveau de l'assistant IA élève.

Tant qu'aucune clé API Anthropic n'est configurée côté serveur (`ANTHROPIC_API_KEY`), les
réponses sont simulées — mais construites à partir des vraies données scolaires de l'élève
(matières en difficulté, moyenne générale), pour rester utiles en attendant. Dès qu'une clé
est ajoutée (et le paquet `anthropic` installé), les mêmes questions sont relayées à Claude
avec ce contexte scolaire injecté comme prompt système : aucun changement côté frontend/DB.
"""

from django.conf import settings


def _contexte_scolaire(eleve) -> str:
    """Résumé des points faibles/forts de l'élève sur l'année active. Import différé des
    modèles de l'app `grades` pour éviter un cycle (grades.models importe déjà people.models)."""
    from academics.models import AnneeScolaire
    from grades.models import Periode
    from grades.views import _matieres_moyennes, _moyenne_generale

    if not eleve.user.ecole_id:
        return "Aucune donnée scolaire disponible pour le moment."

    annee = AnneeScolaire.objects.filter(ecole_id=eleve.user.ecole_id, active=True).first()
    periodes = list(Periode.objects.filter(annee_scolaire=annee)) if annee else []
    if not periodes:
        return "Aucune donnée scolaire disponible pour le moment."

    matieres_moy = _matieres_moyennes(eleve, periodes)
    if not matieres_moy:
        return "Aucune note enregistrée pour le moment."

    moyenne_generale = _moyenne_generale(matieres_moy)
    faibles = sorted(
        ((m.nom, moy) for m, (moy, _notes) in matieres_moy.items() if moy is not None and moy < 10),
        key=lambda x: x[1],
    )
    lignes = [f"Moyenne générale : {moyenne_generale if moyenne_generale is not None else '—'}/20."]
    if faibles:
        lignes.append("Matières en difficulté : " + ", ".join(f"{nom} ({moy}/20)" for nom, moy in faibles) + ".")
    else:
        lignes.append("Aucune matière en dessous de la moyenne actuellement — beau travail !")
    return " ".join(lignes)


SYSTEM_PROMPT_TEMPLATE = (
    "Tu es un assistant pédagogique bienveillant pour {nom}, élève de {classe}. "
    "Contexte scolaire actuel : {contexte} "
    "Aide-le à comprendre ses cours, propose des méthodes de travail concrètes et encourage-le, "
    "en particulier sur ses matières en difficulté. Réponds en français, simplement, positivement, "
    "en quelques phrases."
)


def repondre(eleve, message: str) -> str:
    api_key = getattr(settings, "ANTHROPIC_API_KEY", "")
    contexte = _contexte_scolaire(eleve)

    if api_key:
        try:
            return _repondre_avec_claude(eleve, message, contexte, api_key)
        except Exception:
            pass  # on retombe sur la réponse simulée plutôt que de faire échouer la requête de l'élève

    return _repondre_simulee(eleve, message, contexte)


def _repondre_avec_claude(eleve, message: str, contexte: str, api_key: str) -> str:
    import anthropic  # importé seulement si une clé est configurée (paquet optionnel)

    client = anthropic.Anthropic(api_key=api_key)
    system = SYSTEM_PROMPT_TEMPLATE.format(
        nom=eleve.user.first_name or "l'élève",
        classe=eleve.classe.nom if eleve.classe else "sa classe",
        contexte=contexte,
    )
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=500,
        system=system,
        messages=[{"role": "user", "content": message}],
    )
    return "".join(block.text for block in response.content if hasattr(block, "text")).strip()


def _repondre_simulee(eleve, message: str, contexte: str) -> str:
    prenom = eleve.user.first_name or "champion"
    return (
        "🤖 (mode démo — aucune IA réelle n'est encore connectée par ton établissement)\n\n"
        f"Salut {prenom} ! Voici ce que je vois dans ton dossier : {contexte}\n\n"
        "Dis-moi sur quelle matière ou quel exercice tu bloques : dès qu'un assistant IA complet "
        "sera activé, je pourrai t'expliquer le cours et te proposer des exercices ciblés."
    )
