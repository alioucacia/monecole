"""Attestation d'excellence (A4 paysage) dessinée en image avec Pillow, sur le modèle fourni par
l'établissement : fond bleu nuit, couronne dorée, titre « ATTESTATION » en lettres or rosé,
« D'EXCELLENCE », nom de l'élève en écriture manuscrite, texte de félicitations, deux
signatures, ruban bleu et sceau doré à droite, vagues dorées et bande claire en bas.

Le moteur PDF du projet (xhtml2pdf) ne sait dessiner ni dégradés, ni courbes, ni sceau : chaque
attestation est donc une image haute définition posée pleine page dans le PDF
(voir AttestationHonneurPdfView). Polices embarquées dans core/fonts (licence OFL).

Repère de référence 1400 × 990 (proportions A4 paysage), dessin à ECHELLE puis réduction.
"""

import math
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

L, H = 1400, 990
ECHELLE = 2
SORTIE = (2480, 1754)  # ~210 dpi en A4 paysage — net à l'impression, PDF raisonnable

POLICES = Path(__file__).resolve().parent.parent / "core" / "fonts"
VERA = Path(__import__("reportlab").__file__).resolve().parent / "fonts"

MARINE = (14, 33, 58)
MARINE_CLAIR = (31, 58, 92)
OR = (214, 160, 72)
OR_CLAIR = (246, 214, 140)
OR_FONCE = (150, 98, 34)
ROSE = (240, 190, 170)
CREME = (244, 232, 214)
BLANC = (255, 255, 255)


def _p(x, y):
    return (round(x * ECHELLE), round(y * ECHELLE))


def _police(nom: str, taille: float, graisse: int | None = None):
    chemins = {
        "titre": POLICES / "PlayfairDisplay-Variable.ttf",
        "script": POLICES / "GreatVibes-Regular.ttf",
        # Chiffres alignés (« 2026 », « 1ER ») : Playfair n'a que des chiffres « à l'ancienne »
        # sans moteur de mise en forme OpenType (libraqm absent), d'où Cinzel pour le sceau.
        "sceau": POLICES / "Cinzel-Variable.ttf",
        "texte": VERA / "Vera.ttf",
        "texte_gras": VERA / "VeraBd.ttf",
        "texte_italique": VERA / "VeraIt.ttf",
    }
    police = ImageFont.truetype(str(chemins[nom]), max(1, round(taille * ECHELLE)))
    if graisse is not None:
        try:
            police.set_variation_by_axes([graisse])
        except Exception:  # noqa: BLE001 — police non variable : graisse par défaut
            pass
    return police


def _ajuster(dessin, texte, nom, taille, largeur_max, graisse=None):
    while taille > 8:
        police = _police(nom, taille, graisse)
        if dessin.textlength(texte, font=police) <= largeur_max * ECHELLE:
            return police
        taille -= 1
    return _police(nom, taille, graisse)


def _bezier(points, pas=80):
    """Courbe de Bézier (n points de contrôle) dans le repère de référence."""
    resultat = []
    n = len(points) - 1
    for i in range(pas + 1):
        t = i / pas
        x = y = 0.0
        for k, (px, py) in enumerate(points):
            coef = math.comb(n, k) * (1 - t) ** (n - k) * t ** k
            x += coef * px
            y += coef * py
        resultat.append(_p(x, y))
    return resultat


def _degrade_vertical(taille, haut, bas):
    largeur, hauteur = taille
    image = Image.new("RGB", (1, hauteur))
    for y in range(hauteur):
        t = y / max(1, hauteur - 1)
        image.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(haut, bas)))
    return image.resize((largeur, hauteur))


def _texte_degrade(carte, texte, centre_x, y, police, couleurs, espacement=0.0):
    """Texte rempli d'un dégradé horizontal (or rosé du modèle), centré sur `centre_x`."""
    dessin = ImageDraw.Draw(carte)
    ecart = espacement * ECHELLE
    largeur = sum(dessin.textlength(c, font=police) for c in texte) + ecart * (len(texte) - 1)
    boite = police.getbbox("ÉÀgy")
    hauteur = boite[3] + 4
    masque = Image.new("L", (math.ceil(largeur) + 4, hauteur), 0)
    md = ImageDraw.Draw(masque)
    x = 0.0
    for c in texte:
        md.text((x, 0), c, font=police, fill=255)
        x += dessin.textlength(c, font=police) + ecart
    degrade = Image.new("RGB", masque.size)
    for i in range(masque.size[0]):
        t = i / max(1, masque.size[0] - 1)
        segment = t * (len(couleurs) - 1)
        k = min(int(segment), len(couleurs) - 2)
        f = segment - k
        couleur = tuple(round(a + (b - a) * f) for a, b in zip(couleurs[k], couleurs[k + 1]))
        ImageDraw.Draw(degrade).line([(i, 0), (i, masque.size[1])], fill=couleur)
    carte.paste(degrade, (round(centre_x * ECHELLE - largeur / 2), round(y * ECHELLE)), masque)


def _centre(dessin, texte, cx, y, police, couleur, espacement=0.0):
    ecart = espacement * ECHELLE
    largeur = sum(dessin.textlength(c, font=police) for c in texte) + ecart * (len(texte) - 1)
    x = cx * ECHELLE - largeur / 2
    for c in texte:
        dessin.text((x, y * ECHELLE), c, font=police, fill=couleur)
        x += dessin.textlength(c, font=police) + ecart
    return largeur / ECHELLE


def _fond(carte):
    dessin = ImageDraw.Draw(carte)
    # Fond bleu nuit, plus clair au centre (lumière douce du modèle).
    carte.paste(_degrade_vertical(carte.size, MARINE_CLAIR, MARINE), (0, 0))
    halo = Image.new("L", carte.size, 0)
    ImageDraw.Draw(halo).ellipse([*_p(120, 40), *_p(1000, 640)], fill=110)
    halo = halo.filter(ImageFilter.GaussianBlur(160 * ECHELLE))
    carte.paste(Image.new("RGB", carte.size, (46, 82, 124)), (0, 0), halo)

    # Fin filet doré en haut.
    dessin.line([*_p(0, 66), *_p(1400, 66)], fill=(150, 120, 70), width=2 * ECHELLE)

    # Bas : bande claire (papier) bordée de vagues or / bleu / or.
    papier = _bezier([(0, 720), (420, 930), (900, 840), (1400, 600)]) + [_p(1400, 990), _p(0, 990)]
    vague_or_bas = _bezier([(0, 700), (420, 910), (900, 820), (1400, 580)]) + [_p(1400, 990), _p(0, 990)]
    vague_marine = _bezier([(0, 672), (420, 885), (900, 795), (1400, 552)]) + [_p(1400, 990), _p(0, 990)]
    vague_or_haut = _bezier([(0, 658), (420, 870), (900, 780), (1400, 538)]) + [_p(1400, 990), _p(0, 990)]
    dessin.polygon(vague_or_haut, fill=OR)
    dessin.polygon(vague_marine, fill=(22, 44, 76))
    dessin.polygon(vague_or_bas, fill=OR_FONCE)
    dessin.polygon(papier, fill=(240, 236, 228))


def _couronne(dessin, cx, cy, l=56):
    h = l * 0.62
    pointes = [
        (cx - l / 2, cy + h / 2), (cx - l / 2, cy - h / 6), (cx - l / 4, cy + h / 8), (cx, cy - h / 2),
        (cx + l / 4, cy + h / 8), (cx + l / 2, cy - h / 6), (cx + l / 2, cy + h / 2),
    ]
    dessin.polygon([_p(*pt) for pt in pointes], fill=OR)
    dessin.rectangle([*_p(cx - l / 2, cy + h / 2), *_p(cx + l / 2, cy + h / 2 + 8)], fill=OR_FONCE)
    for px, py in ((cx - l / 2, cy - h / 6), (cx, cy - h / 2), (cx + l / 2, cy - h / 6)):
        dessin.ellipse([*_p(px - 4, py - 4), *_p(px + 4, py + 4)], fill=OR_CLAIR)


def _ruban_et_sceau(carte, annee: str, prix: str):
    dessin = ImageDraw.Draw(carte)
    x0, x1 = 1090, 1285
    # Ruban vertical, ombré sur ses bords.
    dessin.rectangle([*_p(x0, 0), *_p(x1, 520)], fill=(20, 45, 88))
    dessin.rectangle([*_p(x0, 0), *_p(x0 + 18, 520)], fill=(14, 32, 64))
    dessin.rectangle([*_p(x1 - 18, 0), *_p(x1, 520)], fill=(14, 32, 64))
    # Deux pans de ruban en bas, coupés en V.
    for pans in (
        [(1035, 420), (1150, 420), (1215, 940), (1172, 900), (1120, 965)],
        [(1225, 420), (1340, 420), (1300, 955), (1255, 905), (1205, 945)],
    ):
        dessin.polygon([_p(*pt) for pt in pans], fill=(24, 52, 98))
        dessin.line([_p(*pans[0]), _p(*pans[-1])], fill=(14, 32, 64), width=6 * ECHELLE)

    # Sceau doré dentelé.
    cx, cy, r = 1188, 430, 168
    ombre = Image.new("L", carte.size, 0)
    ImageDraw.Draw(ombre).ellipse([*_p(cx - r + 10, cy - r + 18), *_p(cx + r + 10, cy + r + 18)], fill=150)
    carte.paste((5, 12, 25), (0, 0), ombre.filter(ImageFilter.GaussianBlur(14 * ECHELLE)))
    dessin = ImageDraw.Draw(carte)
    dents = 36
    contour = []
    for i in range(dents * 2):
        angle = math.pi * i / dents
        rayon = r if i % 2 == 0 else r - 16
        contour.append(_p(cx + rayon * math.cos(angle), cy + rayon * math.sin(angle)))
    dessin.polygon(contour, fill=OR)
    for rayon, couleur in ((r - 24, OR_CLAIR), (r - 30, OR_FONCE), (r - 36, (199, 145, 60)), (r - 50, (60, 40, 18)), (r - 54, (19, 41, 78))):
        dessin.ellipse([*_p(cx - rayon, cy - rayon), *_p(cx + rayon, cy + rayon)], fill=couleur)
    dessin.ellipse([*_p(cx - (r - 66), cy - (r - 66)), *_p(cx + (r - 66), cy + (r - 66))], outline=OR, width=2 * ECHELLE)
    _centre(dessin, annee, cx, cy - 46, _ajuster(dessin, annee, "sceau", 34, 158, 600), CREME)
    _centre(dessin, prix, cx, cy + 4, _ajuster(dessin, prix, "sceau", 40, 162, 700), CREME)


def attestation_png(contexte: dict) -> bytes:
    """Image JPEG d'une attestation. Clés : nom_complet, texte (paragraphe), annee, prix,
    signataire_1 / role_1, signataire_2 / role_2, pied (école, date)."""
    carte = Image.new("RGB", (L * ECHELLE, H * ECHELLE), MARINE)
    _fond(carte)
    _ruban_et_sceau(carte, contexte.get("annee", ""), contexte.get("prix", ""))

    dessin = ImageDraw.Draw(carte)
    cx = 545  # centre de la zone de texte (à gauche du ruban)
    _couronne(dessin, cx, 62, l=78)

    _texte_degrade(carte, "ATTESTATION", cx, 112, _police("titre", 118, 500), [(239, 170, 150), (255, 236, 226), (230, 160, 140)], espacement=6)
    _texte_degrade(carte, "D'EXCELLENCE", cx, 250, _police("titre", 46, 500), [(232, 165, 145), (250, 210, 196), (232, 165, 145)], espacement=1.5)
    y = 318
    dessin.line([*_p(cx - 250, y), *_p(cx + 250, y)], fill=(225, 205, 190), width=2 * ECHELLE)
    for dx in (-250, 250):
        dessin.ellipse([*_p(cx + dx - 4, y - 4), *_p(cx + dx + 4, y + 4)], fill=(225, 205, 190))
    _centre(dessin, "DÉCERNÉE À", cx, 340, _police("titre", 27, 500), (232, 190, 180), espacement=1.2)

    nom = contexte.get("nom_complet", "")
    police_nom = _ajuster(dessin, nom, "script", 104, 760)
    _texte_degrade(carte, nom, cx, 386, police_nom, [(214, 190, 150), (250, 240, 222), (214, 190, 150)])
    dessin.line([*_p(cx - 300, 512), *_p(cx + 300, 512)], fill=(150, 160, 180), width=2)

    # Paragraphe centré (2 à 3 lignes).
    police_texte = _police("texte", 19)
    mots, lignes, courante = contexte.get("texte", "").split(), [], ""
    for mot in mots:
        essai = f"{courante} {mot}".strip()
        if dessin.textlength(essai, font=police_texte) <= 700 * ECHELLE:
            courante = essai
        else:
            lignes.append(courante)
            courante = mot
    if courante:
        lignes.append(courante)
    for i, ligne in enumerate(lignes[:3]):
        _centre(dessin, ligne, cx, 535 + i * 30, police_texte, (232, 236, 242))

    # Signatures.
    for sx, role, nom_sign in ((350, contexte.get("role_1", ""), contexte.get("signataire_1", "")),
                               (740, contexte.get("role_2", ""), contexte.get("signataire_2", ""))):
        _centre(dessin, role.upper(), sx, 632, _ajuster(dessin, role.upper(), "texte_italique", 21, 330), (230, 234, 240))
        if nom_sign:
            _texte_degrade(carte, nom_sign, sx, 664, _ajuster(dessin, nom_sign, "script", 56, 330), [(214, 190, 150), (245, 232, 210), (214, 190, 150)])

    # Pied, dans la bande claire.
    pied = contexte.get("pied", "")
    if pied:
        _centre(dessin, pied, 420, 920, _police("texte", 15), (110, 118, 132))

    carte = carte.resize(SORTIE, Image.LANCZOS)
    tampon = BytesIO()
    carte.save(tampon, format="JPEG", quality=90, optimize=True)
    return tampon.getvalue()
