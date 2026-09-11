import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { badgeVerifyApi, plateformeBrandingApi } from "../api/services";
import { Spinner } from "../components/ui";

interface VerifyResult {
  valide: boolean;
  type?: string;
  role_label?: string;
  nom_complet?: string;
  matricule?: string;
  detail?: string;
  emis_le?: string;
}

export default function VerifyBadgePage() {
  const { token } = useParams<{ token: string }>();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [nomPlateforme, setNomPlateforme] = useState("Taly-School");

  useEffect(() => {
    if (!token) return;
    badgeVerifyApi.verify(token)
      .then(({ data }) => setResult(data))
      .catch(() => setResult({ valide: false, detail: "Badge introuvable." }))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    plateformeBrandingApi.get().then(({ data }) => {
      if (data.nom_plateforme) setNomPlateforme(data.nom_plateforme);
    }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface">
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden p-8 text-center">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : result?.valide ? (
          <>
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl">✓</div>
            <h1 className="text-xl font-extrabold text-ink-900 mb-1">Badge valide</h1>
            <p className="text-sm font-semibold text-brand-700 uppercase tracking-wide mb-4">{result.role_label}</p>
            <div className="bg-slate-50 rounded-xl p-4 text-left space-y-1">
              <p className="font-bold text-slate-800">{result.nom_complet}</p>
              <p className="text-sm text-slate-500 font-mono">{result.matricule}</p>
              <p className="text-sm text-slate-500">{result.detail}</p>
            </div>
            {result.emis_le && (
              <p className="text-xs text-slate-400 mt-4">
                Émis le {new Date(result.emis_le).toLocaleDateString("fr-FR")}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-3xl">✕</div>
            <h1 className="text-xl font-extrabold text-ink-900 mb-1">Badge invalide</h1>
            <p className="text-sm text-slate-500">{result?.detail || "Ce badge n'a pas pu être vérifié."}</p>
          </>
        )}
        <p className="text-xs text-slate-400 mt-6">{nomPlateforme} — Vérification de badge</p>
      </div>
    </div>
  );
}
