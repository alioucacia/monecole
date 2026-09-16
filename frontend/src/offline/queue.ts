/**
 * File d'actions en attente de synchronisation — cœur du mode hors-ligne (voir aussi
 * `offline/sync.ts` pour le rejeu, et `api/client.ts` pour le point d'entrée qui alimente cette
 * file automatiquement à chaque requête POST/PATCH/PUT/DELETE qui échoue faute de réseau).
 *
 * Persistée dans `localStorage` (survit à un rechargement/fermeture de l'onglet, contrairement à
 * une simple variable en mémoire) — volontairement PAS IndexedDB : les actions mises en file
 * sont de simples payloads JSON (jamais un envoi de fichier/photo, voir `EST_FICHIER` ci-dessous),
 * largement dans les limites de taille de localStorage, et une file d'attente n'a besoin d'aucune
 * requête complexe — juste lire/écrire une liste, ce que localStorage fait très bien.
 *
 * LIMITE CONNUE : un envoi de fichier (photo, justificatif, import Excel...) n'est jamais mis en
 * file — `FormData` n'est pas sérialisable en JSON de façon fiable (un `File` perdrait son
 * contenu). Ces actions échouent normalement hors-ligne, avec le message d'erreur habituel.
 */

export interface QueuedRequest {
  id: string;
  method: "post" | "patch" | "put" | "delete";
  url: string;
  data?: unknown;
  headers?: Record<string, string>;
  createdAt: number;
  /** Description lisible affichée dans le panneau de synchronisation (ex: "Nouveau paiement"). */
  label: string;
  attempts: number;
  lastError?: string;
}

const STORAGE_KEY = "offline_write_queue";

function lire(): QueuedRequest[] {
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    return brut ? (JSON.parse(brut) as QueuedRequest[]) : [];
  } catch {
    return [];
  }
}

function ecrire(liste: QueuedRequest[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(liste));
  } catch {
    // Quota localStorage dépassé (extrêmement improbable pour de simples payloads JSON) — la
    // file reste telle quelle en mémoire pour cette session, sans persistance ; pas de quoi
    // faire échouer l'action en cours pour autant.
  }
  notifier();
}

const abonnes = new Set<() => void>();

function notifier() {
  abonnes.forEach((fn) => fn());
}

/** S'abonne aux changements de la file (ajout/retrait/mise à jour) — utilisé par
 * `useOfflineQueue()` pour re-rendre l'indicateur de synchronisation. */
export function subscribe(fn: () => void): () => void {
  abonnes.add(fn);
  return () => abonnes.delete(fn);
}

export function getQueue(): QueuedRequest[] {
  return lire();
}

export function enqueue(entry: Omit<QueuedRequest, "id" | "createdAt" | "attempts">): QueuedRequest {
  const item: QueuedRequest = { ...entry, id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0 };
  const liste = lire();
  liste.push(item);
  ecrire(liste);
  return item;
}

export function removeFromQueue(id: string) {
  ecrire(lire().filter((e) => e.id !== id));
}

export function updateEntry(id: string, patch: Partial<QueuedRequest>) {
  ecrire(lire().map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export function clearQueue() {
  ecrire([]);
}
