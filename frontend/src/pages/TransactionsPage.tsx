import { useEffect, useState } from "react";

import { ecolesApi, paiementsEcolesApi, unwrapList } from "../api/services";
import { Button, EmptyState, PageHeader, Select, Spinner, Table } from "../components/ui";
import type { Ecole, PaiementEcole } from "../types";

const MODE_LABELS: Record<string, string> = {
  especes: "Espèces", virement: "Virement", cheque: "Chèque", carte_bancaire: "Carte bancaire",
  mobile_money: "Mobile Money (autre)", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", moov_money: "Moov Money",
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<PaiementEcole[]>([]);
  const [ecoles, setEcoles] = useState<Ecole[]>([]);
  const [ecoleFiltre, setEcoleFiltre] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ecolesApi.list({ page_size: 100 }).then(({ data }) => setEcoles(unwrapList(data)));
  }, []);

  const load = () => {
    setLoading(true);
    const params: Record<string, unknown> = { page_size: 200, ordering: "-mois" };
    if (ecoleFiltre) params.ecole = ecoleFiltre;
    paiementsEcolesApi.list(params).then(({ data }) => setTransactions(unwrapList(data))).finally(() => setLoading(false));
  };

  useEffect(load, [ecoleFiltre]);

  const total = transactions.reduce((acc, t) => acc + Number(t.montant), 0);

  return (
    <div>
      <PageHeader
        title="Historique des transactions"
        description="Tous les paiements d'abonnement encaissés, toutes écoles confondues."
        actions={<Button variant="secondary" onClick={() => paiementsEcolesApi.export(ecoleFiltre ? { ecole: ecoleFiltre } : {})}>⬇️ Exporter CSV</Button>}
      />

      <div className="flex items-center justify-between mb-6">
        <Select value={ecoleFiltre} onChange={(e) => setEcoleFiltre(e.target.value)} className="max-w-xs">
          <option value="">Toutes les écoles</option>
          {ecoles.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </Select>
        <p className="text-sm text-slate-500">
          Total affiché : <span className="font-bold text-ink-900">{money(total)}</span> ({transactions.length} transaction(s))
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : transactions.length === 0 ? (
        <EmptyState title="Aucune transaction enregistrée" />
      ) : (
        <Table headers={["École", "Mois", "Montant", "Mode", "Référence", "Encaissé le", "Enregistré par", "Facture"]}>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 font-medium text-slate-700">{ecoles.find((e) => e.id === t.ecole)?.nom ?? `École #${t.ecole}`}</td>
              <td className="px-4 py-3">{new Date(t.mois).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
              <td className="px-4 py-3 font-semibold">{money(t.montant)}</td>
              <td className="px-4 py-3 text-slate-500">{MODE_LABELS[t.mode_paiement] ?? t.mode_paiement}</td>
              <td className="px-4 py-3 text-xs font-mono text-slate-400">{t.reference || "—"}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{new Date(t.date_paiement).toLocaleDateString("fr-FR")}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{t.enregistre_par_nom || "—"}</td>
              <td className="px-4 py-3">
                <button
                  className="text-xs font-semibold text-brand-600 hover:underline"
                  onClick={() => paiementsEcolesApi.facture(t.id, `facture_${t.ecole}_${t.mois.slice(0, 7)}.pdf`)}
                >
                  🧾 PDF
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
