/**
 * Rejeu de la file d'actions hors-ligne (voir `offline/queue.ts`) dès que la connexion revient —
 * déclenché par l'évènement `online`, une vérification périodique (au cas où cet évènement ne se
 * déclenche pas de façon fiable, ex: reconnexion à un réseau sans accès internet réel), et
 * manuellement via `syncQueue()` (bouton "Synchroniser maintenant" du panneau hors-ligne).
 *
 * LIMITE CONNUE — ordre et dépendances entre actions en file : les actions sont rejouées dans
 * l'ordre où elles ont été créées, mais une action qui dépend de l'identifiant réel d'une autre
 * action ENCORE en attente (ex: enregistrer un paiement pour un élève créé hors-ligne, avant que
 * cette création n'ait elle-même été synchronisée) ne peut pas fonctionner : l'identifiant réel
 * n'existe pas encore au moment de la mise en file. Ce cas échoue avec une erreur explicite
 * plutôt que silencieusement — voir `lastError` sur l'entrée concernée dans le panneau.
 */
import { api, extractErrorMessage } from "../api/client";
import { emitToast } from "../context/ToastContext";
import { getQueue, removeFromQueue, updateEntry, type QueuedRequest } from "./queue";

let enCours = false;

async function rejouer(entree: QueuedRequest): Promise<"ok" | "reseau" | "erreur"> {
  try {
    await api.request({
      method: entree.method,
      url: entree.url,
      data: entree.data,
      headers: entree.headers,
      // Empêche `api/client.ts` de remettre CETTE tentative en file si elle échoue à son tour
      // faute de réseau — `syncQueue()` gère lui-même ce cas ci-dessous (arrêt du rejeu, l'entrée
      // originale reste en place telle quelle, sans doublon).
      _skipOfflineQueue: true,
    } as Parameters<typeof api.request>[0]);
    return "ok";
  } catch (err) {
    // Pas de réponse du tout = toujours hors-ligne (ou réseau à nouveau coupé pendant le rejeu) —
    // à distinguer d'un vrai refus du serveur (ex: 400 de validation), qui lui doit être signalé.
    const axiosLike = err as { response?: unknown };
    if (!axiosLike.response) return "reseau";
    updateEntry(entree.id, { attempts: entree.attempts + 1, lastError: extractErrorMessage(err) });
    return "erreur";
  }
}

/** Rejoue la file dans l'ordre, s'arrête dès qu'une entrée échoue faute de réseau (les suivantes
 * échoueraient de la même façon) ; une entrée en erreur "réelle" (refusée par le serveur) reste
 * en file, marquée, et le rejeu continue avec la suivante plutôt que de bloquer toute la file. */
export async function syncQueue(): Promise<void> {
  if (enCours || !navigator.onLine) return;
  const file = getQueue();
  if (file.length === 0) return;

  enCours = true;
  let synchronisees = 0;
  let enErreur = 0;
  try {
    for (const entree of file) {
      const resultat = await rejouer(entree);
      if (resultat === "ok") {
        removeFromQueue(entree.id);
        synchronisees += 1;
      } else if (resultat === "reseau") {
        break;
      } else {
        enErreur += 1;
      }
    }
  } finally {
    enCours = false;
  }

  if (synchronisees > 0) {
    emitToast("success", `${synchronisees} action${synchronisees > 1 ? "s" : ""} synchronisée${synchronisees > 1 ? "s" : ""}.`);
  }
  if (enErreur > 0) {
    emitToast("warning", `${enErreur} action${enErreur > 1 ? "s" : ""} en attente n'${enErreur > 1 ? "ont" : "a"} pas pu être synchronisée${enErreur > 1 ? "s" : ""} — voir le panneau de synchronisation.`);
  }
}

let initialise = false;

/** À appeler une seule fois au démarrage de l'app (voir main.tsx) — met en place le rejeu
 * automatique (retour de connexion + vérification périodique). */
export function initSyncEngine() {
  if (initialise) return;
  initialise = true;
  window.addEventListener("online", () => { syncQueue(); });
  // Filet de sécurité : `navigator.onLine`/l'évènement `online` reflètent la présence d'une
  // interface réseau, pas forcément un accès internet réel (ex: portail captif) — cette
  // vérification périodique rattrape les cas où l'évènement ne suffit pas.
  setInterval(() => { syncQueue(); }, 30_000);
  // Tentative immédiate au chargement (ex: l'app redémarre déjà connectée avec une file laissée
  // par la session précédente).
  syncQueue();
}
