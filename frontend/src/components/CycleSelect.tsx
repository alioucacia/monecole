import type { ChangeEvent } from "react";

import { CYCLE_LABELS, ORDRE_CYCLES, type Classe, type Cycle } from "../types";
import { Select } from "./ui";

/** Sélecteur de cycle (Préscolaire/Primaire/Collège/Lycée), à poser à côté d'un sélecteur de
 * classe pour le filtrer — c'est le seul rôle de ce composant : il ne charge ni ne filtre rien
 * lui-même, la page qui l'utilise garde `classes.filter(c => !cycle || c.cycle === cycle)`. Un
 * seul composant partagé plutôt que ce même menu dupliqué dans chaque page qui liste des
 * classes (Notes, Présences, Paiements, Élèves, Emploi du temps...).
 *
 * Sans label par défaut (le texte de la première `<option>` s'auto-décrit, comme le reste des
 * filtres de ce type dans l'appli) — un `<Select>` avec label est plus haut de la hauteur de son
 * étiquette qu'un `<Select>` sans, donc passer `label="Cycle"` ne doit se faire que si CHAQUE
 * sélecteur voisin de la même rangée a lui aussi un label, sous peine de décalage vertical entre
 * les champs. */
export function CycleSelect({
  value, onChange, label = "", className,
}: {
  value: Cycle | "";
  onChange: (value: Cycle | "") => void;
  label?: string;
  className?: string;
}) {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as Cycle | "");
  return (
    <Select label={label} value={value} onChange={handleChange} className={className}>
      <option value="">— Tous les cycles —</option>
      {ORDRE_CYCLES.map((c) => <option key={c} value={c}>{CYCLE_LABELS[c as Exclude<Cycle, "">]}</option>)}
    </Select>
  );
}

/** Les `<option>` d'un `<select>` de classes, regroupées par cycle (`<optgroup>`) — pour les
 * sélecteurs qui affectent UNE classe (badge, groupe de révision, réunion...) plutôt que
 * filtrer une liste : pas besoin d'un second menu "Cycle" séparé, la classe reste simplement
 * rangée sous son cycle pour rester repérable même quand l'école en a beaucoup. Les classes
 * sans cycle assigné sont listées à part, en dernier. */
export function ClasseOptions({
  classes, label = (c) => c.nom, avecPlacesDisponibles = false,
}: {
  classes: Classe[];
  label?: (c: Classe) => string;
  /** N'affiche/désactive les classes complètes que dans un contexte d'AFFECTATION d'un élève à
   * une classe (ex: inscription) — pas pour un simple filtre ou un ciblage (annonce, badge...),
   * où une classe pleine reste un choix parfaitement valide. */
  avecPlacesDisponibles?: boolean;
}) {
  const texte = (c: Classe) => {
    const base = label(c);
    if (!avecPlacesDisponibles) return base;
    return c.places_disponibles <= 0 ? `${base} — Complet` : `${base} (${c.places_disponibles} place${c.places_disponibles > 1 ? "s" : ""})`;
  };
  return (
    <>
      {ORDRE_CYCLES.map((cycle) => {
        const classesCycle = classes.filter((c) => c.cycle === cycle);
        if (classesCycle.length === 0) return null;
        return (
          <optgroup key={cycle} label={CYCLE_LABELS[cycle as Exclude<Cycle, "">]}>
            {classesCycle.map((c) => (
              <option key={c.id} value={c.id} disabled={avecPlacesDisponibles && c.places_disponibles <= 0}>{texte(c)}</option>
            ))}
          </optgroup>
        );
      })}
      {classes.filter((c) => !c.cycle).map((c) => (
        <option key={c.id} value={c.id} disabled={avecPlacesDisponibles && c.places_disponibles <= 0}>{texte(c)}</option>
      ))}
    </>
  );
}
