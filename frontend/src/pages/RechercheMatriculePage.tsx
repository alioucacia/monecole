import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { elevesApi, fraisApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner } from "../components/ui";
import type { EleveProfile, SuiviMensuelMois } from "../types";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function RechercheMatriculePage() {
  const [matricule, setMatricule] = useState("");
  const [recherche, setRecherche] = useState(false);
  const [error, setError] = useState("");
  const [candidats, setCandidats] = useState<EleveProfile[]>([]);

  const [eleve, setEleve] = useState<EleveProfile | null>(null);
  const [anneeScolaire, setAnneeScolaire] = useState("");
  const [mois, setMois] = useState<SuiviMensuelMois[]>([]);
  const [chargementMois, setChargementMois] = useState(false);
  const [erreurMois, setErreurMois] = useState("");

  const chargerSuivi = (candidat: EleveProfile) => {
    setEleve(candidat);
    setCandidats([]);
    setChargementMois(true);
    setErreurMois("");
    setMois([]);
    fraisApi.suiviMensuel(candidat.id)
      .then(({ data }) => { setMois(data.mois); setAnneeScolaire(data.annee_scolaire); })
      .catch((err) => setErreurMois(extractErrorMessage(err)))
      .finally(() => setChargementMois(false));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matricule.trim()) return;
    setRecherche(true);
    setError("");
    setEleve(null);
    setCandidats([]);
    try {
      const { data } = await elevesApi.list({ search: matricule.trim(), page_size: 10 });
      const resultats = unwrapList(data);
      // Correspondance exacte prioritaire (ex: scan d'un badge) — sinon la recherche, faite sur
      // nom/prénom/matricule à la fois (voir EleveProfileViewSet.search_fields), peut remonter
      // des élèves dont le matricule ne fait que CONTENIR la saisie.
      const exact = resultats.find((el) => el.matricule.toLowerCase() === matricule.trim().toLowerCase());
      if (exact) {
        chargerSuivi(exact);
      } else if (resultats.length === 1) {
        chargerSuivi(resultats[0]);
      } else if (resultats.length === 0) {
        setError(`Aucun élève trouvé pour « ${matricule.trim()} ».`);
      } else {
        setCandidats(resultats);
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRecherche(false);
    }
  };

  const moisImpayes = mois.filter((m) => m.statut === "non_paye");
  const moisPartiels = mois.filter((m) => m.statut === "partiel");
  const labelMois = (m: SuiviMensuelMois) => new Date(`${m.mois}-01`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="Vérification par matricule"
        description="Retrouvez un élève par son matricule pour vérifier ses mois payés et impayés (scolarité)."
        actions={<Link to="/paiements" className="text-sm text-brand-600 font-medium hover:underline">← Retour aux paiements</Link>}
      />

      <Card className="mb-6">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <Input
            label="Matricule de l'élève"
            placeholder="Ex : OUBA38"
            value={matricule}
            onChange={(e) => setMatricule(e.target.value)}
            className="max-w-xs"
            autoFocus
          />
          <Button type="submit" disabled={recherche || !matricule.trim()}>{recherche ? "Recherche…" : "🔍 Rechercher"}</Button>
        </form>
        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 mt-3">{error}</p>}
      </Card>

      {candidats.length > 0 && (
        <Card className="mb-6">
          <h3 className="font-bold text-ink-900 mb-3">Plusieurs élèves correspondent — précisez :</h3>
          <ul className="divide-y divide-slate-100">
            {candidats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => chargerSuivi(c)}
                  className="w-full py-2.5 flex items-center justify-between text-left hover:text-brand-700"
                >
                  <span className="font-medium text-slate-700">{c.user.first_name} {c.user.last_name}</span>
                  <span className="text-xs font-mono text-slate-400">{c.matricule} — {c.classe_nom || "Sans classe"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {eleve && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-ink-900">{eleve.user.first_name} {eleve.user.last_name}</h3>
              <p className="text-xs text-slate-400">
                <span className="font-mono">{eleve.matricule}</span> — {eleve.classe_nom || "Sans classe"}
                {!eleve.actif && <span className="ml-2"><Badge color="rose">Inactif</Badge></span>}
              </p>
            </div>
            <Link to={`/eleves/${eleve.id}?tab=paiements`} className="text-sm text-brand-600 font-medium hover:underline">
              Voir la fiche complète →
            </Link>
          </div>

          <h4 className="font-semibold text-ink-900 mb-2">
            Mois payés / non payés (scolarité) {anneeScolaire && <span className="text-xs font-normal text-slate-400">— {anneeScolaire}</span>}
          </h4>

          {chargementMois ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : erreurMois ? (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{erreurMois}</p>
          ) : mois.length === 0 ? (
            <p className="text-sm text-slate-400">
              Aucun frais mensuel (scolarité) configuré pour cet élève sur l'année scolaire active — rien à suivre mois par mois.
            </p>
          ) : (
            <>
              {moisImpayes.length === 0 && moisPartiels.length === 0 ? (
                <p className="text-sm text-emerald-600 mb-3">✓ Aucun mois impayé.</p>
              ) : (
                <div className="text-sm mb-3 space-y-1">
                  {moisImpayes.length > 0 && (
                    <p className="text-rose-600">
                      <span className="font-semibold">{moisImpayes.length} mois impayé{moisImpayes.length > 1 ? "s" : ""} :</span>{" "}
                      {moisImpayes.map(labelMois).join(", ")}
                    </p>
                  )}
                  {moisPartiels.length > 0 && (
                    <p className="text-amber-600">
                      <span className="font-semibold">{moisPartiels.length} mois partiel{moisPartiels.length > 1 ? "s" : ""} :</span>{" "}
                      {moisPartiels.map(labelMois).join(", ")}
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {mois.map((m) => (
                  <div
                    key={m.mois}
                    title={`${money(m.montant_paye)} sur ${money(m.montant_du)}`}
                    className={
                      "px-3 py-1.5 rounded-lg text-xs font-medium " +
                      (m.statut === "paye"
                        ? "bg-emerald-100 text-emerald-700"
                        : m.statut === "partiel"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-rose-100 text-rose-700")
                    }
                  >
                    {new Date(`${m.mois}-01`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {!eleve && candidats.length === 0 && !error && !recherche && (
        <EmptyState title="Saisissez un matricule" description="Le statut de paiement mois par mois de l'élève s'affichera ici." />
      )}
    </div>
  );
}
