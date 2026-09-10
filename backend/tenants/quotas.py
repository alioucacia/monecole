"""Vérification des limites d'un plan d'abonnement (élèves/enseignants/administrateurs).

Utilisé par les serializers de création de compte (people, accounts) — jamais par les
modèles eux-mêmes, pour ne pas faire dépendre `tenants.models` de DRF ni des apps qui
comptent leurs propres utilisateurs (évite tout import circulaire)."""

from rest_framework import serializers


def verifier_quota_plan(ecole, limite_attr: str, count_actuel: int, label: str) -> None:
    """Lève une ValidationError DRF si l'école a atteint la limite de son plan pour ce
    champ (`limite_eleves`, `limite_enseignants` ou `limite_administrateurs`).
    Ne fait rien si l'école n'a pas de plan, ou si le champ n'a pas de limite (illimité)."""
    if not ecole or not ecole.plan_id:
        return
    limite = getattr(ecole.plan, limite_attr, None)
    if limite is not None and count_actuel >= limite:
        raise serializers.ValidationError(
            f"Quota atteint : le plan « {ecole.plan.nom} » de votre établissement "
            f"autorise au maximum {limite} {label}. Contactez l'administrateur de la "
            f"plateforme pour changer de plan."
        )
