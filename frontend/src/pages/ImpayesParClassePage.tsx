import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fraisApi } from "../api/services";
import { Badge, Card, EmptyState, PageHeader, Spinner } from "../components/ui";

type FicheEleve = { eleve_id: number; matricule: string; nom_complet: string; du: string; paye: string; solde: string };

type GroupeClasse = {
  classe_id: number | null;
  classe_nom: string;
  nb_impayes: number;
  nb_a_jour: number;
  total_solde: string;
  eleves: FicheEleve[];
  eleves_a_jour: FicheEleve[];
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

/** Impayés ET élèves à jour, classe par classe — le comptable/l'administrateur voient les deux
 * d'un coup d'œil (voir FraisViewSet.impayes_par_classe côté backend) plutôt que devoir
 * chercher qui a bien payé en éliminant la liste des impayés par déduction. */
export default function ImpayesParClassePage() {
  const [groupes, setGroupes] = useState<GroupeClasse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fraisApi.impayesParClasse().then(({ data }) => setGroupes(data)).finally(() => setLoading(false));
  }, []);

  const totalGeneral = groupes.reduce((acc, g) => acc + Number(g.total_solde), 0);
  const totalImpayes = groupes.reduce((acc, g) => acc + g.nb_impayes, 0);
  const totalAJour = groupes.reduce((acc, g) => acc + g.nb_a_jour, 0);

  return (
    <div>
      <PageHeader
        title="Situation des paiements par classe"
        description="Élèves à jour et élèves en impayé, regroupés par classe."
        actions={<Link to="/paiements" className="text-sm text-brand-600 font-medium hover:underline">← Retour aux paiements</Link>}
      />

      {!loading && (totalImpayes > 0 || totalAJour > 0) && (
        <p className="text-sm text-slate-500 mb-6">
          <span className="font-bold text-emerald-600">{totalAJour}</span> élève(s) à jour ·{" "}
          <span className="font-bold text-rose-600">{totalImpayes}</span> élève(s) en impayé, pour un solde total de{" "}
          <span className="font-bold text-rose-600">{money(totalGeneral)}</span>.
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : groupes.length === 0 ? (
        <EmptyState title="Aucun frais enregistré" description="Aucun élève n'a encore de frais suivi sur cette sélection." />
      ) : (
        <div className="space-y-6">
          {groupes.map((g) => (
            <Card key={g.classe_id ?? "sans-classe"}>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="font-bold text-ink-900">{g.classe_nom}</h3>
                <div className="flex items-center gap-3">
                  <Badge color="green">{g.nb_a_jour} à jour</Badge>
                  <Badge color="rose">{g.nb_impayes} impayé(s)</Badge>
                  {Number(g.total_solde) > 0 && <span className="font-semibold text-rose-600">{money(g.total_solde)}</span>}
                </div>
              </div>

              {g.eleves.length > 0 && (
                <ul className="divide-y divide-slate-100 mb-2">
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
              )}

              {g.eleves_a_jour.length > 0 && (
                <details className="mt-1">
                  <summary className="text-xs font-semibold text-emerald-700 cursor-pointer select-none">
                    Voir les {g.nb_a_jour} élève(s) à jour
                  </summary>
                  <ul className="divide-y divide-slate-100 mt-2">
                    {g.eleves_a_jour.map((e) => (
                      <li key={e.eleve_id} className="py-2 flex items-center justify-between text-sm">
                        <div>
                          <span className="font-medium text-slate-700">{e.nom_complet}</span>
                          <span className="ml-2 text-xs font-mono text-slate-400">{e.matricule}</span>
                        </div>
                        <span className="text-xs text-emerald-600 font-semibold">✓ {money(e.paye)} réglé(s)</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
