import type { Cycle } from "./types";

/** Note maximale selon le cycle de la classe — même règle que `Classe.bareme` côté backend :
 * sur 10 en Préscolaire/Primaire, sur 20 en Collège/Lycée (et si le cycle n'est pas renseigné). */
export function baremeDuCycle(cycle: Cycle | "" | null | undefined): number {
  return cycle === "prescolaire" || cycle === "primaire" ? 10 : 20;
}
