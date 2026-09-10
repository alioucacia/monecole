import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fraisApi } from "../api/services";
import { Badge, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

type GroupeClasse = {
  classe_id: number | null;
  classe_nom: string;
  nb_impayes: number;
  total_solde: string;
  eleves: { eleve_id: number; matricule: string; nom_complet: string; du: string; paye: string; solde: string }[];
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function ImpayesParClassePage() {
  const [groupes, setGroupes] = useState<GroupeClasse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fraisApi.impayesParClasse().then(({ data }) => setGroupes(data)).finally(() => setLoading(false));
  }, []);

  const totalGeneral = groupes.reduce((acc, g) => acc + Number(g.total_solde), 0);
  const totalEleves = groupes.reduce((acc, g) => acc + g.nb_impayes, 0);

  return (
    <div>
      <PageHeader
        title="Impayés par classe"
        description="Élèves ayant un solde restant à payer, regroupés par classe."
        actions={<Link to="/paiements" className="text-sm text-brand-600 font-medium hover:underline">← Retour aux paiements</Link>}
      />

      {!loading && groupes.length > 0 && (
        <p className="text-sm text-slate-500 mb-6">
          <span className="font-bold text-ink-900">{totalEleves}</span> élève(s) en impayé, pour un solde total de{" "}
          <span className="font-bold text-rose-600">{money(totalGeneral)}</span>.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : groupes.length === 0 ? (
        <EmptyState title="Aucun impayé 🎉" description="Tous les frais enregistrés sont réglés." />
      ) : (
        <div className="space-y-6">
          {groupes.map((g) => (
            <Card key={g.classe_id ?? "sans-classe"}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-ink-900">{g.classe_nom}</h3>
                <div className="flex items-center gap-3">
                  <Badge color="rose">{g.nb_impayes} impayé(s)</Badge>
                  <span className="font-semibold text-rose-600">{money(g.total_solde)}</span>
                </div>
              </div>
              <ul className="divide-y divide-slate-100">
                {g.eleves.map((e) => (
                  <li key={e.eleve_id} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-slate-700">{e.nom_complet}</span>
                      <span className="ml-2 text-xs font-mono text-slate-400">{e.matricule}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-rose-600">{money(e.solde)}</span>
                      <span className="ml-2 text-xs text-slate-400">sur {money(e.du)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
