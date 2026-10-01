"""Modèles 3 et 4 de la carte élève (le modèle 1 est dans carte_eleve.py, le modèle 2 réutilise
carte_enseignant.py) — reproduits à l'identique des modèles fournis par l'établissement :

- modèle 3 « Bandeau » : en-tête bleu marine à pointes jaunes, écusson, photo ronde, bandeau
  ÉLÈVE, cinq lignes à icônes carrées, code-barres, signature, validité, pied bleu ;
- modèle 4 « Université » : en-tête violet bordé d'orange, balance dorée, logo, photo cerclée
  d'orange, « Carte d'identification de l'établissement », quatre lignes, signature, barres.

Même repère que carte_eleve.py : 640 × 1015 (carte PVC CR80 portrait), dessin à ECHELLE.
"""

import math
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .carte_eleve import ECHELLE, HAUTEUR, LARGEUR, _ajuster, _ouvrir, _police

BLANC = (255, 255, 255)
SCRIPT = Path(__file__).resolve().parent.parent / "core" / "fonts" / "GreatVibes-Regular.ttf"


def _p(x, y):
    return (round(x * ECHELLE), round(y * ECHELLE))


def _poly(dessin, points, couleur):
    dessin.polygon([_p(x, y) for x, y in points], fill=couleur)


def _script(taille):
    return ImageFont.truetype(str(SCRIPT), round(taille * ECHELLE))


def _texte(dessin, xy, texte, police, couleur, ancre="la"):
    dessin.text(_p(*xy), texte, font=police, fill=couleur, anchor=ancre)


def _photo_ronde(carte, photo, initiales, cx, cy, r, fond, couleur_initiales):
    d = round(2 * r * ECHELLE)
    if photo is not None:
        rond = ImageOps.fit(photo, (d, d), Image.LANCZOS, centering=(0.5, 0.35))
    else:
        rond = Image.new("RGBA", (d, d), fond)
        ImageDraw.Draw(rond).text((d / 2, d / 2), initiales or "?", font=_police(r * 0.7), fill=couleur_initiales, anchor="mm")
    masque = Image.new("L", (d, d), 0)
    ImageDraw.Draw(masque).ellipse([0, 0, d, d], fill=255)
    carte.paste(rond, _p(cx - r, cy - r), masque)


def _logo(carte, logo, cx, cy, taille):
    if logo is None:
        return False
    logo = ImageOps.contain(logo, (round(taille * ECHELLE), round(taille * ECHELLE)), Image.LANCZOS)
    carte.paste(logo, (round(cx * ECHELLE - logo.width / 2), round(cy * ECHELLE - logo.height / 2)), logo)
    return True


def _code_barres(carte, valeur, x0, y0, x1, y1):
    import barcode
    from barcode.writer import ImageWriter

    if not valeur:
        return
    tampon = BytesIO()
    barcode.get("code128", valeur, writer=ImageWriter()).write(
        tampon, options={"write_text": False, "module_height": 12.0, "quiet_zone": 0.5, "dpi": 600},
    )
    image = Image.open(tampon).convert("RGB").resize(_p(x1 - x0, y1 - y0), Image.NEAREST)
    carte.paste(image, _p(x0, y0))


def _lignes_texte(dessin, texte, police, largeur, nb_max=2):
    mots, lignes, courante = (texte or "").split(), [], ""
    for mot in mots:
        essai = f"{courante} {mot}".strip()
        if dessin.textlength(essai, font=police) <= largeur * ECHELLE or not courante:
            courante = essai
        else:
            lignes.append(courante)
            courante = mot
    if courante:
        lignes.append(courante)
    return lignes[:nb_max]


def _arrondir(carte, rayon=34):
    masque = Image.new("L", carte.size, 0)
    ImageDraw.Draw(masque).rounded_rectangle([0, 0, carte.width - 1, carte.height - 1], radius=rayon * ECHELLE, fill=255)
    finale = Image.new("RGB", carte.size, BLANC)
    finale.paste(carte, (0, 0), masque)
    ImageDraw.Draw(finale).rounded_rectangle([0, 0, finale.width - 1, finale.height - 1], radius=rayon * ECHELLE, outline=(214, 219, 227), width=2 * ECHELLE)
    return finale


# --- Modèle 3 : « Bandeau » (bleu marine et jaune) -------------------------------------------

MARINE3, JAUNE3, BLEU_PALE3 = (19, 48, 107), (245, 184, 0), (225, 232, 245)


def _icone_carree(dessin, genre, cx, cy):
    dessin.rounded_rectangle([*_p(cx - 13, cy - 13), *_p(cx + 13, cy + 13)], radius=4 * ECHELLE, fill=MARINE3)
    t = 2 * ECHELLE
    if genre == "personne":
        dessin.ellipse([*_p(cx - 4, cy - 8), *_p(cx + 4, cy)], fill=BLANC)
        dessin.pieslice([*_p(cx - 8, cy + 1), *_p(cx + 8, cy + 15)], 180, 360, fill=BLANC)
    elif genre == "date":
        dessin.rectangle([*_p(cx - 7, cy - 6), *_p(cx + 7, cy + 7)], outline=BLANC, width=t)
        dessin.line([*_p(cx - 7, cy - 2), *_p(cx + 7, cy - 2)], fill=BLANC, width=t)
    elif genre == "classe":
        for dx in (-5, 5):
            dessin.ellipse([*_p(cx + dx - 3, cy - 7), *_p(cx + dx + 3, cy - 1)], fill=BLANC)
            dessin.pieslice([*_p(cx + dx - 6, cy), *_p(cx + dx + 6, cy + 12)], 180, 360, fill=BLANC)
    elif genre == "numero":
        dessin.rectangle([*_p(cx - 7, cy - 7), *_p(cx + 7, cy + 7)], outline=BLANC, width=t)
        dessin.line([*_p(cx - 3, cy - 3), *_p(cx + 4, cy - 3)], fill=BLANC, width=t)
        dessin.line([*_p(cx - 3, cy + 2), *_p(cx + 4, cy + 2)], fill=BLANC, width=t)
    else:  # adresse : maison
        dessin.polygon([_p(cx - 8, cy - 1), _p(cx, cy - 8), _p(cx + 8, cy - 1)], fill=BLANC)
        dessin.rectangle([*_p(cx - 6, cy - 1), *_p(cx + 6, cy + 7)], fill=BLANC)


def _ecusson(dessin, cx, cy, h, couleur, interieur, etoile_couleur=JAUNE3):
    """Écusson (bouclier) avec livre ouvert et étoile — emblème du modèle quand l'école n'a pas
    de logo, et filigrane en fond."""
    l = h * 0.82
    bouclier = [(cx - l / 2, cy - h / 2), (cx + l / 2, cy - h / 2), (cx + l / 2, cy + h * 0.05),
                (cx, cy + h / 2), (cx - l / 2, cy + h * 0.05)]
    _poly(dessin, bouclier, couleur)
    m = h * 0.07
    _poly(dessin, [(cx - l / 2 + m, cy - h / 2 + m), (cx + l / 2 - m, cy - h / 2 + m), (cx + l / 2 - m, cy + h * 0.03),
                   (cx, cy + h / 2 - m * 1.4), (cx - l / 2 + m, cy + h * 0.03)], interieur)
    _poly(dessin, [(cx - l * 0.3, cy - h * 0.08), (cx - 2, cy - h * 0.02), (cx - 2, cy + h * 0.2), (cx - l * 0.3, cy + h * 0.13)], couleur)
    _poly(dessin, [(cx + l * 0.3, cy - h * 0.08), (cx + 2, cy - h * 0.02), (cx + 2, cy + h * 0.2), (cx + l * 0.3, cy + h * 0.13)], couleur)
    etoile = [(cx + (h * 0.09 if i % 2 == 0 else h * 0.04) * math.cos(-math.pi / 2 + math.pi * i / 5),
               cy - h * 0.24 + (h * 0.09 if i % 2 == 0 else h * 0.04) * math.sin(-math.pi / 2 + math.pi * i / 5)) for i in range(10)]
    _poly(dessin, etoile, etoile_couleur)


def carte_modele_bandeau(contexte) -> Image.Image:
    carte = Image.new("RGB", (LARGEUR * ECHELLE, HAUTEUR * ECHELLE), BLANC)
    dessin = ImageDraw.Draw(carte)
    # Filigrane : grand écusson très pâle à droite.
    _ecusson(dessin, 560, 690, 300, (238, 242, 250), BLANC, etoile_couleur=(238, 242, 250))
    # En-tête marine, pointes jaunes.
    _poly(dessin, [(0, 0), (LARGEUR, 0), (LARGEUR, 205), (430, 262), (210, 262), (0, 205)], MARINE3)
    _poly(dessin, [(0, 205), (210, 262), (205, 286), (0, 236)], JAUNE3)
    _poly(dessin, [(LARGEUR, 205), (430, 262), (435, 286), (LARGEUR, 236)], JAUNE3)
    if not _logo(carte, _ouvrir(contexte.get("logo")), 82, 98, 120):
        _ecusson(dessin, 82, 98, 118, JAUNE3, MARINE3)
    nom = (contexte.get("ecole_nom") or "").upper()
    lignes = _lignes_texte(dessin, nom, _police(30), 420)
    police_nom = _ajuster(dessin, max(lignes, key=len) if lignes else "", 32, 420)
    y = 46 if len(lignes) > 1 else 62
    for i, ligne in enumerate(lignes):
        _texte(dessin, (380, y + i * 36), ligne, police_nom, BLANC, "ma")
    y += len(lignes) * 36 + 6
    annee = f"ANNÉE {contexte.get('annee_scolaire', '')}".strip()
    _texte(dessin, (380, y), annee, _ajuster(dessin, annee, 18, 420, gras=False), JAUNE3, "ma")
    dessin.line([*_p(200, y + 32), *_p(560, y + 32)], fill=(120, 140, 190), width=2)
    _texte(dessin, (380, y + 40), "APPRENDRE  |  GRANDIR  |  RÉUSSIR", _police(14, gras=False), BLANC, "ma")

    # Photo ronde, emblème à gauche, ID No. à droite.
    dessin.ellipse([*_p(320 - 136, 312 - 136), *_p(320 + 136, 312 + 136)], fill=MARINE3)
    dessin.ellipse([*_p(320 - 129, 312 - 129), *_p(320 + 129, 312 + 129)], fill=BLANC)
    _photo_ronde(carte, _ouvrir(contexte.get("photo")), contexte.get("initiales"), 320, 312, 124, BLEU_PALE3, MARINE3)
    dessin = ImageDraw.Draw(carte)
    # Toque + lauriers + année (« ESTD. »).
    _poly(dessin, [(58, 362), (88, 348), (118, 362), (88, 376)], MARINE3)
    dessin.rectangle([*_p(74, 368), *_p(102, 384)], fill=MARINE3)
    for sens in (-1, 1):
        for k in range(4):
            fx, fy = 88 + sens * (36 - k * 3), 360 + k * 10
            dessin.ellipse([*_p(fx - 6, fy - 3), *_p(fx + 6, fy + 3)], fill=MARINE3)
    _texte(dessin, (88, 400), contexte.get("annee_scolaire", ""), _police(13), MARINE3, "ma")
    _texte(dessin, (555, 340), "MATRICULE", _police(15), MARINE3, "ma")
    _texte(dessin, (555, 366), contexte.get("matricule", ""), _ajuster(dessin, contexte.get("matricule", ""), 17, 150, gras=False), (30, 34, 50), "ma")

    # Bandeau ÉLÈVE.
    _poly(dessin, [(178, 462), (200, 462), (190, 478), (200, 494), (178, 494), (168, 478)], JAUNE3)
    _poly(dessin, [(462, 462), (440, 462), (450, 478), (440, 494), (462, 494), (472, 478)], JAUNE3)
    _poly(dessin, [(196, 456), (444, 456), (456, 478), (444, 500), (196, 500), (184, 478)], MARINE3)
    _texte(dessin, (320, 478), "ÉLÈVE", _police(26), BLANC, "mm")
    nom_eleve = (contexte.get("nom_complet") or "").upper()
    _texte(dessin, (320, 520), nom_eleve, _ajuster(dessin, nom_eleve, 38, 560), MARINE3, "ma")

    lignes_info = [
        ("personne", "Nom du père", contexte.get("nom_pere") or "—"),
        ("date", "Né(e) le", contexte.get("date_naissance") or "—"),
        ("classe", "Classe", contexte.get("classe") or "—"),
        ("numero", "Matricule", contexte.get("matricule") or "—"),
        ("adresse", "Adresse", contexte.get("adresse") or "—"),
    ]
    police_l = _police(17, gras=False)
    for i, (icone, label, valeur) in enumerate(lignes_info):
        cy = 598 + i * 42
        _icone_carree(dessin, icone, 96, cy)
        _texte(dessin, (126, cy), label, police_l, (40, 44, 60), "lm")
        _texte(dessin, (272, cy), ":", police_l, (40, 44, 60), "lm")
        _texte(dessin, (290, cy), str(valeur), _ajuster(dessin, str(valeur), 17, 320, gras=False), (40, 44, 60), "lm")
    _code_barres(carte, contexte.get("matricule"), 150, 806, 490, 852)
    dessin = ImageDraw.Draw(carte)

    # Signature (gauche) et validité (droite).
    signataire = contexte.get("directeur_nom") or ""
    if signataire:
        _texte(dessin, (120, 902), signataire, _script(30), (40, 44, 70), "ms")
    dessin.line([*_p(55, 908), *_p(190, 908)], fill=(60, 64, 80), width=2)
    _texte(dessin, (122, 916), "Directeur", _police(14, gras=False), (40, 44, 60), "ma")
    _ecusson(dessin, 400, 900, 52, MARINE3, MARINE3)
    dessin.line([*_p(390, 902), *_p(398, 910), *_p(412, 892)], fill=BLANC, width=3 * ECHELLE)
    _texte(dessin, (436, 882), "Valable jusqu'au", _police(15), MARINE3, "la")
    _texte(dessin, (436, 904), contexte.get("valid_upto") or "—", _police(15, gras=False), (40, 44, 60), "la")

    # Pied : liseré jaune, bande marine avec téléphone, site / adresse, e-mail.
    dessin.rectangle([*_p(0, 952), *_p(LARGEUR, 958)], fill=JAUNE3)
    dessin.rectangle([*_p(0, 958), *_p(LARGEUR, HAUTEUR)], fill=MARINE3)
    pied = [contexte.get("ecole_telephone"), contexte.get("ecole_adresse"), contexte.get("ecole_email")]
    pied = [x for x in pied if x]
    if pied:
        largeur = LARGEUR / len(pied)
        for i, info in enumerate(pied):
            _texte(dessin, (largeur * i + largeur / 2, 986), info, _ajuster(dessin, info, 13, largeur - 20, gras=False), BLANC, "mm")
    return carte


# --- Modèle 4 : « Université » (violet et orange) --------------------------------------------

VIOLET4, ORANGE4, ENCRE4 = (33, 26, 104), (232, 124, 30), (28, 30, 60)


def _balance(dessin, cx, cy, couleur):
    """Balance dorée du modèle."""
    dessin.line([*_p(cx, cy - 34), *_p(cx, cy + 30)], fill=couleur, width=3 * ECHELLE)
    dessin.line([*_p(cx - 36, cy - 24), *_p(cx + 36, cy - 24)], fill=couleur, width=3 * ECHELLE)
    for dx in (-36, 36):
        dessin.line([*_p(cx + dx, cy - 24), *_p(cx + dx - 12, cy + 6)], fill=couleur, width=2)
        dessin.line([*_p(cx + dx, cy - 24), *_p(cx + dx + 12, cy + 6)], fill=couleur, width=2)
        dessin.chord([*_p(cx + dx - 16, cy - 6), *_p(cx + dx + 16, cy + 16)], 0, 180, fill=couleur)
    dessin.polygon([_p(cx - 20, cy + 40), _p(cx + 20, cy + 40), _p(cx + 10, cy + 28), _p(cx - 10, cy + 28)], fill=couleur)
    dessin.ellipse([*_p(cx - 5, cy - 40), *_p(cx + 5, cy - 30)], fill=couleur)


def carte_modele_universite(contexte) -> Image.Image:
    carte = Image.new("RGB", (LARGEUR * ECHELLE, HAUTEUR * ECHELLE), BLANC)
    dessin = ImageDraw.Draw(carte)
    # Bordure orange puis en-tête violet (descend à droite autour de la photo).
    _poly(dessin, [(0, 0), (LARGEUR, 0), (LARGEUR, 352), (480, 528), (470, 512), (LARGEUR, 334)], ORANGE4)
    _poly(dessin, [(0, 0), (LARGEUR, 0), (LARGEUR, 334), (470, 512), (300, 330), (0, 262)], VIOLET4)
    # Rayures diagonales à gauche (violet, orange).
    _poly(dessin, [(0, 280), (150, 352), (150, 372), (0, 300)], VIOLET4)
    _poly(dessin, [(0, 318), (130, 380), (130, 398), (0, 336)], ORANGE4)

    lignes = _lignes_texte(dessin, (contexte.get("ecole_nom") or "").upper(), _police(40), 560, nb_max=2)
    y = 54
    for i, ligne in enumerate(lignes):
        police = _ajuster(dessin, ligne, 46 if i == 0 else 40, 580)
        _texte(dessin, (330, y), ligne, police, BLANC, "ma")
        y += 50
    for info in [contexte.get("ecole_adresse"), f"Année scolaire {contexte.get('annee_scolaire', '')}"]:
        if info and info.strip() != "Année scolaire":
            _texte(dessin, (330, y + 4), info, _ajuster(dessin, info, 20, 440, gras=False), BLANC, "ma")
            y += 28
    _balance(dessin, 92, 238, (226, 170, 60))
    if not _logo(carte, _ouvrir(contexte.get("logo")), 545, 285, 104):
        _ecusson(dessin, 545, 285, 96, (226, 170, 60), VIOLET4, etoile_couleur=(226, 170, 60))

    # Photo cerclée d'orange.
    cx, cy, r = 306, 413, 132
    dessin.ellipse([*_p(cx - r - 12, cy - r - 12), *_p(cx + r + 12, cy + r + 12)], fill=ORANGE4)
    dessin.ellipse([*_p(cx - r - 5, cy - r - 5), *_p(cx + r + 5, cy + r + 5)], fill=BLANC)
    _photo_ronde(carte, _ouvrir(contexte.get("photo")), contexte.get("initiales"), cx, cy, r, (232, 230, 245), VIOLET4)
    dessin = ImageDraw.Draw(carte)

    _texte(dessin, (320, 590), "Carte d'identification", _police(42), VIOLET4, "ma")
    _texte(dessin, (320, 642), "de l'établissement", _police(26, gras=False), ORANGE4, "ma")
    lignes_info = [
        ("Nom", contexte.get("nom") or "—"),
        ("Prénom", contexte.get("prenom") or "—"),
        ("Sexe", contexte.get("sexe") or "—"),
        ("Classe", contexte.get("classe") or "—"),
    ]
    for i, (label, valeur) in enumerate(lignes_info):
        cy_l = 720 + i * 44
        _texte(dessin, (86, cy_l), label, _police(28), VIOLET4, "lm")
        _texte(dessin, (252, cy_l), ":", _police(28), ENCRE4, "lm")
        _texte(dessin, (286, cy_l), str(valeur), _ajuster(dessin, str(valeur), 28, 330, gras=False), ENCRE4, "lm")

    dessin.line([*_p(352, 920), *_p(508, 920)], fill=ENCRE4, width=2)
    _texte(dessin, (430, 928), "Signature", _police(17), ENCRE4, "ma")
    # Barres du bas : orange à gauche, violet au centre, petite barre violette à droite.
    dessin.rounded_rectangle([*_p(-20, 978), *_p(100, 994)], radius=8 * ECHELLE, fill=ORANGE4)
    dessin.rounded_rectangle([*_p(100, 968), *_p(540, HAUTEUR + 30)], radius=18 * ECHELLE, fill=VIOLET4)
    dessin.rounded_rectangle([*_p(560, 948), *_p(LARGEUR + 20, 962)], radius=7 * ECHELLE, fill=VIOLET4)
    return _arrondir(carte, 30)
