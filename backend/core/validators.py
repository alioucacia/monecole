"""Validateurs de fichiers uploadés, partagés entre apps — centralisés ici pour que chaque
nouveau champ fichier/image (pièce jointe, photo, justificatif...) applique la même limite de
taille et la même liste d'extensions autorisées, au lieu de réinventer la vérification (ou de
l'oublier) à chaque nouveau serializer. Utilisation typique dans un serializer :

    from core.validators import valider_taille_fichier, EXTENSIONS_IMAGE

    class MonSerializer(serializers.ModelSerializer):
        class Meta:
            ...
        def validate_photo(self, fichier):
            return valider_taille_fichier(fichier, extensions_autorisees=EXTENSIONS_IMAGE)
"""

from rest_framework import serializers

TAILLE_MAX_IMAGE = 8 * 1024 * 1024  # 8 Mo — photos (avatar, pièce jointe image)
TAILLE_MAX_DOCUMENT = 15 * 1024 * 1024  # 15 Mo — pièces jointes générales (justificatif, ticket, dépense)

EXTENSIONS_IMAGE = ["jpg", "jpeg", "png", "webp"]
EXTENSIONS_DOCUMENT = ["pdf", "jpg", "jpeg", "png", "webp", "doc", "docx"]


def valider_taille_fichier(fichier, taille_max=TAILLE_MAX_DOCUMENT, extensions_autorisees=None):
    """À appeler depuis un `validate_<champ>` de serializer. Lève une `ValidationError` DRF si le
    fichier dépasse `taille_max` octets, ou si son extension n'est pas dans `extensions_autorisees`
    (ignoré si `None`). Retourne le fichier inchangé sinon (pour `return valider_taille_fichier(...)`
    directement dans le `validate_<champ>`)."""
    if not fichier:
        return fichier
    if fichier.size > taille_max:
        taille_mo = taille_max / (1024 * 1024)
        raise serializers.ValidationError(f"Le fichier dépasse la taille maximale autorisée ({taille_mo:g} Mo).")
    if extensions_autorisees:
        extension = (fichier.name.rsplit(".", 1)[-1] if "." in fichier.name else "").lower()
        if extension not in extensions_autorisees:
            raise serializers.ValidationError(
                f"Type de fichier non autorisé — formats acceptés : {', '.join(extensions_autorisees)}."
            )
    return fichier
