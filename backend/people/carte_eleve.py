"""Carte d'élève (format portrait, carte PVC CR80 54 × 85,6 mm) dessinée en image avec Pillow.

Le moteur PDF du projet (xhtml2pdf) ne sait dessiner ni courbes, ni photo ronde, ni formes
superposées : la carte est donc produite ici comme UNE image haute définition, puis simplement
posée dans les PDF (carte individuelle, carte PVC, planche d'une classe). Le rendu est ainsi
identique partout et fidèle au modèle : fond sombre, vagues aux couleurs de l'école en haut à
droite et en bas à gauche, logo + nom de l'école, photo ronde, nom, classe, informations et QR
code de vérification.

Toutes les coordonnées sont exprimées dans un repère de référence de 640 × 1015 (proportions
exactes de la carte), puis multipliées par `ECHELLE` pour dessiner en haute résolution
(anti-crénelage), et l'image finale est réduite à `SORTIE` (~600 dpi) avant encodage.
"""

import base64
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

LARGEUR, HAUTEUR = 640, 1015          # repère de référence (54 × 85,6 mm)
ECHELLE = 3                           # dessin en 1920 × 3045, puis réduction
SORTIE = (1280, 2030)                 # ~600 dpi à l'impression

_POLICES = Path(__import__("reportlab").__file__).resolve().parent / "fonts"


def _police(taille: float, gras: bool = True) -> ImageFont.FreeTypeFont:
    fichier = "VeraBd.ttf" if gras else "Vera.ttf"
    try:
        return ImageFont.truetype(str(_POLICES / fichier), max(1, round(taille * ECHELLE)))
    except OSError:
        return ImageFont.load_default(size=max(1, round(taille * ECHELLE)))


# --- Couleurs -----------------------------------------------------------------------------------

def _rgb(hexa: str, defaut=(20, 48, 79)) -> tuple[int, int, int]:
    hexa = (hexa or "").lstrip("#")
    if len(hexa) == 3:
        hexa = "".join(c * 2 for c in hexa)
    try:
        return tuple(int(hexa[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return defaut


def _melange(c1, c2, t: float):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def _luminance(c) -> float:
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255


def _palette(couleur_principale: str) -> dict:
    """Tons dérivés de la couleur principale de l'école : un fond assez sombre pour que le texte
    blanc reste lisible quelle que soit la couleur choisie, et des vagues plus claires."""
    base = _rgb(couleur_principale)
    fond = _melange(base, (0, 0, 0), 0.35)
    while _luminance(fond) > 0.16:
        fond = _melange(fond, (0, 0, 0), 0.25)
    return {
        "fond": fond,
        "ombre": _melange(fond, (0, 0, 0), 0.45),
        "vague_fonce": _melange(base, (255, 255, 255), 0.18),
        "vague_clair": _melange(base, (255, 255, 255), 0.5),
        "anneau": _melange(fond, (0, 0, 0), 0.55),
        "texte_logo": base if _luminance(base) < 0.6 else _melange(base, (0, 0, 0), 0.5),
        "blanc": (255, 255, 255),
    }


# --- Géométrie ----------------------------------------------------------------------------------

def _p(x, y):
    return (round(x * ECHELLE), round(y * ECHELLE))


def _bezier(p0, p1, p2, p3, pas=60):
    points = []
    for i in range(pas + 1):
        t = i / pas
        u = 1 - t
        x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0]
        y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]
        points.append(_p(x, y))
    return points


def _zone(courbe, coins):
    """Polygone délimité par une courbe de Bézier puis par les coins de la carte donnés."""
    return _bezier(*courbe) + [_p(*c) for c in coins]


def _dessiner_fond(dessin: ImageDraw.ImageDraw, pal: dict):
    dessin.rectangle([0, 0, LARGEUR * ECHELLE, HAUTEUR * ECHELLE], fill=pal["fond"])
    # Grande vague sombre en diagonale (effet de profondeur à gauche du modèle).
    dessin.polygon(_zone(((0, 120), (260, 20), (330, 380), (0, 760)), []), fill=pal["ombre"])
    # Haut droit : vague claire, vague foncée, puis coin blanc qui accueille le logo.
    dessin.polygon(_zone(((70, 0), (330, 70), (380, 330), (640, 400)), [(640, 0)]), fill=pal["vague_clair"])
    dessin.polygon(_zone(((150, 0), (360, 50), (420, 280), (640, 335)), [(640, 0)]), fill=pal["vague_fonce"])
    dessin.polygon(_zone(((215, 0), (360, 20), (430, 215), (640, 262)), [(640, 0)]), fill=pal["blanc"])
    # Bas gauche : même jeu de vagues, en miroir.
    dessin.polygon(_zone(((0, 770), (70, 850), (120, 960), (215, 1015)), [(0, 1015)]), fill=pal["vague_fonce"])
    dessin.polygon(_zone(((0, 820), (55, 890), (95, 975), (160, 1015)), [(0, 1015)]), fill=pal["vague_clair"])
    dessin.polygon(_zone(((0, 875), (40, 930), (65, 990), (100, 1015)), [(0, 1015)]), fill=pal["blanc"])


# --- Texte --------------------------------------------------------------------------------------

def _ajuster(dessin, texte: str, taille: float, largeur_max: float, gras=True) -> ImageFont.FreeTypeFont:
    """Plus grande police (≤ taille) qui fait tenir `texte` sur une ligne de `largeur_max`."""
    while taille > 8:
        police = _police(taille, gras)
        if dessin.textlength(texte, font=police) <= largeur_max * ECHELLE:
            return police
        taille -= 1
    return _police(taille, gras)


def _centre(dessin, texte, y, police, couleur):
    largeur = dessin.textlength(texte, font=police)
    dessin.text(((LARGEUR * ECHELLE - largeur) / 2, y * ECHELLE), texte, font=police, fill=couleur)


def _lignes(dessin, texte: str, police, largeur_max: float, nb_max=2) -> list[str]:
    mots, lignes, courante = texte.split(), [], ""
    for mot in mots:
        essai = f"{courante} {mot}".strip()
        if dessin.textlength(essai, font=police) <= largeur_max * ECHELLE or not courante:
            courante = essai
        else:
            lignes.append(courante)
            courante = mot
    if courante:
        lignes.append(courante)
    if len(lignes) > nb_max:
        lignes = lignes[:nb_max - 1] + [" ".join(lignes[nb_max - 1:])]
    return lignes


# --- Images -------------------------------------------------------------------------------------

def _ouvrir(image_field) -> Image.Image | None:
    if not image_field:
        return None
    try:
        image_field.open("rb")
        image = Image.open(BytesIO(image_field.read()))
        image.load()
        return ImageOps.exif_transpose(image).convert("RGBA")
    except Exception:  # noqa: BLE001 — photo/logo illisible : la carte est produite sans
        return None
    finally:
        try:
            image_field.close()
        except Exception:  # noqa: BLE001
            pass


def _photo_ronde(carte: Image.Image, photo: Image.Image | None, initiales: str, pal: dict):
    cx, cy, r_anneau, r_photo = 320, 318, 142, 120
    dessin = ImageDraw.Draw(carte)
    dessin.ellipse([*_p(cx - r_anneau, cy - r_anneau), *_p(cx + r_anneau, cy + r_anneau)], fill=pal["anneau"])
    # Liseré clair autour de la photo, comme sur le modèle.
    r_lisere = r_photo + 5
    dessin.ellipse([*_p(cx - r_lisere, cy - r_lisere), *_p(cx + r_lisere, cy + r_lisere)], fill=pal["vague_fonce"])
    d = 2 * r_photo * ECHELLE
    if photo is not None:
        rond = ImageOps.fit(photo, (d, d), Image.LANCZOS)
    else:
        rond = Image.new("RGBA", (d, d), pal["vague_clair"])
        ImageDraw.Draw(rond).text(
            (d / 2, d / 2), initiales or "?", font=_police(90), fill=pal["blanc"], anchor="mm",
        )
    masque = Image.new("L", (d, d), 0)
    ImageDraw.Draw(masque).ellipse([0, 0, d, d], fill=255)
    carte.paste(rond, _p(cx - r_photo, cy - r_photo), masque)


def _entete_ecole(carte: Image.Image, logo: Image.Image | None, nom_ecole: str, pal: dict):
    """Logo + nom de l'école dans le coin blanc en haut à droite (texte aligné à droite)."""
    dessin = ImageDraw.Draw(carte)
    bord_droit, largeur_texte = 622, 245
    police = _ajuster(dessin, nom_ecole, 21, largeur_texte * 2)
    lignes = _lignes(dessin, nom_ecole, police, largeur_texte)
    if any(dessin.textlength(l, font=police) > largeur_texte * ECHELLE for l in lignes):
        police = _ajuster(dessin, max(lignes, key=len), 21, largeur_texte)
    hauteur_ligne = police.size / ECHELLE * 1.2
    y0 = 22 + max(0, (2 - len(lignes)) * hauteur_ligne / 2)
    x_min = bord_droit * ECHELLE
    for i, ligne in enumerate(lignes):
        largeur = dessin.textlength(ligne, font=police)
        x = bord_droit * ECHELLE - largeur
        x_min = min(x_min, x)
        dessin.text((x, (y0 + i * hauteur_ligne) * ECHELLE), ligne, font=police, fill=pal["texte_logo"])
    if logo is not None:
        cote = 58 * ECHELLE
        logo = ImageOps.contain(logo, (cote, cote), Image.LANCZOS)
        x = int(x_min - 10 * ECHELLE - logo.width)
        y = int(20 * ECHELLE + (cote - logo.height) / 2)
        carte.paste(logo, (x, y), logo)


# --- Carte --------------------------------------------------------------------------------------

def carte_eleve_png(contexte: dict) -> bytes:
    """Image de la carte d'élève (JPEG, malgré le nom historique) pour le `contexte` de
    `people.views._contexte_badge_eleve` — clés utilisées : nom_complet, initiales, classe,
    matricule, date_naissance, annee_scolaire, valid_upto, ecole_nom, couleur_principale,
    photo (ImageField), logo (ImageField), qr_png (bytes)."""
    pal = _palette(contexte.get("couleur_principale"))
    carte = Image.new("RGB", (LARGEUR * ECHELLE, HAUTEUR * ECHELLE), pal["fond"])
    dessin = ImageDraw.Draw(carte)
    _dessiner_fond(dessin, pal)

    _entete_ecole(carte, _ouvrir(contexte.get("logo")), contexte.get("ecole_nom") or "", pal)
    _photo_ronde(carte, _ouvrir(contexte.get("photo")), contexte.get("initiales") or "", pal)

    dessin = ImageDraw.Draw(carte)
    nom = contexte.get("nom_complet") or ""
    _centre(dessin, nom, 480, _ajuster(dessin, nom, 52, 590), pal["blanc"])
    sous_titre = "Élève" + (f" — {contexte['classe']}" if contexte.get("classe") else "")
    _centre(dessin, sous_titre, 552, _ajuster(dessin, sous_titre, 28, 560), pal["blanc"])

    lignes = [
        ("Matricule", contexte.get("matricule") or "—"),
        ("Né(e) le", contexte.get("date_naissance") or "—"),
        ("Année", contexte.get("annee_scolaire") or "—"),
        ("Valable", f"jusqu'au {contexte['valid_upto']}" if contexte.get("valid_upto") else "—"),
    ]
    police_label = _police(24)
    for i, (label, valeur) in enumerate(lignes):
        y = (628 + i * 46) * ECHELLE
        dessin.text((80 * ECHELLE, y), label, font=police_label, fill=pal["blanc"])
        dessin.text((228 * ECHELLE, y), ":", font=police_label, fill=pal["blanc"])
        police_valeur = _ajuster(dessin, str(valeur), 24, 330)
        dessin.text((258 * ECHELLE, y), str(valeur), font=police_valeur, fill=pal["blanc"])

    # QR de vérification dans un cadre blanc, en bas au centre.
    cote, marge, y_qr = 132, 8, 832
    x_qr = (LARGEUR - cote) / 2
    dessin.rectangle([*_p(x_qr, y_qr), *_p(x_qr + cote, y_qr + cote)], fill=pal["blanc"])
    if contexte.get("qr_png"):
        qr = Image.open(BytesIO(contexte["qr_png"])).convert("RGB")
        interieur = (cote - 2 * marge) * ECHELLE
        qr = qr.resize((interieur, interieur), Image.NEAREST)
        carte.paste(qr, _p(x_qr + marge, y_qr + marge))

    carte = carte.resize(SORTIE, Image.LANCZOS)
    tampon = BytesIO()
    carte.save(tampon, format="JPEG", quality=92, optimize=True)
    return tampon.getvalue()


def carte_eleve_data_uri(contexte: dict) -> str:
    return f"data:image/jpeg;base64,{base64.b64encode(carte_eleve_png(contexte)).decode()}"
