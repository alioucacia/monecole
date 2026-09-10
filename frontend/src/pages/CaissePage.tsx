import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { caisseApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, EmptyState, PageHeader, Spinner, StatCard, Table } from "../components/ui";
import type { CaisseRapport } from "../types";

function money(value: string | number) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Raccourcis de période — évite d'avoir à choisir deux dates à la main pour le cas le plus
 * courant (le rapport journalier, "Aujourd'hui", est le réglage par défaut de la page). */
function calculerPeriode(raccourci: "jour" | "semaine" | "mois"): { debut: string; fin: string } {
  const aujourdhui = new Date();
  if (raccourci === "jour") return { debut: iso(aujourdhui), fin: iso(aujourdhui) };
  if (raccourci === "semaine") {
    const jour = aujourdhui.getDay() || 7; // lundi=1..dimanche=7
    const debut = new Date(aujourdhui);
    debut.setDate(aujourdhui.getDate() - jour + 1);
    return { debut: iso(debut), fin: iso(aujourdhui) };
  }
  const debut = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1);
  return { debut: iso(debut), fin: iso(aujourdhui) };
}

type Raccourci = "jour" | "semaine" | "mois" | "personnalise";
const RACCOURCIS: { value: Raccourci; label: string }[] = [
  { value: "jour", label: "Aujourd'hui" },
  { value: "semaine", label: "Cette semaine" },
  { value: "mois", label: "Ce mois" },
  { value: "personnalise", label: "Personnalisé" },
];

export default function CaissePage() {
  const [raccourci, setRaccourci] = useState<Raccourci>("jour");
  const [dateDebut, setDateDebut] = useState(() => calculerPeriode("jour").debut);
  const [dateFin, setDateFin] = useState(() => calculerPeriode("jour").fin);
  const [rapport, setRapport] = useState<CaisseRapport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const choisirRaccourci = (r: Raccourci) => {
    setRaccourci(r);
    if (r !== "personnalise") {
      const { debut, fin } = calculerPeriode(r);
      setDateDebut(debut);
      setDateFin(fin);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    caisseApi.get({ date_debut: dateDebut, date_fin: dateFin })
      .then(({ data }) => setRapport(data))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [dateDebut, dateFin]);

  const handleTelechargerPdf = () => {
    const nomFichier = dateDebut === dateFin ? `rapport_caisse_${dateDebut}.pdf` : `rapport_caisse_${dateDebut}_${dateFin}.pdf`;
    caisseApi.pdf({ date_debut: dateDebut, date_fin: dateFin }, nomFichier).catch(() => {});
  };

  return (
    <div>
      <PageHeader
        title="Caisse"
        description="Rentrées (paiements élèves) et sorties (dépenses) de l'établissement — le rapport journalier par défaut."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/depenses" className="text-sm text-brand-600 font-medium hover:underline self-center">+ Nouvelle dépense</Link>
            <Button variant="secondary" onClick={handleTelechargerPdf} disabled={!rapport}>⬇️ Télécharger le rapport (PDF)</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex gap-1.5 bg-slate-100 rounded-full p-1">
          {RACCOURCIS.map((r) => (
            <button
              key={r.value}
              onClick={() => choisirRaccourci(r.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${raccourci === r.value ? "bg-white text-brand-700 shadow-soft" : "text-slate-500 hover:text-slate-700"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {raccourci === "personnalise" && (
          <>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-1">Du</span>
              <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-1">Au</span>
              <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </label>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>
      ) : !rapport ? null : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard label="Rentrées" value={money(rapport.total_rentrees)} icon="⬇️" accent="green" />
            <StatCard label="Sorties" value={money(rapport.total_sorties)} icon="⬆️" accent="rose" />
            <StatCard label="Solde" value={money(rapport.solde)} icon="⚖️" accent={Number(rapport.solde) >= 0 ? "brand" : "rose"} />
          </div>

          <h3 className="text-sm font-bold text-ink-900 mb-2">Rentrées — Paiements des élèves</h3>
          {rapport.rentrees.length === 0 ? (
            <EmptyState title="Aucune rentrée sur cette période" />
          ) : (
            <Table headers={["Date", "Élève", "Type de frais", "Mode", "Enregistré par", "Montant"]}>
              {rapport.rentrees.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-slate-500">{new Date(r.date).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{r.eleve_nom}</td>
                  <td className="px-4 py-3">{r.type_frais_nom}</td>
                  <td className="px-4 py-3">{r.mode_paiement_display}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{r.enregistre_par_nom || "—"}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">+{money(r.montant)}</td>
                </tr>
              ))}
            </Table>
          )}

          <h3 className="text-sm font-bold text-ink-900 mb-2 mt-8">Sorties — Dépenses</h3>
          {rapport.sorties.length === 0 ? (
            <EmptyState title="Aucune sortie sur cette période" />
          ) : (
            <Table headers={["Date", "Catégorie", "Motif", "Responsable", "Montant"]}>
              {rapport.sorties.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-slate-500">{new Date(s.date).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3">{s.categorie_nom}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{s.motif}</td>
                  <td className="px-4 py-3">{s.responsable}</td>
                  <td className="px-4 py-3 font-bold text-rose-600">−{money(s.montant)}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div>
  );
}
