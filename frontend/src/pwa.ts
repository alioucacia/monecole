import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

/** Enregistre le service worker une seule fois au démarrage de l'app et renvoie une fonction
 * à appeler pour appliquer une mise à jour disponible (recharge la page avec la nouvelle version). */
let applyUpdateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
const updateListeners = new Set<() => void>();

/** Délai avant le rechargement automatique une fois une nouvelle version détectée — laisse le
 * bandeau "Nouvelle version disponible" (voir PwaBanners) s'afficher un court instant plutôt
 * qu'un rechargement instantané et déroutant en pleine saisie. */
const DELAI_AUTO_MAJ_MS = 5_000;

export function initPwa() {
  applyUpdateFn = registerSW({
    onNeedRefresh() {
      updateListeners.forEach((fn) => fn());
      // Auto-refresh : applique la mise à jour toute seule, sans attendre un clic sur le
      // bandeau — un onglet laissé ouvert (accueil, salle des profs...) reste ainsi à jour.
      setTimeout(() => applyUpdateFn?.(true), DELAI_AUTO_MAJ_MS);
    },
    onOfflineReady() {
      // L'application peut désormais fonctionner hors-ligne (coquille + dernières données API en cache).
    },
    onRegistered(registration) {
      // Filet de sécurité pour un onglet resté ouvert longtemps sans navigation ni rechargement
      // (le navigateur ne revérifie pas toujours une nouvelle version tout seul) : redéclenche
      // la vérification une fois par heure — si une nouvelle version est trouvée, ceci ré-arme
      // `onNeedRefresh` ci-dessus comme au chargement normal de la page.
      if (!registration) return;
      setInterval(() => { registration.update(); }, 60 * 60 * 1000);
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

/** Chrome/Edge déclenchent cet évènement (non standardisé dans lib.dom.d.ts) quand l'app est
 * installable — capturé au chargement du script (avant même le montage de React, comme
 * `initPwa` ci-dessus) pour ne jamais rater l'évènement s'il arrive tôt. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installPromptEvent: BeforeInstallPromptEvent | null = null;
let installAvailable = false;
const installListeners = new Set<() => void>();

function notifyInstallListeners() {
  installListeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // supprime la mini-barre native du navigateur : on affiche notre propre popup
    installPromptEvent = e as BeforeInstallPromptEvent;
    installAvailable = true;
    notifyInstallListeners();
  });
  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    installAvailable = false;
    notifyInstallListeners();
  });
}

/** Signale quand l'app peut être proposée à l'installation, et expose `promptInstall()` pour
 * déclencher le popup natif du navigateur (voir InstallPromptModal, qui l'entoure d'une
 * explication). `available` redevient `false` après une installation réussie (évènement
 * `appinstalled` ci-dessus) ou après un premier appel à `promptInstall` (le navigateur n'autorise
 * qu'une seule utilisation de l'évènement capturé). */
export function useInstallPrompt() {
  const [available, setAvailable] = useState(installAvailable);
  useEffect(() => {
    const listener = () => setAvailable(installAvailable);
    installListeners.add(listener);
    return () => {
      installListeners.delete(listener);
    };
  }, []);

  const promptInstall = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!installPromptEvent) return "unavailable";
    const evt = installPromptEvent;
    installPromptEvent = null;
    installAvailable = false;
    notifyInstallListeners();
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    return outcome;
  };

  return { available, promptInstall };
}
