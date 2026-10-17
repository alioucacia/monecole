import { useEffect, useRef } from "react";

/** Fréquence d'actualisation automatique des données affichées (toutes les pages). 30 s et non
 * plus 5 s : chaque page ouverte, chez chaque utilisateur, relançait ses requêtes (listes, totaux,
 * impayés, tableau de bord...) 12 fois par minute — une charge qui grandissait avec les données
 * de l'école jusqu'à ralentir tout le monde. */
export const INTERVALLE_ACTUALISATION_MS = 30000;

/** Pour les pages qui suivent une opération en cours (sauvegarde, restauration). */
export const INTERVALLE_SUIVI_MS = 5000;

/**
 * Rappelle `actualiser` toutes les `intervalleMs` (30 s par défaut) pour garder les données de la
 * page à jour sans la recharger : à `actualiser` de recharger SILENCIEUSEMENT (sans spinner, sans
 * toucher aux formulaires en cours de saisie).
 *
 * En pause quand l'onglet n'est pas visible ou hors connexion (inutile de solliciter le serveur
 * pour une page que personne ne regarde) ; actualisation immédiate au retour sur l'onglet.
 */
export function useAutoRefresh(actualiser: () => unknown, actif = true, intervalleMs = INTERVALLE_ACTUALISATION_MS) {
  const rappel = useRef(actualiser);
  rappel.current = actualiser;
  // Si `actualiser` renvoie une promesse, aucune nouvelle actualisation tant qu'elle n'est pas
  // terminée : une réponse lente ne doit pas empiler les requêtes sur le serveur.
  const enCours = useRef(false);

  useEffect(() => {
    if (!actif) return;
    const peutActualiser = () => document.visibilityState === "visible" && navigator.onLine !== false;
    const lancer = () => {
      if (enCours.current || !peutActualiser()) return;
      const resultat = rappel.current();
      if (resultat instanceof Promise) {
        enCours.current = true;
        resultat.catch(() => {}).finally(() => { enCours.current = false; });
      }
    };
    const id = setInterval(lancer, intervalleMs);
    const auRetour = lancer;
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [actif, intervalleMs]);
}
