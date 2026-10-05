import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { anneesApi, unwrapList } from "../api/services";
import { definirAnneeVue } from "../api/client";
import type { AnneeScolaire } from "../types";
import { useAuth } from "./AuthContext";

/** Année choisie par l'administrateur, mémorisée d'une session à l'autre sur ce navigateur. */
const ANNEE_VUE_KEY = "ecole_annee_vue";

interface AnneeContextValue {
  /** Années scolaires de l'établissement (vide pour le Super Admin). */
  annees: AnneeScolaire[];
  /** Année affichée dans toute l'application — l'année active, sauf choix de l'administrateur. */
  annee: AnneeScolaire | null;
  anneeId: number | null;
  /** Seul l'administrateur peut consulter une autre année que l'année active. */
  peutChanger: boolean;
  setAnneeId: (id: number) => void;
  /** Recharge la liste (ex: après création d'une année ou changement de l'année active). */
  recharger: () => void;
}

const AnneeContext = createContext<AnneeContextValue | undefined>(undefined);

function lireChoix(): number | null {
  try {
    const valeur = Number(localStorage.getItem(ANNEE_VUE_KEY));
    return Number.isInteger(valeur) && valeur > 0 ? valeur : null;
  } catch {
    return null;
  }
}

function ecrireChoix(id: number | null) {
  try {
    if (id) localStorage.setItem(ANNEE_VUE_KEY, String(id));
    else localStorage.removeItem(ANNEE_VUE_KEY);
  } catch {
    // stockage indisponible : le choix ne sera simplement pas mémorisé
  }
}

/** Les données affichées le sont toujours pour UNE année scolaire. Le choix de l'administrateur
 * est envoyé au serveur avec chaque requête (paramètre `annee_vue`, voir api/client.ts et
 * backend/academics/annee.py) ; les autres rôles restent sur l'année active. */
export function AnneeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const actif = !!user && user.role !== "superadmin";
  const peutChanger = user?.role === "admin";
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [anneeId, setAnneeIdState] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!actif) {
      setAnnees([]);
      setAnneeIdState(null);
      definirAnneeVue(null);
      return;
    }
    anneesApi.list().then(({ data }) => {
      const liste = unwrapList(data);
      setAnnees(liste);
      const active = liste.find((a) => a.active) ?? liste[0] ?? null;
      const choix = peutChanger ? lireChoix() : null;
      const retenue = liste.find((a) => a.id === choix) ?? active;
      // L'année active est la valeur par défaut côté serveur : inutile de l'envoyer.
      definirAnneeVue(peutChanger && retenue && retenue.id !== active?.id ? retenue.id : null);
      setAnneeIdState(retenue?.id ?? null);
    }).catch(() => {});
  }, [actif, peutChanger, user?.id, version]);

  const setAnneeId = useCallback((id: number) => {
    if (!peutChanger) return;
    const active = annees.find((a) => a.active);
    ecrireChoix(id === active?.id ? null : id);
    definirAnneeVue(id === active?.id ? null : id);
    setAnneeIdState(id);
  }, [annees, peutChanger]);

  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  const annee = annees.find((a) => a.id === anneeId) ?? null;

  return (
    <AnneeContext.Provider value={{ annees, annee, anneeId, peutChanger, setAnneeId, recharger }}>
      {children}
    </AnneeContext.Provider>
  );
}

export function useAnnee() {
  const ctx = useContext(AnneeContext);
  if (!ctx) throw new Error("useAnnee doit être utilisé à l'intérieur d'un AnneeProvider");
  return ctx;
}
