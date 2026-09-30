from decimal import Decimal, InvalidOperation

from django import template

register = template.Library()


@register.filter
def montant(valeur):
    """Montant entier avec espaces entre les milliers : 1250000 -> « 1 250 000 »."""
    try:
        nombre = Decimal(str(valeur))
    except (InvalidOperation, TypeError, ValueError):
        return valeur
    return f"{nombre:,.0f}".replace(",", " ")
