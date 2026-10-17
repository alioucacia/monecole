import { useEffect, useState } from "react";

import type { PaiementHorsListe } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Table } from "./ui";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

function periodeCouverte(p: PaiementHorsListe) {
  if (p.mois) return new Date(p.mois).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return p.periode;
}

/** Paiements encaissés pour des élèves absents de la liste Élèves, avec cases à cocher et
 * suppression définitive — partagé par l'admin (Paiements) et le Super Admin (Écoles). */
export function PaiementsHorsListeTable({ paiements, onSupprimer }: {
  paiements: PaiementHorsListe[];
  /** Supprime les paiements `ids` ; la liste est rechargée par l'appelant. */
  onSupprimer: (ids: number[]) => Promise<{ supprimes: number; montant_total: string }>;
}) {
  const confirmer = useConfirm();
  const toast = useToast();
  const [coches, setCoches] = useState<Set<number>>(new Set());
  const [suppression, setSuppression] = useState(false);

  useEffect(() => {
    setCoches((prev) => new Set(paiements.filter((p) => prev.has(p.id)).map((p) => p.id)));
  }, [paiements]);

  if (paiements.length === 0) {
    return <EmptyState title="Aucun paiement hors liste" description="Tous les paiements sont rattachés à des élèves de la liste Élèves." />;
  }

  const tousCoches = coches.size === paiements.length;
  const basculer = (id: number) => setCoches((prev) => {
    const suivant = new Set(prev);
    if (suivant.has(id)) suivant.delete(id); else suivant.add(id);
    return suivant;
  });

  const supprimer = async (ids: number[]) => {
    const total = paiements.filter((p) => ids.includes(p.id)).reduce((s, p) => s + Number(p.montant), 0);
    const message = `Supprimer définitivement ${ids.length} paiement(s) pour un total de ${money(total)} ? `
      + "Ces montants disparaîtront de la Caisse et des rapports. Cette action est irréversible.";
    if (!(await confirmer(message, { danger: true }))) return;
    setSuppression(true);
    try {
      const { supprimes, montant_total } = await onSupprimer(ids);
      toast.success(`${supprimes} paiement(s) supprimé(s) — ${money(montant_total)}.`);
      setCoches(new Set());
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSuppression(false);
    }
  };

  const totalCoche = paiements.filter((p) => coches.has(p.id)).reduce((s, p) => s + Number(p.montant), 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-500">
          {paiements.length} paiement(s) · {money(paiements.reduce((s, p) => s + Number(p.montant), 0))}
        </span>
        <Button variant="danger" disabled={coches.size === 0 || suppression} onClick={() => supprimer([...coches])}>
          {suppression ? "Suppression…" : `🗑️ Supprimer la sélection${coches.size ? ` (${coches.size} · ${money(totalCoche)})` : ""}`}
        </Button>
      </div>
      <Table headers={[
        <input key="tous" type="checkbox" checked={tousCoches} aria-label="Tout cocher"
          onChange={() => setCoches(tousCoches ? new Set() : new Set(paiements.map((p) => p.id)))} />,
        "Élève", "Motif", "Frais", "Période", "Date", "Montant", "Mode", "Enregistré par", "",
      ]}>
        {paiements.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-2"><input type="checkbox" checked={coches.has(p.id)} onChange={() => basculer(p.id)} aria-label={`Cocher le paiement de ${p.eleve_nom}`} /></td>
            <td className="px-4 py-2">
              <div className="font-medium">{p.eleve_nom}</div>
              <div className="text-xs text-slate-500">{p.matricule}</div>
            </td>
            <td className="px-4 py-2"><Badge color={p.actif ? "amber" : "rose"}>{p.motif}</Badge></td>
            <td className="px-4 py-2">{p.type_frais}</td>
            <td className="px-4 py-2 text-slate-500">{periodeCouverte(p)}</td>
            <td className="px-4 py-2 whitespace-nowrap">{new Date(p.date_paiement).toLocaleDateString("fr-FR")}</td>
            <td className="px-4 py-2 font-semibold whitespace-nowrap">{money(p.montant)}</td>
            <td className="px-4 py-2">{p.mode_paiement}{p.reference && <div className="text-xs text-slate-500">{p.reference}</div>}</td>
            <td className="px-4 py-2 text-slate-500">{p.enregistre_par}</td>
            <td className="px-4 py-2">
              <button type="button" className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50"
                disabled={suppression} onClick={() => supprimer([p.id])}>Supprimer</button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
