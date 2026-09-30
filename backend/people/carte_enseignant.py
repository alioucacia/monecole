"""Carte professionnelle des enseignants (portrait, carte PVC CR80 54 × 85,6 mm), dessinée en image
avec Pillow — même principe que `people.carte_eleve` (xhtml2pdf ne sait dessiner ni courbes ni
photo ronde), sur le modèle fourni par l'établissement :

- haut bleu marine (couleur principale de l'école) avec logo, nom de l'école en doré (couleur
  secondaire) et sous-titre encadré de deux traits ;
- bandes courbes blanche / dorée / bleu marine sous l'en-tête ;
- photo ronde cerclée de doré et de bleu marine ;
- nom en bleu marine, spécialité en doré, séparateur avec un point doré ;
- quatre lignes d'informations précédées d'une icône ronde (téléphone, e-mail, matricule,
  adresse de l'école) ;
- code-barres du matricule en bas, avec le numéro en clair.

Repère de référence 640 × 1015 (proportions de la carte), dessin à `ECHELLE` puis réduction.
"""

import base64
from io import BytesIO

from PIL import Image, ImageDraw, ImageOps

from .carte_eleve import ECHELLE, HAUTEUR, LARGEUR, SORTIE, _ajuster, _luminance, _melange, _ouvrir, _police, _rgb

BLANC = (255, 255, 255)


def _p(x, y):
    return (round(x * ECHELLE), round(y * ECHELLE))


def _couleurs(principale: str, secondaire: str) -> dict:
    marine = _rgb(principale, (20, 48, 79))
    while _luminance(marine) > 0.22:  # le haut doit rester sombre pour le texte blanc/doré
        marine = _melange(marine, (0, 0, 0), 0.25)
    dore = _rgb(secondaire, (184, 134, 11))
    return {"marine": marine, "dore": dore, "texte": _melange(marine, (0, 0, 0), 0.2), "gris": (90, 98, 112)}


# --- Fond ---------------------------------------------------------------------------------------

def _courbe(decalage: float) -> list[tuple[int, int]]:
    """Bord bas de l'en-tête : descend de la gauche jusque sous la photo puis remonte vers la
    droite, comme sur le modèle — `decalage` le translate vers le bas pour les bandes."""
    import math

    # Creux de la courbe au centre, sous la photo (x=320) : les bandes y passent derrière elle,
    # on ne les voit donc que sur les côtés, comme sur le modèle.
    points = []
    for i in range(0, 121):
        x = 640 * i / 120
        if x <= 320:
            y = 300 + (535 - 300) * math.sin((x / 320) * math.pi / 2) ** 1.3
        else:
            y = 535 - (535 - 285) * (1 - math.cos(((x - 320) / 320) * math.pi / 2)) ** 0.8
        points.append(_p(x, y + decalage))
    return points


def _zone_haute(decalage: float) -> list[tuple[int, int]]:
    return [_p(0, 0)] + _courbe(decalage) + [_p(640, 0)]


def _dessiner_fond(dessin: ImageDraw.ImageDraw, c: dict):
    # Des bandes les plus basses vers l'en-tête : chacune est la zone « au-dessus » d'une courbe
    # décalée, la suivante vient la recouvrir en ne laissant visible qu'une bande.
    dessin.polygon(_zone_haute(78), fill=c["marine"])
    dessin.polygon(_zone_haute(64), fill=BLANC)
    dessin.polygon(_zone_haute(52), fill=c["dore"])
    dessin.polygon(_zone_haute(30), fill=BLANC)
    dessin.polygon(_zone_haute(0), fill=c["marine"])


# --- Icônes (dessinées, pas de police d'icônes disponible) --------------------------------------

def _icone(dessin: ImageDraw.ImageDraw, genre: str, cx: float, cy: float, c: dict):
    r = 18
    dessin.ellipse([*_p(cx - r, cy - r), *_p(cx + r, cy + r)], fill=c["marine"])
    trait = max(2, round(2.2 * ECHELLE))
    if genre == "telephone":
        dessin.rounded_rectangle([*_p(cx - 6, cy - 10), *_p(cx + 6, cy + 10)], radius=2 * ECHELLE, outline=BLANC, width=trait)
        dessin.line([*_p(cx - 2, cy + 6), *_p(cx + 2, cy + 6)], fill=BLANC, width=trait)
    elif genre == "email":
        dessin.rectangle([*_p(cx - 10, cy - 7), *_p(cx + 10, cy + 7)], outline=BLANC, width=trait)
        dessin.line([*_p(cx - 10, cy - 7), *_p(cx, cy + 1), *_p(cx + 10, cy - 7)], fill=BLANC, width=trait)
    elif genre == "matricule":
        dessin.rounded_rectangle([*_p(cx - 11, cy - 8), *_p(cx + 11, cy + 8)], radius=2 * ECHELLE, outline=BLANC, width=trait)
        dessin.ellipse([*_p(cx - 7, cy - 4), *_p(cx - 1, cy + 2)], fill=BLANC)
        dessin.line([*_p(cx + 2, cy - 3), *_p(cx + 8, cy - 3)], fill=BLANC, width=trait)
        dessin.line([*_p(cx + 2, cy + 3), *_p(cx + 8, cy + 3)], fill=BLANC, width=trait)
    else:  # adresse : repère de carte
        dessin.polygon([_p(cx - 7, cy - 3), _p(cx + 7, cy - 3), _p(cx, cy + 11)], fill=c["dore"])
        dessin.ellipse([*_p(cx - 7, cy - 11), *_p(cx + 7, cy + 3)], fill=c["dore"])
        dessin.ellipse([*_p(cx - 2.5, cy - 6.5), *_p(cx + 2.5, cy - 1.5)], fill=c["marine"])


# --- Éléments -----------------------------------------------------------------------------------

def _texte_centre(dessin, texte, y, police, couleur, espacement=0.0):
    """Texte centré, avec un espacement optionnel entre les lettres (en unités de référence)."""
    if not espacement:
        largeur = dessin.textlength(texte, font=police)
        dessin.text(((LARGEUR * ECHELLE - largeur) / 2, y * ECHELLE), texte, font=police, fill=couleur)
        return largeur
    ecart = espacement * ECHELLE
    largeur = sum(dessin.textlength(ch, font=police) for ch in texte) + ecart * (len(texte) - 1)
    x = (LARGEUR * ECHELLE - largeur) / 2
    for ch in texte:
        dessin.text((x, y * ECHELLE), ch, font=police, fill=couleur)
        x += dessin.textlength(ch, font=police) + ecart
    return largeur


def _en_tete(carte: Image.Image, logo, nom_ecole: str, sous_titre: str, c: dict):
    dessin = ImageDraw.Draw(carte)
    cote = 104
    if logo is not None:
        logo = ImageOps.contain(logo, (cote * ECHELLE, cote * ECHELLE), Image.LANCZOS)
        carte.paste(logo, (round((LARGEUR * ECHELLE - logo.width) / 2), 22 * ECHELLE), logo)
    else:
        initiales = "".join(m[0] for m in nom_ecole.split()[:2]).upper() or "?"
        dessin.ellipse([*_p(320 - 46, 26), *_p(320 + 46, 118)], outline=c["dore"], width=4 * ECHELLE)
        dessin.text(_p(320, 72), initiales, font=_police(40), fill=c["dore"], anchor="mm")

    nom = nom_ecole.upper()
    police_nom = _ajuster(dessin, nom, 54, 580)
    dessin.text((LARGEUR * ECHELLE / 2, 142 * ECHELLE), nom, font=police_nom, fill=c["dore"], anchor="ma")

    # Sous-titre encadré de deux traits (« — CARTE PROFESSIONNELLE — »).
    police_st = _police(24, gras=False)
    largeur = _texte_centre(dessin, sous_titre.upper(), 212, police_st, BLANC, espacement=2.2)
    y_trait = round(226 * ECHELLE)
    milieu = LARGEUR * ECHELLE / 2
    for signe in (-1, 1):
        debut = milieu + signe * (largeur / 2 + 14 * ECHELLE)
        dessin.line([(debut, y_trait), (debut + signe * 46 * ECHELLE, y_trait)], fill=c["dore"], width=2 * ECHELLE)


def _photo(carte: Image.Image, photo, initiales: str, c: dict):
    cx, cy = 320, 472
    dessin = ImageDraw.Draw(carte)
    for rayon, couleur in ((158, c["dore"]), (154, BLANC), (150, c["marine"])):
        dessin.ellipse([*_p(cx - rayon, cy - rayon), *_p(cx + rayon, cy + rayon)], fill=couleur)
    r = 142
    d = 2 * r * ECHELLE
    if photo is not None:
        fond = Image.new("RGBA", photo.size, (255, 255, 255, 255))
        fond.alpha_composite(photo)
        rond = ImageOps.fit(fond, (d, d), Image.LANCZOS, centering=(0.5, 0.35))
    else:
        rond = Image.new("RGBA", (d, d), (241, 245, 249, 255))
        ImageDraw.Draw(rond).text((d / 2, d / 2), initiales or "?", font=_police(96), fill=c["marine"], anchor="mm")
    masque = Image.new("L", (d, d), 0)
    ImageDraw.Draw(masque).ellipse([0, 0, d, d], fill=255)
    carte.paste(rond, _p(cx - r, cy - r), masque)


def _code_barres(carte: Image.Image, valeur: str, c: dict):
    import barcode
    from barcode.writer import ImageWriter

    if not valeur:
        return
    dessin = ImageDraw.Draw(carte)
    tampon = BytesIO()
    barcode.get("code128", valeur, writer=ImageWriter()).write(
        tampon, options={"write_text": False, "module_height": 12.0, "quiet_zone": 0.5, "dpi": 600},
    )
    image = Image.open(tampon).convert("RGB")
    x0, y0, x1, y1 = 110, 918, 530, 966
    image = image.resize((round((x1 - x0) * ECHELLE), round((y1 - y0) * ECHELLE)), Image.NEAREST)
    carte.paste(image, _p(x0, y0))
    dessin.text((LARGEUR * ECHELLE / 2, 972 * ECHELLE), valeur, font=_police(17, gras=False), fill=c["texte"], anchor="ma")


# --- Carte --------------------------------------------------------------------------------------

def carte_enseignant_png(contexte: dict) -> bytes:
    """Image JPEG de la carte enseignant. Clés de `contexte` : nom_complet, initiales, fonction,
    telephone, email, matricule, adresse, ecole_nom, sous_titre, couleur_principale,
    couleur_secondaire, photo (ImageField), logo (ImageField)."""
    c = _couleurs(contexte.get("couleur_principale"), contexte.get("couleur_secondaire"))
    carte = Image.new("RGB", (LARGEUR * ECHELLE, HAUTEUR * ECHELLE), BLANC)
    dessin = ImageDraw.Draw(carte)
    _dessiner_fond(dessin, c)

    _en_tete(carte, _ouvrir(contexte.get("logo")), contexte.get("ecole_nom") or "", contexte.get("sous_titre") or "", c)
    _photo(carte, _ouvrir(contexte.get("photo")), contexte.get("initiales") or "", c)

    dessin = ImageDraw.Draw(carte)
    nom = (contexte.get("nom_complet") or "").upper()
    dessin.text((LARGEUR * ECHELLE / 2, 646 * ECHELLE), nom, font=_ajuster(dessin, nom, 44, 580), fill=c["marine"], anchor="ma")
    fonction = (contexte.get("fonction") or "Enseignant").upper()
    police_fonction = _ajuster(dessin, fonction, 24, 520)
    _texte_centre(dessin, fonction, 702, police_fonction, c["dore"], espacement=1.6)

    # Séparateur : trait bleu marine avec un point doré au centre.
    y = 742
    dessin.line([*_p(200, y), *_p(440, y)], fill=c["marine"], width=2 * ECHELLE)
    dessin.ellipse([*_p(320 - 5, y - 5), *_p(320 + 5, y + 5)], fill=c["dore"])

    lignes = [
        ("telephone", "Téléphone", contexte.get("telephone")),
        ("email", "E-mail", contexte.get("email")),
        ("matricule", "Matricule", contexte.get("matricule")),
        ("adresse", "Adresse", contexte.get("adresse")),
    ]
    police_label = _police(20, gras=False)
    for i, (genre, label, valeur) in enumerate(lignes):
        cy = 778 + i * 36
        _icone(dessin, genre, 118, cy, c)
        dessin.text(_p(150, cy), label, font=police_label, fill=c["texte"], anchor="lm")
        dessin.text(_p(272, cy), ":", font=police_label, fill=c["texte"], anchor="lm")
        texte = str(valeur or "—")
        dessin.text(_p(292, cy), texte, font=_ajuster(dessin, texte, 20, 325, gras=False), fill=c["texte"], anchor="lm")

    _code_barres(carte, contexte.get("matricule") or "", c)

    # Coins arrondis et fin liseré gris, comme une carte plastique.
    rayon = 36 * ECHELLE
    masque = Image.new("L", carte.size, 0)
    ImageDraw.Draw(masque).rounded_rectangle([0, 0, carte.width - 1, carte.height - 1], radius=rayon, fill=255)
    finale = Image.new("RGB", carte.size, BLANC)
    finale.paste(carte, (0, 0), masque)
    ImageDraw.Draw(finale).rounded_rectangle(
        [0, 0, finale.width - 1, finale.height - 1], radius=rayon, outline=(214, 219, 227), width=2 * ECHELLE,
    )

    finale = finale.resize(SORTIE, Image.LANCZOS)
    tampon = BytesIO()
    finale.save(tampon, format="JPEG", quality=92, optimize=True)
    return tampon.getvalue()


def carte_enseignant_data_uri(contexte: dict) -> str:
    return f"data:image/jpeg;base64,{base64.b64encode(carte_enseignant_png(contexte)).decode()}"
