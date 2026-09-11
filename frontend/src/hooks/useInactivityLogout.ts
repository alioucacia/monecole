import { useEffect, useRef } from "react";

import { emitToast } from "../context/ToastContext";

/** Déconnecte automatiquement après ce délai sans aucune activité (souris, clavier, tactile,
 * défilement) — protège un poste partagé (salle des profs, accueil...) laissé ouvert sans
 * surveillance sur une session encore valide. */
const DELAI_INACTIVITE_MS = 5 * 60 * 1000;

const EVENEMENTS_ACTIVITE = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "wheel"] as const;

/**
 * Appelle `logout` après `DELAI_INACTIVITE_MS` sans interaction utilisateur sur la page. Le
 * minuteur est réarmé (pas recréé) à chaque activité pour rester léger même sur une session
 * ouverte plusieurs heures. À monter une seule fois, uniquement pour un utilisateur connecté
 * (voir `AppLayout`, rendu seulement à l'intérieur de `ProtectedRoute`).
 */
export function useInactivityLogout(logout: () => void) {
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    let minuteur: ReturnType<typeof setTimeout>;

    const rearmer = () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => {
        emitToast("info", "Session fermée après 5 minutes d'inactivité.");
        logoutRef.current();
      }, DELAI_INACTIVITE_MS);
    };

    rearmer();
    EVENEMENTS_ACTIVITE.forEach((evt) => window.addEventListener(evt, rearmer, { passive: true }));

    return () => {
      clearTimeout(minuteur);
      EVENEMENTS_ACTIVITE.forEach((evt) => window.removeEventListener(evt, rearmer));
    };
  }, []);
}
