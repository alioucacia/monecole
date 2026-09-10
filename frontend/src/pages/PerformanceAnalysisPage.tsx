import { useEffect, useState } from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";

import { analysePerformanceApi, elevesApi, periodesApi, unwrapList } from "../api/services";
import type { PeriodeSelection } from "../api/services";
import { Badge, Card, EmptyState, PageHeader, Select, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { AnalysePerformance, EleveProfile, Periode } from "../types";

const NIVEAU_STYLES: Record<string, { label: string; color: "rose" | "amber" | "green" | "slate" }> = {
  faible: { label: "En difficulté", color: "rose" },
  moyen: { label: "Sous la moyenne de classe", color: "amber" },
  bon: { label: "Bon niveau", color: "green" },
  aucune_note: { label: "Pas encore de note", color: "slate" },
};

const ANNUEL_VALUE = "annuel";

export default function PerformanceAnalysisPage() {
  const { user } = useAuth();
  const isParent = user?.role === "parent";

  const [enfants, setEnfants] = useState<EleveProfile[]>([]);
  const [eleveId, setEleveId] = useState("");
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [periodeValue, setPeriodeValue] = useState("");
  const [data, setData] = useState<AnalysePerformance | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    periodesApi.list().then(({ data }) => {
      const items = unwrapList(data);
      setPeriodes(items);
      setPeriodeValue(ANNUEL_VALUE);
    });
    if (isParent) elevesApi.list({ page_size: 100 }).then(({ data }) => setEnfants(unwrapList(data)));
  }, [isParent]);

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
    if (!selection || (isParent && !eleveId)) {
      setData(null);
      return;
    }
    setLoading(true);
    analysePerformanceApi.get(selection, isParent ? Number(eleveId) : undefined)
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodeValue, eleveId, isParent]);

  const radarData = data?.matieres
    .filter((m) => m.moyenne !== null)
    .map((m) => ({ matiere: m.matiere_nom, Moyenne: m.moyenne, "Moyenne classe": m.moyenne_classe })) ?? [];

  return (
    <div>
      <PageHeader
        title="Analyse de performance"
        description="Repère les matières où progresser, avec des conseils concrets."
      />

      <div className="flex flex-wrap gap-3 mb-6">
        {isParent && (
          <Select value={eleveId} onChange={(e) => setEleveId(e.target.value)} className="max-w-xs">
            <option value="">— Choisir un enfant —</option>
            {enfants.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
          </Select>
        )}
        <Select value={periodeValue} onChange={(e) => setPeriodeValue(e.target.value)} className="max-w-xs">
          {periodes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          <option value={ANNUEL_VALUE}>Année complète (cumul des trimestres)</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !data ? (
        <EmptyState title={isParent ? "Sélectionnez un enfant" : "Aucune donnée pour le moment"} />
      ) : (
        <div className="space-y-6">
          {data.points_faibles.length > 0 && (
            <Card className="border-rose-100 bg-rose-50/40">
              <h3 className="font-bold text-rose-700 mb-3">🎯 Priorités pour progresser</h3>
              <div className="space-y-2">
                {data.points_faibles.map((m) => (
                  <div key={m.matiere_id} className="bg-white rounded-xl p-3 border border-rose-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-700">{m.matiere_nom}</span>
                      <span className="font-bold text-rose-600">{m.moyenne}/20</span>
                    </div>
                    <p className="text-xs text-slate-500">{m.conseil}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {radarData.length >= 3 && (
            <Card>
              <h3 className="font-bold text-ink-900 mb-4">Vue d'ensemble par matière</h3>
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="matiere" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 20]} tick={{ fontSize: 10 }} />
                  <Radar name="Moyenne élève" dataKey="Moyenne" stroke="#6d28d9" fill="#8b5cf6" fillOpacity={0.45} />
                  <Radar name="Moyenne classe" dataKey="Moyenne classe" stroke="#0d9488" fill="#14b8a6" fillOpacity={0.15} />
                </RadarChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Détail par matière</h3>
            <ul className="divide-y divide-slate-100">
              {data.matieres.map((m) => (
                <li key={m.matiere_id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: m.matiere_couleur }} />
                    <span className="font-medium text-slate-700 truncate">{m.matiere_nom}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm text-slate-500">{m.moyenne !== null ? `${m.moyenne}/20` : "—"}</span>
                    <Badge color={NIVEAU_STYLES[m.niveau].color}>{NIVEAU_STYLES[m.niveau].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
