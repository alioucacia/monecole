import { useOnlineStatus, useSwUpdate } from "../pwa";

/** Bandeaux globaux liés au mode application installable : indicateur hors-ligne et
 * invite à recharger quand une nouvelle version a été installée en arrière-plan. */
export function PwaBanners() {
  const online = useOnlineStatus();
  const { available, applyUpdate } = useSwUpdate();

  if (!online) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-ink-900 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        Mode hors-ligne — certaines actions seront synchronisées au retour du réseau.
      </div>
    );
  }

  if (available) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-3">
        ✨ Nouvelle version disponible
        <button onClick={applyUpdate} className="bg-white text-brand-700 rounded-full px-3 py-1 text-xs font-bold">
          Mettre à jour
        </button>
      </div>
    );
  }

  return null;
}
