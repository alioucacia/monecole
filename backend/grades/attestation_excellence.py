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


def _rgb(hexa: str, defaut):
    hexa = (hexa or "").lstrip("#")
    try:
        return tuple(int(hexa[i:i + 2], 16) for i in (0, 2, 4)) if len(hexa) == 6 else defaut
    except ValueError:
        return defaut


def _melange(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def _luminance(c):
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255


def _sombre(c, seuil=0.18):
    while _luminance(c) > seuil:
        c = _melange(c, (0, 0, 0), 0.2)
    return c


def _paragraphe(dessin, texte, cx, y, police, couleur, largeur=700, interligne=30, max_lignes=3):
    mots, lignes, courante = (texte or "").split(), [], ""
    for mot in mots:
        essai = f"{courante} {mot}".strip()
        if dessin.textlength(essai, font=police) <= largeur * ECHELLE:
            courante = essai
        else:
            lignes.append(courante)
            courante = mot
    if courante:
        lignes.append(courante)
    for i, ligne in enumerate(lignes[:max_lignes]):
        _centre(dessin, ligne, cx, y + i * interligne, police, couleur)


def _signatures(carte, contexte, xs, y, couleur_role, couleurs_nom, avec_trait=None):
    dessin = ImageDraw.Draw(carte)
    for sx, role, nom_sign in ((xs[0], contexte.get("role_1", ""), contexte.get("signataire_1", "")),
                               (xs[1], contexte.get("role_2", ""), contexte.get("signataire_2", ""))):
        if avec_trait:
            dessin.line([*_p(sx - 150, y - 8), *_p(sx + 150, y - 8)], fill=avec_trait, width=2)
        _centre(dessin, role.upper(), sx, y, _ajuster(dessin, role.upper(), "texte_italique", 19, 320), couleur_role)
        if nom_sign:
            _texte_degrade(carte, nom_sign, sx, y + 30, _ajuster(dessin, nom_sign, "script", 52, 320), couleurs_nom)


def _sceau(carte, cx, cy, r, annee, prix, interieur, texte=CREME, rubans=None):
    """Sceau doré dentelé (année + prix), avec deux pans de ruban de couleur `rubans`."""
    dessin = ImageDraw.Draw(carte)
    if rubans:
        for dx, sens in ((-0.45, -1), (0.45, 1)):
            bx = cx + dx * r
            pans = [(bx - 0.28 * r, cy), (bx + 0.28 * r, cy), (bx + sens * 0.18 * r + 0.28 * r, cy + 1.55 * r),
                    (bx + sens * 0.18 * r, cy + 1.32 * r), (bx + sens * 0.18 * r - 0.28 * r, cy + 1.55 * r)]
            dessin.polygon([_p(*pt) for pt in pans], fill=rubans)
    ombre = Image.new("L", carte.size, 0)
    ImageDraw.Draw(ombre).ellipse([*_p(cx - r + 6, cy - r + 10), *_p(cx + r + 6, cy + r + 10)], fill=120)
    carte.paste((10, 10, 20), (0, 0), ombre.filter(ImageFilter.GaussianBlur(10 * ECHELLE)))
    dessin = ImageDraw.Draw(carte)
    dents, contour = 32, []
    for i in range(dents * 2):
        angle = math.pi * i / dents
        rayon = r if i % 2 == 0 else r * 0.9
        contour.append(_p(cx + rayon * math.cos(angle), cy + rayon * math.sin(angle)))
    dessin.polygon(contour, fill=OR)
    for f, couleur in ((0.86, OR_CLAIR), (0.82, OR_FONCE), (0.78, (199, 145, 60)), (0.70, (60, 40, 18)), (0.675, interieur)):
        dessin.ellipse([*_p(cx - r * f, cy - r * f), *_p(cx + r * f, cy + r * f)], fill=couleur)
    _centre(dessin, annee, cx, cy - r * 0.30, _ajuster(dessin, annee, "sceau", r * 0.2, r * 0.95, 600), texte)
    _centre(dessin, prix, cx, cy + r * 0.03, _ajuster(dessin, prix, "sceau", r * 0.24, r * 0.98, 700), texte)


def _modele_prestige(contexte):
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

    return carte


def _miroir(points):
    """Symétrique horizontal d'une liste de points (repère de référence)."""
    return [(L - x, y) for x, y in points]


def _poly(dessin, points, couleur):
    dessin.polygon([_p(x, y) for x, y in points], fill=couleur)


def _ligne(dessin, points, couleur, epaisseur=2):
    dessin.line([_p(x, y) for x, y in points], fill=couleur, width=round(epaisseur * ECHELLE), joint="curve")


def _rosette(carte, cx, cy, r, haut, bas, fond=OR, texte=(120, 80, 20), laurier=True):
    """Médaille dorée à bord ondulé (style « BEST AWARD »), avec couronne de laurier et étoile."""
    dessin = ImageDraw.Draw(carte)
    ombre = Image.new("L", carte.size, 0)
    ImageDraw.Draw(ombre).ellipse([*_p(cx - r + 4, cy - r + 8), *_p(cx + r + 4, cy + r + 8)], fill=90)
    carte.paste((60, 50, 30), (0, 0), ombre.filter(ImageFilter.GaussianBlur(8 * ECHELLE)))
    dessin = ImageDraw.Draw(carte)
    contour = []
    for i in range(240):
        a = 2 * math.pi * i / 240
        rayon = r * (0.94 + 0.06 * math.cos(24 * a))
        contour.append(_p(cx + rayon * math.cos(a), cy + rayon * math.sin(a)))
    dessin.polygon(contour, fill=fond)
    dessin.ellipse([*_p(cx - r * 0.8, cy - r * 0.8), *_p(cx + r * 0.8, cy + r * 0.8)], fill=OR_CLAIR)
    dessin.ellipse([*_p(cx - r * 0.74, cy - r * 0.74), *_p(cx + r * 0.74, cy + r * 0.74)], fill=(226, 176, 80))
    if laurier:
        for sens in (-1, 1):
            for k in range(6):
                a = math.radians(115 + k * 20) if sens < 0 else math.radians(65 - k * 20)
                fx, fy = cx + r * 0.58 * math.cos(a), cy + r * 0.58 * math.sin(a)
                dessin.ellipse([*_p(fx - r * 0.07, fy - r * 0.035), *_p(fx + r * 0.07, fy + r * 0.035)], fill=texte)
    etoile = []
    for i in range(10):
        a = -math.pi / 2 + math.pi * i / 5
        rr = r * (0.13 if i % 2 == 0 else 0.055)
        etoile.append(_p(cx + rr * math.cos(a), cy - r * 0.3 + rr * math.sin(a)))
    dessin.polygon(etoile, fill=texte)
    _centre(dessin, haut, cx, cy - r * 0.12, _ajuster(dessin, haut, "sceau", r * 0.2, r * 0.9, 700), texte)
    _centre(dessin, bas, cx, cy + r * 0.12, _ajuster(dessin, bas, "sceau", r * 0.24, r * 0.9, 800), texte)


def _decoupe_prix(prix):
    mots = (prix or "").split()
    return (mots[0], " ".join(mots[1:])) if len(mots) > 1 else ("", prix or "")


def _logo_ou_hexagones(carte, logo, cx, cy, taille, couleurs):
    dessin = ImageDraw.Draw(carte)
    if logo is not None:
        logo = logo.copy()
        logo.thumbnail((round(taille * 2.2 * ECHELLE), round(taille * ECHELLE)), Image.LANCZOS)
        carte.paste(logo, (round(cx * ECHELLE - logo.width / 2), round(cy * ECHELLE - logo.height / 2)), logo if logo.mode == "RGBA" else None)
        return
    for i, dx in enumerate((-taille * 0.62, 0, taille * 0.62)):
        rr = taille * (0.36 if i != 1 else 0.44)
        hexa = [_p(cx + dx + rr * math.cos(math.pi / 3 * k), cy + rr * math.sin(math.pi / 3 * k)) for k in range(6)]
        dessin.polygon(hexa, fill=couleurs[i % len(couleurs)])
    dessin.ellipse([*_p(cx - taille * 0.16, cy - taille * 0.16), *_p(cx + taille * 0.16, cy + taille * 0.16)], fill=couleurs[-1])


def _modele_geometrique(contexte):
    """Blanc et bleu, formes géométriques en diagonale avec liserés dorés de part et d'autre,
    médaille dorée en bas au centre (modèle fourni par l'établissement)."""
    marine, royal, bleu = (27, 36, 99), (36, 62, 150), (46, 84, 178)
    or_ = (205, 158, 52)
    carte = Image.new("RGB", (L * ECHELLE, H * ECHELLE), BLANC)
    dessin = ImageDraw.Draw(carte)
    # Fond : fines lignes ondulées gris très clair.
    for y0 in range(40, H, 34):
        points = [(x, y0 + 5 * math.sin(x / 16)) for x in range(0, L + 1, 8)]
        _ligne(dessin, points, (236, 239, 244), 1.2)
    for miroir in (False, True):
        m = _miroir if miroir else (lambda pts: pts)
        _poly(dessin, m([(0, 70), (215, 330), (0, 590)]), bleu)                  # grand losange bleu
        _poly(dessin, m([(0, 330), (250, 560), (0, 800)]), royal)                # losange bleu roi
        _poly(dessin, m([(0, 520), (190, 680), (0, 850)]), marine)               # triangle marine
        _poly(dessin, m([(70, 0), (165, 0), (330, 300), (235, 300)]), marine)    # bande marine en haut
        _poly(dessin, m([(0, 30), (25, 0), (60, 0), (215, 280), (180, 300)]), or_)  # bande dorée en haut
        _poly(dessin, m([(0, 990), (55, 990), (160, 900), (110, 880)]), marine)  # bande marine en bas
        _ligne(dessin, m([(0, 210), (300, 470), (0, 740)]), or_, 3)             # liserés dorés (losanges)
        _ligne(dessin, m([(40, 440), (255, 620), (40, 800)]), or_, 3)
        _ligne(dessin, m([(0, 870), (40, 840)]), or_, 3)

    cx = L / 2
    _logo_ou_hexagones(carte, _ouvrir_image(contexte.get("logo")), cx, 72, 56, [royal, or_, marine])
    nom_ecole = (contexte.get("ecole_nom") or "").upper()
    _centre(dessin, nom_ecole, cx, 112, _ajuster(dessin, nom_ecole, "texte_gras", 22, 600), marine)
    _centre(dessin, "ATTESTATION", cx, 150, _police("titre", 92, 700), marine, espacement=6)
    _centre(dessin, "D'EXCELLENCE", cx, 262, _police("titre", 30, 500), marine, espacement=2)
    _centre(dessin, "CETTE ATTESTATION EST FIÈREMENT DÉCERNÉE", cx, 312, _police("texte", 20), (60, 64, 80), espacement=1)
    _centre(dessin, "POUR SES RÉSULTATS REMARQUABLES À", cx, 342, _police("texte", 20), (60, 64, 80), espacement=1)
    nom = contexte.get("nom_complet", "")
    _texte_degrade(carte, nom, cx, 372, _ajuster(dessin, nom, "script", 92, 640), [(196, 140, 40), (226, 178, 80), (196, 140, 40)])
    dessin.line([*_p(cx - 300, 486), *_p(cx + 300, 486)], fill=or_, width=4 * ECHELLE)
    ligne_gras = (contexte.get("ligne_gras") or "").upper()
    _centre(dessin, ligne_gras, cx, 504, _ajuster(dessin, ligne_gras, "texte_gras", 26, 640), (20, 24, 40))
    _paragraphe(dessin, contexte.get("texte", ""), cx, 556, _police("texte", 18), (60, 64, 80), largeur=600, interligne=27, max_lignes=4)
    haut, bas = _decoupe_prix(contexte.get("prix"))
    _rosette(carte, cx, 830, 92, haut, bas)
    dessin = ImageDraw.Draw(carte)
    for sx, role, nom_sign in ((370, contexte.get("role_1", ""), contexte.get("signataire_1", "")),
                               (L - 370, contexte.get("role_2", ""), contexte.get("signataire_2", ""))):
        if nom_sign:
            _centre(dessin, nom_sign, sx, 786, _ajuster(dessin, nom_sign, "script", 46, 280), (40, 44, 70))
        dessin.line([*_p(sx - 150, 852), *_p(sx + 150, 852)], fill=or_, width=3 * ECHELLE)
        _centre(dessin, role.upper(), sx, 864, _ajuster(dessin, role.upper(), "texte", 20, 300), (30, 34, 50), espacement=1)
    if contexte.get("pied"):
        _centre(dessin, contexte["pied"], cx, 950, _police("texte", 14), (130, 136, 150))
    return carte


def _modele_emeraude(contexte):
    """Blanc et vert émeraude : panneau vert à droite strié d'or, rosette « PRIX » à rubans en
    haut à droite, logo et nom de l'école en haut, petite étoile dorée entre les signatures."""
    vert, vert_fonce = (16, 74, 54), (10, 50, 37)
    or_ = (196, 154, 66)
    carte = Image.new("RGB", (L * ECHELLE, H * ECHELLE), (252, 251, 247))
    dessin = ImageDraw.Draw(carte)
    # Panneau vert à droite, bord gauche en diagonale, bandes dorées parallèles.
    _poly(dessin, [(1130, 0), (L, 0), (L, H), (1010, H)], vert_fonce)
    _poly(dessin, [(1150, 0), (L, 0), (L, H), (1040, H)], vert)
    for dx, ep in ((0, 10), (34, 4), (56, 2)):
        _ligne(dessin, [(1115 - dx, 0), (995 - dx, H)], or_, ep)
    # Coin vert en bas à gauche, liseré doré.
    _poly(dessin, [(0, 830), (0, H), (210, H)], vert)
    _ligne(dessin, [(0, 790), (250, H)], or_, 4)
    # Cadre fin doré.
    dessin.rectangle([*_p(24, 24), *_p(L - 24, H - 24)], outline=or_, width=2 * ECHELLE)

    cx = 560
    _logo_ou_hexagones(carte, _ouvrir_image(contexte.get("logo")), cx, 70, 52, [vert, or_, vert_fonce])
    nom_ecole = (contexte.get("ecole_nom") or "").upper()
    _centre(dessin, nom_ecole, cx, 108, _ajuster(dessin, nom_ecole, "titre", 30, 720, 700), vert)
    _centre(dessin, "Excellence  •  Travail  •  Réussite", cx, 148, _police("texte_italique", 16), or_)
    _centre(dessin, "ATTESTATION", cx, 182, _police("titre", 100, 700), vert, espacement=6)
    _centre(dessin, "D'EXCELLENCE", cx, 304, _police("titre", 40, 600), or_, espacement=6)
    _centre(dessin, "CETTE ATTESTATION EST FIÈREMENT DÉCERNÉE À", cx, 366, _police("texte", 17), (70, 76, 72), espacement=2)
    nom = contexte.get("nom_complet", "")
    _centre(dessin, nom, cx, 392, _ajuster(dessin, nom, "script", 96, 760), (30, 40, 36))
    dessin.line([*_p(cx - 330, 506), *_p(cx + 330, 506)], fill=or_, width=3 * ECHELLE)
    _paragraphe(dessin, contexte.get("texte", ""), cx, 526, _police("texte", 18), (60, 66, 62), largeur=740, interligne=27, max_lignes=3)
    if contexte.get("date"):
        _centre(dessin, f"DÉLIVRÉE LE : {contexte['date']}", cx, 620, _police("texte_gras", 15), (90, 96, 92), espacement=1)
    for sx, role, nom_sign in ((285, contexte.get("role_1", ""), contexte.get("signataire_1", "")),
                               (835, contexte.get("role_2", ""), contexte.get("signataire_2", ""))):
        if nom_sign:
            _centre(dessin, nom_sign, sx, 690, _ajuster(dessin, nom_sign, "script", 48, 300), (30, 40, 36))
        dessin.line([*_p(sx - 150, 760), *_p(sx + 150, 760)], fill=(150, 156, 150), width=2)
        _centre(dessin, role, sx, 772, _ajuster(dessin, role, "texte_gras", 17, 300), (50, 56, 52))
    # Petite médaille étoilée entre les signatures.
    dessin.ellipse([*_p(cx - 40, 712), *_p(cx + 40, 792)], fill=or_)
    dessin.ellipse([*_p(cx - 32, 720), *_p(cx + 32, 784)], fill=vert_fonce)
    etoile = [_p(cx + (22 if i % 2 == 0 else 9) * math.cos(-math.pi / 2 + math.pi * i / 5), 752 + (22 if i % 2 == 0 else 9) * math.sin(-math.pi / 2 + math.pi * i / 5)) for i in range(10)]
    dessin.polygon(etoile, fill=OR_CLAIR)
    # Rosette « PRIX » avec rubans verts, en haut à droite sur le panneau.
    for dx in (-38, 38):
        _poly(dessin, [(1215 + dx - 30, 230), (1215 + dx + 30, 230), (1215 + dx + 30, 420), (1215 + dx, 392), (1215 + dx - 30, 420)], vert_fonce)
        _ligne(dessin, [(1215 + dx - 30, 230), (1215 + dx - 30, 420)], or_, 2)
    haut, bas = _decoupe_prix(contexte.get("prix"))
    _rosette(carte, 1215, 205, 118, haut, bas, texte=(20, 70, 50), laurier=False)
    dessin = ImageDraw.Draw(carte)
    if contexte.get("annee"):
        _centre(dessin, contexte["annee"], 1215, 450, _police("sceau", 22, 700), OR_CLAIR)
    if contexte.get("pied"):
        _centre(dessin, contexte["pied"], cx, 930, _police("texte", 14), (120, 126, 122))
    return carte


def _eventail(dessin, x, y, sx, sy, couleur):
    """Ornement art déco d'angle : équerres et éventail doré (sx, sy = sens vers l'intérieur)."""
    for k, d in enumerate((0, 22, 44)):
        _ligne(dessin, [(x + sx * d, y + sy * (210 - d * 1.5)), (x + sx * d, y + sy * d), (x + sx * (210 - d * 1.5), y + sy * d)], couleur, 3 - k * 0.6)
    ox, oy = x + sx * 70, y + sy * 70
    for i in range(5):
        a0 = math.radians(i * 18)
        a1 = math.radians(i * 18 + 12)
        pts = [(ox, oy)]
        for a in (a0, a1):
            pts.append((ox + sx * 120 * math.cos(a), oy + sy * 120 * math.sin(a)))
        _poly(dessin, pts, couleur)
    _ligne(dessin, [(ox + sx * 135, oy), (ox, oy + sy * 135)], couleur, 2)


def _modele_art_deco(contexte):
    """Bleu nuit art déco : vagues de soie bleue bordées d'or (haut gauche, bas droite),
    éventails dorés aux angles, médaille dorée à rubans en haut à gauche, une signature."""
    nuit = (8, 24, 54)
    carte = Image.new("RGB", (L * ECHELLE, H * ECHELLE), nuit)
    carte.paste(_degrade_vertical(carte.size, (14, 36, 76), (6, 18, 42)), (0, 0))
    halo = Image.new("L", carte.size, 0)
    ImageDraw.Draw(halo).ellipse([*_p(250, 120), *_p(1150, 870)], fill=80)
    carte.paste(Image.new("RGB", carte.size, (24, 54, 104)), (0, 0), halo.filter(ImageFilter.GaussianBlur(140 * ECHELLE)))
    dessin = ImageDraw.Draw(carte)
    # Vagues de soie bleue (dégradé simulé par bandes) bordées d'or.
    for decalage, couleur in ((0, (40, 70, 200)), (16, (28, 52, 170)), (30, (18, 36, 130))):
        haut = _bezier([(0, 160 - decalage), (220, 90 - decalage), (420, 40 - decalage), (640, -10)]) + [_p(640, 0), _p(0, 0)]
        dessin.polygon(haut, fill=couleur)
        bas = _bezier([(L, 830 + decalage), (L - 220, 900 + decalage), (L - 420, 950 + decalage), (L - 640, H + 10)]) + [_p(L - 640, H), _p(L, H)]
        dessin.polygon(bas, fill=couleur)
    _ligne(dessin, [(x / ECHELLE, y / ECHELLE) for x, y in _bezier([(0, 175), (220, 105), (420, 55), (660, 0)])], OR, 4)
    _ligne(dessin, [(x / ECHELLE, y / ECHELLE) for x, y in _bezier([(L, 815), (L - 220, 885), (L - 420, 935), (L - 660, H)])], OR, 4)
    _eventail(dessin, L - 60, 60, -1, 1, OR)
    _eventail(dessin, 60, H - 60, 1, -1, OR)
    # Médaille à rubans en haut à gauche.
    mx, my = 150, 190
    for dx in (-24, 24):
        _poly(dessin, [(mx + dx - 24, my + 20), (mx + dx + 24, my + 20), (mx + dx + 24 + dx * 0.4, my + 140), (mx + dx + dx * 0.4, my + 114), (mx + dx - 24 + dx * 0.4, my + 140)], OR_FONCE)
    _sceau(carte, mx, my, 58, "", "", OR)
    dessin = ImageDraw.Draw(carte)

    cx = L / 2
    _texte_degrade(carte, "ATTESTATION", cx, 112, _police("titre", 112, 600), [(214, 168, 84), (246, 214, 140), (214, 168, 84)], espacement=6)
    _centre(dessin, "D'EXCELLENCE", cx, 244, _police("titre", 40, 500), (236, 204, 140), espacement=3)
    _centre(dessin, "Cette attestation est fièrement décernée à", cx, 304, _police("titre", 28, 500), (226, 220, 206))
    nom = contexte.get("nom_complet", "")
    _texte_degrade(carte, nom, cx, 350, _ajuster(dessin, nom, "script", 110, 860), [(214, 168, 84), (250, 226, 170), (214, 168, 84)])
    y = 500
    dessin.line([*_p(cx - 470, y), *_p(cx + 470, y)], fill=OR, width=3 * ECHELLE)
    for dx in (-470, 470):
        dessin.polygon([_p(cx + dx, y - 14), _p(cx + dx + 14, y), _p(cx + dx, y + 14), _p(cx + dx - 14, y)], outline=OR, width=3 * ECHELLE)
    _paragraphe(dessin, contexte.get("texte", ""), cx, 540, _police("texte", 20), (230, 232, 238), largeur=900, interligne=32, max_lignes=3)
    nom_sign = contexte.get("signataire_1", "")
    if nom_sign:
        _texte_degrade(carte, nom_sign, cx, 680, _ajuster(dessin, nom_sign, "script", 58, 380), [(220, 222, 230), (250, 250, 252), (220, 222, 230)])
    dessin.line([*_p(cx - 150, 760), *_p(cx + 150, 760)], fill=(220, 222, 230), width=2 * ECHELLE)
    if nom_sign:
        _centre(dessin, nom_sign.upper(), cx, 772, _ajuster(dessin, nom_sign.upper(), "titre", 26, 400, 700), BLANC)
    _centre(dessin, contexte.get("role_1", ""), cx, 808, _police("texte_italique", 18), (210, 214, 224))
    if contexte.get("pied"):
        _centre(dessin, contexte["pied"], cx, 900, _police("texte", 14), (170, 178, 196))
    return carte


def _ouvrir_image(champ):
    """Logo de l'école (ImageField) en RGBA, ou None."""
    if not champ:
        return None
    try:
        champ.open("rb")
        image = Image.open(BytesIO(champ.read()))
        image.load()
        return image.convert("RGBA")
    except Exception:  # noqa: BLE001 — logo illisible : motif par défaut
        return None
    finally:
        try:
            champ.close()
        except Exception:  # noqa: BLE001
            pass


MODELES = {1: _modele_prestige, 2: _modele_geometrique, 3: _modele_emeraude, 4: _modele_art_deco}


def attestation_png(contexte: dict) -> bytes:
    """Image JPEG d'une attestation. Clés : nom_complet, texte (paragraphe), annee, prix,
    signataire_1 / role_1, signataire_2 / role_2, pied (école, date), ligne_gras (prix, classe,
    période), date, ecole_nom, logo (ImageField), modele (1 Prestige, 2 Géométrique, 3 Émeraude,
    4 Art déco — voir Ecole.modele_attestation). Les 4 modèles reprennent les modèles fournis
    par l'établissement, à l'identique (couleurs comprises)."""
    carte = MODELES.get(contexte.get("modele") or 1, _modele_prestige)(contexte)
    carte = carte.resize(SORTIE, Image.LANCZOS)
    tampon = BytesIO()
    carte.save(tampon, format="JPEG", quality=90, optimize=True)
    return tampon.getvalue()
