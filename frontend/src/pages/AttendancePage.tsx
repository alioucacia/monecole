import { useEffect, useState } from "react";

import { classesApi, elevesApi, presencesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, StatCard, Table } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import type { Classe, Cycle, EleveProfile, Presence } from "../types";

type Statut = "present" | "absent" | "retard";

const STATUT_LABELS: Record<Statut, string> = { present: "Présent", absent: "Absent", retard: "Retard" };
const STATUT_COLORS: Record<Statut, "green" | "rose" | "amber"> = { present: "green", absent: "rose", retard: "amber" };

export default function AttendancePage() {
  const { user } = useAuth();
  // Surveillance générale : mêmes droits que l'admin/enseignant sur la feuille d'appel
  // (déjà autorisé côté API — voir IsAdminOrTeacherOrSurveillanceOrReadOnly — la page ne le
  // reflétait pas encore ici).
  const canEdit = user?.role === "admin" || user?.role === "teacher" || user?.role === "surveillance";
  return canEdit ? <AttendanceSheet /> : <AttendanceHistory />;
}

function AttendanceSheet() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  const [classeId, setClasseId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [statuts, setStatuts] = useState<Record<number, { statut: Statut; justifie: boolean }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
  }, []);

  useEffect(() => {
    if (!classeId) {
      setEleves([]);
      return;
    }
    setLoading(true);
    Promise.all([
      elevesApi.list({ classe: classeId, page_size: 200 }),
      presencesApi.list({ eleve__classe: classeId, date, page_size: 200 }),
      presencesApi.stats({ classe: classeId }),
    ]).then(([elevesRes, presRes, statsRes]) => {
      const roster = unwrapList(elevesRes.data);
      setEleves(roster);
      const existing = unwrapList(presRes.data) as Presence[];
      const initial: Record<number, { statut: Statut; justifie: boolean }> = {};
      roster.forEach((el) => { initial[el.id] = { statut: "present", justifie: false }; });
      existing.forEach((p) => { initial[p.eleve] = { statut: p.statut, justifie: p.justifie }; });
      setStatuts(initial);
      setStats(statsRes.data);
    }).finally(() => setLoading(false));
  }, [classeId, date]);

  const setStatut = (eleveId: number, statut: Statut) => {
    setStatuts((prev) => ({ ...prev, [eleveId]: { ...prev[eleveId], statut } }));
  };
  const toggleJustifie = (eleveId: number) => {
    setStatuts((prev) => ({ ...prev, [eleveId]: { ...prev[eleveId], justifie: !prev[eleveId]?.justifie } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const entries = eleves.map((el) => ({
        eleve: el.id,
        statut: statuts[el.id]?.statut || "present",
        justifie: statuts[el.id]?.justifie || false,
      }));
      await presencesApi.bulk({ date, entries });
      setMessage("Feuille d'appel enregistrée avec succès.");
      const { data } = await presencesApi.stats({ classe: classeId });
      setStats(data);
    } catch (err) {
      setMessage(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Feuille d'appel" description="Enregistrer les présences d'une classe pour une date donnée." />

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
        <input
          type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
        />
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard label="Taux de présence" value={stats.taux_presence !== null ? `${stats.taux_presence}%` : "—"} icon="✅" accent="green" />
          <StatCard label="Absences" value={String(stats.absents)} icon="🚫" accent="rose" />
          <StatCard label="Retards" value={String(stats.retards)} icon="⏰" accent="amber" />
          <StatCard label="Non justifiées" value={String(stats.absences_injustifiees)} icon="⚠️" accent="rose" />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !classeId ? (
        <EmptyState title="Sélectionnez une classe pour commencer" />
      ) : eleves.length === 0 ? (
        <EmptyState title="Aucun élève dans cette classe" />
      ) : (
        <>
          <Table headers={["Élève", "Matricule", "Statut", "Justifié"]}>
            {eleves.map((el) => {
              const current = statuts[el.id] || { statut: "present", justifie: false };
              return (
                <tr key={el.id}>
                  <td className="px-4 py-3 font-medium text-slate-700">{el.user.first_name} {el.user.last_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{el.matricule}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {(Object.keys(STATUT_LABELS) as Statut[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setStatut(el.id, s)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                            current.statut === s
                              ? s === "present" ? "bg-emerald-600 text-white border-emerald-600 shadow-soft"
                                : s === "absent" ? "bg-rose-600 text-white border-rose-600 shadow-soft"
                                : "bg-amber-500 text-white border-amber-500 shadow-soft"
                              : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          {STATUT_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {current.statut !== "present" && (
                      <input type="checkbox" checked={current.justifie} onChange={() => toggleJustifie(el.id)} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>

          <div className="flex items-center justify-between mt-4">
            {message && <p className="text-sm text-slate-600">{message}</p>}
            <Button className="ml-auto" onClick={handleSave} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer la feuille d'appel"}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function AttendanceHistory() {
  const [presences, setPresences] = useState<Presence[]>([]);
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([presencesApi.list({ page_size: 100 }), presencesApi.stats()]).then(([presRes, statsRes]) => {
      setPresences(unwrapList(presRes.data));
      setStats(statsRes.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div>
      <PageHeader title="Mes présences" description="Historique de présence et d'assiduité." />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard label="Taux de présence" value={stats.taux_presence !== null ? `${stats.taux_presence}%` : "—"} icon="✅" accent="green" />
          <StatCard label="Présences" value={String(stats.presents)} icon="🙋" accent="brand" />
          <StatCard label="Absences" value={String(stats.absents)} icon="🚫" accent="rose" />
          <StatCard label="Retards" value={String(stats.retards)} icon="⏰" accent="amber" />
        </div>
      )}

      {presences.length === 0 ? (
        <EmptyState title="Aucun enregistrement de présence" />
      ) : (
        <Card className="p-0">
          <Table headers={["Élève", "Date", "Statut", "Justifié", "Motif"]}>
            {presences.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{p.eleve_nom}</td>
                <td className="px-4 py-3">{new Date(p.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3"><Badge color={STATUT_COLORS[p.statut]}>{STATUT_LABELS[p.statut]}</Badge></td>
                <td className="px-4 py-3">{p.justifie ? "Oui" : "—"}</td>
                <td className="px-4 py-3 text-slate-500">{p.motif || "—"}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
