import { useRef, useState } from "react";
import { emitToast } from "../context/ToastContext";

/** Côté le plus long d'une photo prise à la caméra, après redimensionnement : largement
 * suffisant pour une photo d'identité (fiche, badge, bulletin) et bien sous la limite de
 * TAILLE_MAX_PHOTO_MO — une photo brute de téléphone pèse souvent 3 à 6 Mo. */
const COTE_MAX_PX = 1024;

/** Redimensionne et recompresse une image en JPEG. En cas d'échec (format non décodable par
 * le navigateur, ex. HEIC sur certains Android), renvoie le fichier d'origine tel quel. */
async function compresserImage(fichier: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
    const ratio = Math.min(1, COTE_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return fichier;
    const nom = (fichier.name.replace(/\.[^.]+$/, "") || "photo") + ".jpg";
    return new File([blob], nom, { type: "image/jpeg" });
  } catch {
    return fichier;
  }
}

/** Deux boutons pour choisir une photo : depuis les fichiers / la galerie, ou en la prenant
 * directement avec la caméra du téléphone (attribut `capture`, qui ouvre l'appareil photo sur
 * mobile ; sur ordinateur, le navigateur propose simplement de choisir un fichier). La photo
 * prise à la caméra est redimensionnée avant d'être transmise à `onChange`. */
export default function PhotoPicker({ onChange, disabled }: { onChange: (fichier: File | null) => void; disabled?: boolean }) {
  const fichierRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [traitement, setTraitement] = useState(false);

  const bouton =
    "inline-flex items-center gap-1.5 py-1.5 px-3 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50";

  const recevoir = async (input: HTMLInputElement, depuisCamera: boolean) => {
    const brut = input.files?.[0] || null;
    // On vide le champ : choisir à nouveau le même fichier (ou reprendre une photo) redéclenche onChange.
    input.value = "";
    if (!brut) return;
    if (!brut.type.startsWith("image/")) {
      emitToast("error", "Le fichier choisi n'est pas une image.");
      return;
    }
    if (!depuisCamera) {
      onChange(brut);
      return;
    }
    setTraitement(true);
    try {
      onChange(await compresserImage(brut));
    } finally {
      setTraitement(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={bouton} disabled={disabled || traitement} onClick={() => fichierRef.current?.click()}>
        🖼️ Choisir une photo
      </button>
      <button type="button" className={bouton} disabled={disabled || traitement} onClick={() => cameraRef.current?.click()}>
        📷 {traitement ? "Traitement…" : "Prendre une photo"}
      </button>
      <input ref={fichierRef} type="file" accept="image/*" hidden onChange={(e) => recevoir(e.target, false)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => recevoir(e.target, true)} />
    </div>
  );
}
