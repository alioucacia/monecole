import { useEffect, useState } from "react";

/**
 * Décompte en secondes pour les actions à ne pas répéter trop vite (ex: renvoyer un code OTP —
 * voir `DELAI_MIN_RENVOI_SECONDES` côté backend, `accounts/services.py`, avec lequel `duree`
 * doit rester alignée : redemander un code avant l'expiration de ce délai ne ferait que
 * redemander le MÊME code déjà envoyé, sans le renvoyer réellement).
 *
 * Démarre le décompte dès le montage (le premier code vient d'être envoyé quand l'écran OTP
 * s'affiche) ; `relancer()` le relance à `duree` secondes après un nouvel envoi.
 */
export function useCooldown(duree: number) {
  const [restant, setRestant] = useState(duree);

  useEffect(() => {
    if (restant <= 0) return;
    const id = setTimeout(() => setRestant((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [restant]);

  return { restant, pret: restant <= 0, relancer: () => setRestant(duree) };
}
