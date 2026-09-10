import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { journalActiviteApi, unwrapList } from "../api/services";
import { Badge, EmptyState, PageHeader, Spinner, Table } from "../components/ui";
import type { JournalActiviteEntry } from "../types";

const ACTION_COLORS: Record<string, "green" | "rose" | "amber" | "brand" | "slate"> = {
  ecole_creee: "green",
  ecole_modifiee: "brand",
  ecole_suspendue: "rose",
  ecole_reactivee: "green",
  paiement_enregistre: "amber",
};

export default function JournalActivitePage() {
  const [entries, setEntries] = useState<JournalActiviteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    journalActiviteApi.list({ page_size: 200 }).then(({ data }) => setEntries(unwrapList(data))).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Journal d'activité" description="Historique des actions du Super Admin sur la plateforme." />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : entries.length === 0 ? (
        <EmptyState title="Aucune activité enregistrée" />
      ) : (
        <Table headers={["Date", "Action", "École", "Détails", "Effectué par"]}>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-3 text-slate-500 text-xs">{new Date(e.horodatage).toLocaleString("fr-FR")}</td>
              <td className="px-4 py-3"><Badge color={ACTION_COLORS[e.action] || "slate"}>{e.action_display}</Badge></td>
              <td className="px-4 py-3 font-medium text-slate-700">
                {e.ecole ? <Link to={`/ecoles/${e.ecole}`} className="hover:underline hover:text-brand-700">{e.ecole_nom}</Link> : "—"}
              </td>
              <td className="px-4 py-3 text-slate-500 text-sm">{e.details || "—"}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{e.acteur_nom || "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
