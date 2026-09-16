import { useEffect, useState } from "react";

import { getQueue, subscribe, type QueuedRequest } from "./queue";

/** Réagit aux changements de la file d'actions hors-ligne (voir queue.ts) — utilisé par
 * l'indicateur de synchronisation (PwaBanners) et le panneau détaillé. */
export function useOfflineQueue(): QueuedRequest[] {
  const [queue, setQueue] = useState<QueuedRequest[]>(() => getQueue());

  useEffect(() => {
    const lire = () => setQueue(getQueue());
    lire();
    return subscribe(lire);
  }, []);

  return queue;
}
