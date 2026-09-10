import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { chauffeurApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Spinner } from "../components/ui";
import { useToast } from "../context/ToastContext";
import type { ChauffeurInfo } from "../types";

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}

export default function ChauffeurPage() {
  const toast = useToast();
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ChauffeurInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [positionMsg, setPositionMsg] = useState("");

  const load = useCallback(() => {
    if (!token) return;
    chauffeurApi.info(token)
      .then(({ data }) => setData(data))
      .catch(() => setError("Lien invalide ou expiré. Contactez l'administration de l'école."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  const handlePointer = async (eleveId: number, type: "montee" | "descente") => {
    if (!token) return;
    setPendingId(eleveId);
    try {
      const pos = await getPosition();
      await chauffeurApi.pointer(token, {
        eleve: eleveId, type_evenement: type,
        latitude: pos?.coords.latitude, longitude: pos?.coords.longitude,
      });
      load();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPendingId(null);
    }
  };

  const handleSignalerPosition = async () => {
    if (!token) return;
    setPositionMsg("Localisation…");
    const pos = await getPosition();
    if (!pos) {
      setPositionMsg("Position indisponible (autorisez la géolocalisation sur ce téléphone).");
      return;
    }
    await chauffeurApi.signalerPosition(token, pos.coords.latitude, pos.coords.longitude);
    setPositionMsg("Position du bus mise à jour ✓");
    load();
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
        <h1 className="text-lg font-extrabold">🚌 {data.trajet.nom}</h1>
        <p className="text-sm text-brand-100/90">{data.trajet.chauffeur_nom || "Chauffeur"} · {data.trajet.vehicule_immatriculation || "—"}</p>
      </div>

      <div className="p-4">
        <button
          onClick={handleSignalerPosition}
          className="w-full bg-white rounded-2xl border border-slate-100 shadow-soft px-4 py-3 text-sm font-semibold text-brand-700 mb-2"
        >
          📍 Signaler ma position actuelle
        </button>
        {positionMsg && <p className="text-xs text-slate-500 text-center mb-4">{positionMsg}</p>}
        {data.trajet.position_maj_le && (
          <p className="text-xs text-slate-400 text-center mb-4">
            Dernière position connue : {new Date(data.trajet.position_maj_le).toLocaleTimeString("fr-FR")}
            {data.trajet.derniere_latitude && data.trajet.derniere_longitude && (
              <>
                {" — "}
                <a
                  className="text-brand-600 underline"
                  target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps?q=${data.trajet.derniere_latitude},${data.trajet.derniere_longitude}`}
                >
                  voir sur la carte
                </a>
              </>
            )}
          </p>
        )}

        <h2 className="text-sm font-bold text-ink-900 mb-2 mt-4">Élèves inscrits ({data.eleves.length})</h2>
        <div className="space-y-2">
          {data.eleves.map((el) => (
            <div key={el.affectation_id} className="bg-white rounded-2xl border border-slate-100 shadow-soft p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-slate-700">{el.nom_complet}</p>
                  <p className="text-xs text-slate-400">{el.classe_nom || "—"} · {el.point_montee || "Point non précisé"}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {el.statut_jour && (
                    <Badge color={el.statut_jour === "montee" ? "green" : "slate"}>
                      {el.statut_jour === "montee" ? "À bord" : "Descendu"}
                    </Badge>
                  )}
                  {el.ticket_paye === false && <Badge color="rose">Ticket impayé</Badge>}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={pendingId === el.eleve_id}
                  onClick={() => handlePointer(el.eleve_id, "montee")}
                  className="flex-1 bg-emerald-50 text-emerald-700 font-semibold text-sm rounded-xl py-2 disabled:opacity-50"
                >
                  ⬆️ Montée
                </button>
                <button
                  disabled={pendingId === el.eleve_id}
                  onClick={() => handlePointer(el.eleve_id, "descente")}
                  className="flex-1 bg-slate-100 text-slate-700 font-semibold text-sm rounded-xl py-2 disabled:opacity-50"
                >
                  ⬇️ Descente
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
