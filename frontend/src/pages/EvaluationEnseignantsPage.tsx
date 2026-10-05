import { useEffect, useState } from "react";

import { anneesApi, evaluationEnseignantsApi, unwrapList, type EvaluationEnseignant } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { EmptyState, Modal, PageHeader, Select, Spinner, Table } from "../components/ui";
import { useAnnee } from "../context/AnneeContext";
import type { AnneeScolaire } from "../types";

/** Pourcentage coloré : vert ≥ seuil haut, orange ≥ seuil bas, rouge en dessous. */
function Taux({ valeur, haut = 90, bas = 75 }: { valeur: number | null | undefined; haut?: number; bas?: number }) {
  if (valeur === null || valeur === undefined) return <span className="text-slate-300">—</span>;
  const couleur = valeur >= haut ? "text-emerald-600" : valeur >= bas ? "text-amber-600" : "text-rose-600";
  return <span className={`font-semibold ${couleur}`}>{valeur}%</span>;
}

function Moyenne({ valeur }: { valeur: string | number | null | undefined }) {
  if (valeur === null || valeur === undefined) return <span className="text-slate-300">—</span>;
  const n = Number(valeur);
  const couleur = n >= 12 ? "text-emerald-600" : n >= 10 ? "text-amber-600" : "text-rose-600";
  return <span className={`font-semibold ${couleur}`}>{n.toFixed(2)}/20</span>;
}

/** Évaluation des enseignants par la direction : présence, ponctualité, progression des
 * programmes, résultats des classes, volume de cours et évaluations données — pour une année
 * scolaire, avec l'historique annuel de chaque enseignant. */
export default function EvaluationEnseignantsPage() {
  const { anneeId: anneeVueId } = useAnnee();
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [anneeId, setAnneeId] = useState("");
  const [lignes, setLignes] = useState<EvaluationEnseignant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [fiche, setFiche] = useState<EvaluationEnseignant | null>(null);
  const [historique, setHistorique] = useState<EvaluationEnseignant[]>([]);
  const [historiqueLoading, setHistoriqueLoading] = useState(false);

  useEffect(() => {
    anneesApi.list().then(({ data }) => {
      const liste = unwrapList(data);
      setAnnees(liste);
      // Par défaut : l'année affichée dans toute l'application (sélecteur du haut).
      const active = liste.find((a) => a.id === anneeVueId) ?? liste.find((a) => a.active);
      setAnneeId(active ? String(active.id) : liste[0] ? String(liste[0].id) : "");
    });
  }, [anneeVueId]);

  useEffect(() => {
    if (!anneeId) return;
    setLoading(true);
    setError("");
    evaluationEnseignantsApi.annee(Number(anneeId))
      .then(({ data }) => setLignes(data.enseignants))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [anneeId]);

  const ouvrirFiche = (l: EvaluationEnseignant) => {
    setFiche(l);
    setHistorique([]);
    setHistoriqueLoading(true);
    evaluationEnseignantsApi.historique(l.enseignant_id)
      .then(({ data }) => setHistorique(data.historique))
      .finally(() => setHistoriqueLoading(false));
  };

  return (
    <div>
      <PageHeader
        title="Évaluation des enseignants"
        description="Présence, ponctualité, progression des programmes, résultats des classes, volume de cours et évaluations données — avec l'historique annuel."
      />
      <div className="flex flex-wrap gap-3 mb-5">
        <Select label="Année scolaire" value={anneeId} onChange={(e) => setAnneeId(e.target.value)} className="max-w-xs">
          {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}{a.active ? " (en cours)" : ""}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>
      ) : lignes.length === 0 ? (
        <EmptyState title="Aucun enseignant" description="Aucun enseignant actif dans l'établissement." />
      ) : (
        <div className="overflow-x-auto">
          <Table headers={["Enseignant", "Présence", "Ponctualité", "Programme", "Moyenne des classes", "Réussite", "Volume (h/sem.)", "Évaluations", ""]}>
            {lignes.map((l) => (
              <tr key={l.enseignant_id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-700">{l.nom_complet}</p>
                  <p className="text-xs text-slate-400">{l.classes.join(", ") || "Aucune classe"}</p>
                </td>
                <td className="px-4 py-3">
                  <Taux valeur={l.presence.taux_presence} />
                  <p className="text-[11px] text-slate-400">{l.presence.absents} absence(s)</p>
                </td>
                <td className="px-4 py-3">
                  <Taux valeur={l.presence.taux_ponctualite} />
                  <p className="text-[11px] text-slate-400">{l.presence.retards} retard(s)</p>
                </td>
                <td className="px-4 py-3">
                  <Taux valeur={l.programme.pourcentage} haut={75} bas={40} />
                  <p className="text-[11px] text-slate-400">{l.programme.termines}/{l.programme.chapitres} chap.</p>
                </td>
                <td className="px-4 py-3"><Moyenne valeur={l.resultats.moyenne_sur_20} /></td>
                <td className="px-4 py-3"><Taux valeur={l.resultats.taux_reussite} haut={75} bas={50} /></td>
                <td className="px-4 py-3 text-slate-600">
                  {l.volume.heures_hebdo_prevues} h
                  <p className="text-[11px] text-slate-400">{l.volume.heures_pointees} h pointées</p>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {l.evaluations.evaluations_donnees}
                  <p className="text-[11px] text-slate-400">{l.evaluations.notes_saisies} notes</p>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => ouvrirFiche(l)} className="text-xs font-semibold text-brand-600 hover:underline whitespace-nowrap">
                    📊 Détail & historique
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-slate-400 mt-3">
            Présence et ponctualité : pointages de l'enseignant. Programme : chapitres terminés dans ses matières. Moyenne et
            réussite : résultats de ses élèves dans ses matières, ramenés sur 20. Volume : heures à l'emploi du temps.
            Évaluations : devoirs, interrogations et compositions notés.
          </p>
        </div>
      )}

      <Modal open={!!fiche} onClose={() => setFiche(null)} title={fiche ? `${fiche.nom_complet} — ${fiche.annee_scolaire}` : ""} wide>
        {fiche && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-bold text-ink-900 mb-2">Détail par classe et matière</h3>
              {fiche.detail_classes.length === 0 ? (
                <p className="text-sm text-slate-400">Aucun enseignement cette année.</p>
              ) : (
                <Table headers={["Classe", "Matière", "Moyenne", "Réussite", "Élèves notés", "Programme"]}>
                  {fiche.detail_classes.map((d) => (
                    <tr key={`${d.classe}-${d.matiere}`}>
                      <td className="px-4 py-2">{d.classe}</td>
                      <td className="px-4 py-2">{d.matiere}</td>
                      <td className="px-4 py-2">{d.moyenne !== null ? `${Number(d.moyenne).toFixed(2)}/${d.bareme}` : "—"}</td>
                      <td className="px-4 py-2"><Taux valeur={d.taux_reussite} haut={75} bas={50} /></td>
                      <td className="px-4 py-2">{d.eleves_notes}</td>
                      <td className="px-4 py-2"><Taux valeur={d.programme} haut={75} bas={40} /></td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-900 mb-2">Historique annuel</h3>
              {historiqueLoading ? (
                <div className="flex justify-center py-6"><Spinner /></div>
              ) : (
                <Table headers={["Année", "Présence", "Ponctualité", "Programme", "Moyenne", "Réussite", "Volume", "Évaluations"]}>
                  {historique.map((h) => (
                    <tr key={h.annee_scolaire_id}>
                      <td className="px-4 py-2 font-medium">{h.annee_scolaire}</td>
                      <td className="px-4 py-2"><Taux valeur={h.presence.taux_presence} /></td>
                      <td className="px-4 py-2"><Taux valeur={h.presence.taux_ponctualite} /></td>
                      <td className="px-4 py-2"><Taux valeur={h.programme.pourcentage} haut={75} bas={40} /></td>
                      <td className="px-4 py-2"><Moyenne valeur={h.resultats.moyenne_sur_20} /></td>
                      <td className="px-4 py-2"><Taux valeur={h.resultats.taux_reussite} haut={75} bas={50} /></td>
                      <td className="px-4 py-2">{h.volume.heures_hebdo_prevues} h/sem.</td>
                      <td className="px-4 py-2">{h.evaluations.evaluations_donnees}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
