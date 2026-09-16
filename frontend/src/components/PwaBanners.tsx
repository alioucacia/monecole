import { useState } from "react";

import { Button, Modal } from "./ui";
import { useOnlineStatus, useSwUpdate } from "../pwa";
import { removeFromQueue } from "../offline/queue";
import { syncQueue } from "../offline/sync";
import { useOfflineQueue } from "../offline/useOfflineQueue";

/** Bandeaux globaux liés au mode application installable : indicateur hors-ligne/actions en
 * attente de synchronisation, et invite à recharger quand une nouvelle version a été installée
 * en arrière-plan. */
export function PwaBanners() {
  const online = useOnlineStatus();
  const { available, applyUpdate } = useSwUpdate();
  const queue = useOfflineQueue();
  const [panelOpen, setPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await syncQueue();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      {!online && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-ink-900 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          Mode hors-ligne — certaines actions seront synchronisées au retour du réseau.
        </div>
      )}

      {online && queue.length > 0 && (
        <button
          onClick={() => setPanelOpen(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 hover:bg-amber-600 transition"
        >
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          {queue.length} action{queue.length > 1 ? "s" : ""} en attente de synchronisation
        </button>
      )}

      {!online && queue.length > 0 && (
        <button
          onClick={() => setPanelOpen(true)}
          className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-white text-ink-900 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg hover:bg-slate-50 transition"
        >
          Voir les {queue.length} action{queue.length > 1 ? "s" : ""} en attente
        </button>
      )}

      {available && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-3">
          ✨ Nouvelle version disponible
          <button onClick={applyUpdate} className="bg-white text-brand-700 rounded-full px-3 py-1 text-xs font-bold">
            Mettre à jour
          </button>
        </div>
      )}

      <Modal open={panelOpen} onClose={() => setPanelOpen(false)} title="Synchronisation">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {online
              ? "Actions enregistrées hors-ligne, en attente d'envoi au serveur."
              : "Ces actions seront envoyées automatiquement dès le retour de la connexion."}
          </p>

          {queue.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Rien en attente — tout est synchronisé.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 -mx-1">
              {queue.map((entree) => (
                <li key={entree.id} className="flex items-start justify-between gap-3 px-1 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">{entree.label}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(entree.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    {entree.lastError && (
                      <p className="text-xs text-rose-600 mt-1">⚠️ {entree.lastError}</p>
                    )}
                  </div>
                  <button
                    onClick={() => removeFromQueue(entree.id)}
                    className="text-xs font-semibold text-rose-600 hover:underline whitespace-nowrap shrink-0"
                  >
                    Abandonner
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPanelOpen(false)}>Fermer</Button>
            {online && queue.length > 0 && (
              <Button type="button" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
