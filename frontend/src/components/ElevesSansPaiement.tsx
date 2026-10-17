import { useEffect, useState } from "react";

import type { EleveSansPaiement } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Select, Table } from "./ui";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

/** Élèves sur lesquels aucun paiement n'a été enregistré, avec filtres, cases à cocher et
 * suppression définitive — partagé par l'admin (Élèves) et le Super Admin (Écoles). */
export function ElevesSansPaiementTable({ eleves, onSupprimer }: {
  eleves: EleveSansPaiement[];
  /** Supprime les élèves `ids` ; la liste est rechargée par l'appelant. */
  onSupprimer: (ids: number[]) => Promise<{ supprimes: number }>;
}) {
  const confirmer = useConfirm();
  const toast = useToast();
  const [coches, setCoches] = useState<Set<number>>(new Set());
  const [suppression, setSuppression] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [statut, setStatut] = useState<"" | "actifs" | "inactifs">("");

  useEffect(() => {
    setCoches((prev) => new Set(eleves.filter((e) => prev.has(e.id)).map((e) => e.id)));
  }, [eleves]);

  if (eleves.length === 0) {
    return <EmptyState title="Aucun élève sans paiement" description="Chaque élève a au moins un paiement enregistré." />;
  }

  const terme = recherche.trim().toLowerCase();
  const visibles = eleves.filter((e) =>
    (statut === "" || (statut === "actifs") === e.actif)
    && (!terme || `${e.nom} ${e.matricule} ${e.classe}`.toLowerCase().includes(terme)),
  );
  const tousCoches = visibles.length > 0 && visibles.every((e) => coches.has(e.id));
  const basculer = (id: number) => setCoches((prev) => {
    const suivant = new Set(prev);
    if (suivant.has(id)) suivant.delete(id); else suivant.add(id);
    return suivant;
  });
  const basculerTous = () => setCoches((prev) => {
    const suivant = new Set(prev);
    visibles.forEach((e) => (tousCoches ? suivant.delete(e.id) : suivant.add(e.id)));
    return suivant;
  });

  const supprimer = async (ids: number[]) => {
    const message = `Supprimer définitivement ${ids.length} élève(s) et leur compte de connexion ? `
      + "Leurs frais, notes et présences seront aussi supprimés. Cette action est irréversible.";
    if (!(await confirmer(message, { danger: true }))) return;
    setSuppression(true);
    try {
      const { supprimes } = await onSupprimer(ids);
      toast.success(`${supprimes} élève(s) supprimé(s).`);
      setCoches(new Set());
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSuppression(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Rechercher (nom, matricule, classe)…" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="max-w-xs" />
        <Select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}>
          <option value="">Actifs et inactifs</option>
          <option value="actifs">Actifs seulement</option>
          <option value="inactifs">Inactifs seulement</option>
        </Select>
        <span className="text-sm text-slate-500">{visibles.length} / {eleves.length} élève(s)</span>
        <Button variant="danger" className="ml-auto" disabled={coches.size === 0 || suppression} onClick={() => supprimer([...coches])}>
          {suppression ? "Suppression…" : `🗑️ Supprimer la sélection${coches.size ? ` (${coches.size})` : ""}`}
        </Button>
      </div>
      <Table headers={[
        <input key="tous" type="checkbox" checked={tousCoches} onChange={basculerTous} aria-label="Tout cocher" />,
        "Élève", "Matricule", "Classe", "Statut", "Inscrit le", "Frais", "",
      ]}>
        {visibles.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2"><input type="checkbox" checked={coches.has(e.id)} onChange={() => basculer(e.id)} aria-label={`Cocher ${e.nom}`} /></td>
            <td className="px-4 py-2 font-medium">{e.nom}</td>
            <td className="px-4 py-2 text-slate-500">{e.matricule}</td>
            <td className="px-4 py-2">{e.classe ? `${e.classe} (${e.annee})` : <span className="text-slate-400">Sans classe</span>}</td>
            <td className="px-4 py-2"><Badge color={e.actif ? "green" : "rose"}>{e.actif ? "Actif" : "Inactif"}</Badge></td>
            <td className="px-4 py-2 whitespace-nowrap">{new Date(e.date_inscription).toLocaleDateString("fr-FR")}</td>
            <td className="px-4 py-2">{e.nombre_frais}</td>
            <td className="px-4 py-2">
              <button type="button" className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
                disabled={suppression} onClick={() => supprimer([e.id])}>Supprimer</button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
