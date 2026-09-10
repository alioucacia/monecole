import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

/** Enregistre le service worker une seule fois au démarrage de l'app et renvoie une fonction
 * à appeler pour appliquer une mise à jour disponible (recharge la page avec la nouvelle version). */
let applyUpdateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
const updateListeners = new Set<() => void>();

export function initPwa() {
  applyUpdateFn = registerSW({
    onNeedRefresh() {
      updateListeners.forEach((fn) => fn());
    },
    onOfflineReady() {
      // L'application peut désormais fonctionner hors-ligne (coquille + dernières données API en cache).
    },
  });
}

export function applyPwaUpdate() {
  applyUpdateFn?.(true);
}

/** Signale quand une nouvelle version de l'app est prête (bandeau "Mettre à jour"). */
export function useSwUpdate() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const listener = () => setAvailable(true);
    updateListeners.add(listener);
    return () => {
      updateListeners.delete(listener);
    };
  }, []);
  return { available, applyUpdate: applyPwaUpdate };
}

/** Signale la perte/reprise de connexion réseau (bandeau "Mode hors-ligne"). */
export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}
