import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { classesApi, fraisApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, EmptyState, PageHeader, Select, Spinner, Table } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import type { Classe, Cycle, SuiviMensuelClasse } from "../types";

const STATUT_BADGE: Record<string, { label: string; color: "green" | "amber" | "rose" }> = {
  paye: { label: "Payé", color: "green" },
  partiel: { label: "Partiel", color: "amber" },
  non_paye: { label: "Non payé", color: "rose" },
};

function moisLabel(mois: string) {
  // "2026-09" -> "Sept. 2026"
  const [annee, m] = mois.split("-");
  const date = new Date(Number(annee), Number(m) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

export default function SuiviMensuelPage() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  const [classeId, setClasseId] = useState<string>("");
  const [suivi, setSuivi] = useState<SuiviMensuelClasse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    classesApi.list({ page_size: 200 }).then(({ data }) => {
      const liste = unwrapList(data);
      setClasses(liste);
      if (liste.length > 0) setClasseId(liste[0].id.toString());
    });
  }, []);

  useEffect(() => {
    if (!classeId) return;
    setLoading(true);
    setError("");
    fraisApi.suiviMensuelClasse(Number(classeId))
      .then(({ data }) => setSuivi(data))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [classeId]);

  // Un élève exonéré de mensualité (Fondation gratuite, inscription seulement) a un tableau `mois`
  // vide — on ne peut donc pas se baser sur le premier élève de la liste pour connaître les
  // colonnes : on prend le premier qui a effectivement une mensualité à suivre.
  const tousLesMois = suivi?.eleves.find((e) => e.mois.length > 0)?.mois.map((m) => m.mois) ?? [];

  return (
    <div>
      <PageHeader
        title="Suivi mensuel des paiements"
        description="Frais mensuels (ex : scolarité) — statut payé / partiel / non payé, mois par mois, par élève."
        actions={<Link to="/paiements" className="text-sm text-brand-600 font-medium hover:underline">← Retour aux paiements</Link>}
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <CycleSelect
          label="Cycle"
          value={cycleFiltre}
          onChange={(c) => {
            setCycleFiltre(c);
            const premiere = classes.find((cl) => !c || cl.cycle === c);
            setClasseId(premiere ? String(premiere.id) : "");
          }}
          className="max-w-xs"
        />
        <Select label="Classe" value={classeId} onChange={(e) => setClasseId(e.target.value)} className="max-w-xs">
          {classes.filter((c) => !cycleFiltre || c.cycle === cycleFiltre).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>
      ) : !suivi || suivi.eleves.length === 0 ? (
        <EmptyState title="Aucun élève" description="Cette classe ne compte aucun élève actif, ou aucun frais mensuel n'est configuré." />
      ) : tousLesMois.length === 0 ? (
        <EmptyState
          title="Aucun frais mensuel"
          description="Aucun élève de cette classe n'a de frais lié à un type de frais marqué « mensuel ». Configurez-le depuis Paiements → Types de frais."
        />
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-4">
            Année scolaire <span className="font-semibold text-ink-900">{suivi.annee_scolaire}</span> — {suivi.eleves.length} élève(s).
          </p>
          <div className="overflow-x-auto">
            <Table headers={["Élève", "Matricule", "Catégorie", "Mois impayés", ...tousLesMois.map(moisLabel)]}>
              {suivi.eleves.map((e) => {
                const parMois = new Map(e.mois.map((m) => [m.mois, m]));
                const nbImpayes = e.mois.filter((m) => m.statut === "non_paye").length;
                const nbPartiels = e.mois.filter((m) => m.statut === "partiel").length;
                return (
                  <tr key={e.eleve_id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                      <Link to={`/eleves/${e.eleve_id}`} className="hover:underline">{e.eleve_nom}</Link>
                      <button
                        onClick={() => fraisApi.suiviMensuelPdf(e.eleve_id, `suivi_mensuel_${e.matricule}.pdf`)}
                        title="Rapport de suivi (PDF)"
                        className="ml-1.5 text-slate-300 hover:text-brand-600 transition"
                      >
                        📄
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-slate-400 whitespace-nowrap">{e.matricule}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {e.categorie_paiement !== "standard" ? (
                        <Badge color="amber">{e.categorie_paiement_display}</Badge>
                      ) : (
                        <span className="text-slate-300">Standard</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {nbImpayes === 0 && nbPartiels === 0 ? (
                        <span className="text-emerald-600 text-xs">✓ à jour</span>
                      ) : (
                        <div className="flex gap-1.5">
                          {nbImpayes > 0 && <Badge color="rose">{nbImpayes} impayé{nbImpayes > 1 ? "s" : ""}</Badge>}
                          {nbPartiels > 0 && <Badge color="amber">{nbPartiels} partiel{nbPartiels > 1 ? "s" : ""}</Badge>}
                        </div>
                      )}
                    </td>
                    {tousLesMois.map((mois) => {
                      const m = parMois.get(mois);
                      return (
                        <td key={mois} className="px-2 py-2.5 text-center">
                          {m ? (
                            <Badge color={STATUT_BADGE[m.statut].color}>{STATUT_BADGE[m.statut].label}</Badge>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
