import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { agentCantineApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Spinner } from "../components/ui";
import { useToast } from "../context/ToastContext";
import type { AgentCantineInfo } from "../types";

export default function AgentCantinePage() {
  const toast = useToast();
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<AgentCantineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    agentCantineApi.info(token)
      .then(({ data }) => setData(data))
      .catch(() => setError("Lien invalide ou expiré. Contactez l'administration de l'école."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  const handlePointer = async (eleveId: number) => {
    if (!token) return;
    setPendingId(eleveId);
    try {
      await agentCantineApi.pointer(token, { eleve: eleveId });
      load();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPendingId(null);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 gradient-surface">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-3xl">✕</div>
          <h1 className="text-xl font-extrabold text-ink-900 mb-1">Lien invalide</h1>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="gradient-surface text-white px-5 py-6">
        <h1 className="text-lg font-extrabold">🍽️ {data.formule.nom}</h1>
        <p className="text-sm text-brand-100/90">
          {data.formule.responsable_nom || "Responsable"}
          {data.formule.heure_service && <> · {data.formule.heure_service.slice(0, 5)}</>}
        </p>
      </div>

      <div className="p-4">
        <h2 className="text-sm font-bold text-ink-900 mb-2 mt-2">Élèves inscrits ({data.eleves.length})</h2>
        <div className="space-y-2">
          {data.eleves.map((el) => (
            <div key={el.inscription_id} className="bg-white rounded-2xl border border-slate-100 shadow-soft p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-slate-700">{el.nom_complet}</p>
                  <p className="text-xs text-slate-400">{el.classe_nom || "—"}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {el.repas_pris && <Badge color="green">Repas pris</Badge>}
                  {el.ticket_paye === false && <Badge color="rose">Ticket impayé</Badge>}
                </div>
              </div>
              <button
                disabled={pendingId === el.eleve_id || el.repas_pris}
                onClick={() => handlePointer(el.eleve_id)}
                className="w-full bg-emerald-50 text-emerald-700 font-semibold text-sm rounded-xl py-2 disabled:opacity-50"
              >
                {el.repas_pris ? "✓ Repas déjà pointé" : "🍽️ Pointer le repas"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
