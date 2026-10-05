import { useEffect, useRef } from "react";

/** Fréquence d'actualisation automatique des données affichées (toutes les pages). */
export const INTERVALLE_ACTUALISATION_MS = 5000;

/**
 * Rappelle `actualiser` toutes les `intervalleMs` (5 s par défaut) pour garder les données de la
 * page à jour sans la recharger : à `actualiser` de recharger SILENCIEUSEMENT (sans spinner, sans
 * toucher aux formulaires en cours de saisie).
 *
 * En pause quand l'onglet n'est pas visible ou hors connexion (inutile de solliciter le serveur
 * pour une page que personne ne regarde) ; actualisation immédiate au retour sur l'onglet.
 */
export function useAutoRefresh(actualiser: () => unknown, actif = true, intervalleMs = INTERVALLE_ACTUALISATION_MS) {
  const rappel = useRef(actualiser);
  rappel.current = actualiser;

  useEffect(() => {
    if (!actif) return;
    const peutActualiser = () => document.visibilityState === "visible" && navigator.onLine !== false;
    const id = setInterval(() => {
      if (peutActualiser()) rappel.current();
    }, intervalleMs);
    const auRetour = () => {
      if (peutActualiser()) rappel.current();
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [actif, intervalleMs]);
}
