import { useEffect, useState } from "react";

import { classesApi, periodesApi, resultatsApi, unwrapList } from "../api/services";
import type { PeriodeSelection } from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, PageHeader, Select, Spinner, StatCard, Table } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import type { Classe, Cycle, Periode, ResultatEleve, Resultats } from "../types";

const MENTION_COLORS: Record<string, "green" | "brand" | "amber" | "rose" | "slate"> = {
  "Félicitations": "green",
  "Encouragements": "brand",
  "Tableau d'honneur": "brand",
  "Passable": "amber",
  "Doit fournir des efforts": "rose",
  "Avertissement — travail insuffisant": "rose",
};

// Un élève admis et un redoublant ne doivent jamais apparaître dans la même liste (voir demande
// utilisateur) — chaque décision a sa propre section, dans cet ordre d'affichage.
const DECISION_GROUPES: { decision: ResultatEleve["decision"]; titre: string; couleur: "green" | "amber" | "rose" | "slate" }[] = [
  { decision: "admis", titre: "Admis", couleur: "green" },
  { decision: "repeche", titre: "Repêchés", couleur: "amber" },
  { decision: "redouble", titre: "Redoublants", couleur: "rose" },
  { decision: null, titre: "Sans moyenne (notes incomplètes)", couleur: "slate" },
];

const ANNUEL_VALUE = "annuel";

export default function ResultsPage() {
  const confirmer = useConfirm();
  const toast = useToast();
  const [classes, setClasses] = useState<Classe[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  const [classeId, setClasseId] = useState("");
  const [periodeValue, setPeriodeValue] = useState("");
  const [data, setData] = useState<Resultats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingAttestations, setExportingAttestations] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [rangMax, setRangMax] = useState(3);

  useEffect(() => {
    classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
    periodesApi.list().then(({ data }) => setPeriodes(unwrapList(data)));
  }, []);

  const buildSelection = (): PeriodeSelection | null => {
    if (!periodeValue) return null;
    if (periodeValue === ANNUEL_VALUE) {
      const anneeId = periodes[0]?.annee_scolaire;
      return anneeId ? { annee_scolaire: anneeId } : null;
    }
    return { periode: Number(periodeValue) };
  };

  useEffect(() => {
    const selection = buildSelection();
    if (!classeId || !selection) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    resultatsApi.get(Number(classeId), selection)
      .then(({ data }) => setData(data))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classeId, periodeValue]);

  const handleExport = async () => {
    const selection = buildSelection();
    if (!classeId || !selection) return;
    setExporting(true);
    try {
      const classe = classes.find((c) => c.id === Number(classeId));
      await resultatsApi.exportCsv(Number(classeId), selection, `resultats_${classe?.nom || classeId}.csv`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    const selection = buildSelection();
    if (!classeId || !selection) return;
    setExportingPdf(true);
    setError("");
    try {
      const classe = classes.find((c) => c.id === Number(classeId));
      await resultatsApi.exportPdf(Number(classeId), selection, `resultats_${classe?.nom || classeId}.pdf`);
    } catch (err) {
      setError(await extractBlobErrorMessage(err));
    } finally {
      setExportingPdf(false);
    }
  };

  const handleAttestations = async () => {
    const selection = buildSelection();
    if (!classeId || !selection) return;
    setExportingAttestations(true);
    setError("");
    try {
      const classe = classes.find((c) => c.id === Number(classeId));
      await resultatsApi.attestations(Number(classeId), selection, rangMax, `attestations_${classe?.nom || classeId}.pdf`);
    } catch (err) {
      setError(await extractBlobErrorMessage(err));
    } finally {
      setExportingAttestations(false);
    }
  };

  const handleNotifier = async () => {
    const selection = buildSelection();
    if (!classeId || !selection) return;
    if (!(await confirmer(
      "Chaque élève (et son parent) recevra son rang, sa moyenne et sa décision par e-mail et SMS. Continuer ?",
      { title: "Notifier les résultats", confirmLabel: "Notifier" }
    ))) return;
    setNotifying(true);
    setError("");
    try {
      const { data: resultat } = await resultatsApi.notifier(Number(classeId), selection);
      toast.success(
        `${resultat.notifies}/${resultat.effectif} élève(s) notifié(s) — ${resultat.sms_envoyes} SMS envoyé(s).`
      );
      if (resultat.sans_telephone > 0) {
        toast.error(
          `${resultat.sans_telephone} élève(s) sans numéro de téléphone (ni élève ni parent) : aucun SMS possible.`
        );
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setNotifying(false);
    }
  };

  const moyennesValides = data?.resultats.filter((r) => r.moyenne_generale !== null) ?? [];
  const moyenneClasse = moyennesValides.length
    ? Math.round((moyennesValides.reduce((s, r) => s + (r.moyenne_generale || 0), 0) / moyennesValides.length) * 100) / 100
    : null;
  const tauxReussite = data?.resultats.length
    ? Math.round((moyennesValides.filter((r) => (r.moyenne_generale || 0) >= 10).length / data.resultats.length) * 1000) / 10
    : null;

  return (
    <div>
      <PageHeader
        title="Résultats"
        description="Classement complet d'une classe pour une période ou l'année entière."
        actions={data ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>{exporting ? "Export…" : "📤 Exporter CSV"}</Button>
            <Button variant="secondary" onClick={handleExportPdf} disabled={exportingPdf}>{exportingPdf ? "Export…" : "🖨️ Exporter PDF"}</Button>
            <Select value={rangMax} onChange={(e) => setRangMax(Number(e.target.value))} className="!w-auto">
              <option value={1}>Top 1</option>
              <option value={3}>Top 3</option>
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
            </Select>
            <Button onClick={handleAttestations} disabled={exportingAttestations}>{exportingAttestations ? "Génération…" : "🏅 Attestations"}</Button>
            <Button variant="secondary" onClick={handleNotifier} disabled={notifying}>{notifying ? "Envoi…" : "📣 Notifier les résultats"}</Button>
          </div>
        ) : undefined}
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <CycleSelect
          value={cycleFiltre}
          onChange={(c) => { setCycleFiltre(c); setClasseId(""); }}
          className="max-w-xs"
        />
        <Select value={classeId} onChange={(e) => setClasseId(e.target.value)} className="max-w-xs">
          <option value="">— Sélectionner une classe —</option>
          {classes.filter((c) => !cycleFiltre || c.cycle === cycleFiltre).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </Select>
        <Select value={periodeValue} onChange={(e) => setPeriodeValue(e.target.value)} className="max-w-xs">
          <option value="">— Sélectionner une période —</option>
          {periodes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          <option value={ANNUEL_VALUE}>Année complète (cumul des trimestres)</option>
        </Select>
      </div>

      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !data ? (
        <EmptyState title="Sélectionnez une classe et une période" description="Le classement complet s'affichera ici." />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard label="Effectif" value={data.effectif} icon="🎓" accent="brand" />
            <StatCard label="Moyenne de classe" value={moyenneClasse !== null ? `${moyenneClasse}/20` : "—"} icon="📊" accent="teal" />
            <StatCard label="Taux de réussite (≥10)" value={tauxReussite !== null ? `${tauxReussite}%` : "—"} icon="✅" accent="green" />
          </div>

          {DECISION_GROUPES.map(({ decision, titre, couleur }) => {
            const lignes = data.resultats.filter((r) => r.decision === decision);
            if (lignes.length === 0) return null;
            return (
              <div key={decision ?? "sans-moyenne"} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-bold text-ink-900">{titre}</h3>
                  <Badge color={couleur}>{lignes.length}</Badge>
                </div>
                <Table headers={["Rang", "Matricule", "Élève", "Moyenne générale", "Mention"]}>
                  {lignes.map((r) => (
                    <tr key={r.eleve_id}>
                      <td className="px-4 py-3 font-bold text-ink-900">{r.rang ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.matricule}</td>
                      <td className="px-4 py-3 font-medium text-slate-700">{r.nom_complet}</td>
                      <td className="px-4 py-3 font-semibold">{r.moyenne_generale !== null ? `${r.moyenne_generale}/20` : "—"}</td>
                      <td className="px-4 py-3">
                        {r.mention && <Badge color={MENTION_COLORS[r.mention] || "slate"}>{r.mention}</Badge>}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
