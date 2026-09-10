import { useEffect, useRef, useState } from "react";

import { extractBlobErrorMessage } from "../api/client";
import { Spinner } from "./ui";

/**
 * Affiche un PDF directement dans la page (pas dans une modale) — utilisé là où le document
 * généré (bulletin, fiche de paie…) EST le contenu principal à montrer, plutôt qu'une pièce
 * jointe qu'on prévisualise avant de télécharger (voir PdfPreviewModal pour ce second cas).
 * Recharge automatiquement à chaque fois que `loadKey` change.
 */
export function PdfInlineViewer({
  load, loadKey, height = "80vh",
}: {
  load: () => Promise<{ blob: Blob; filename: string }>;
  /** Sert de dépendance de rechargement — inclut tout ce qui doit provoquer un nouvel appel à `load` (ex: élève + période sélectionnés). */
  loadKey: string;
  height?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    setObjectUrl(null);

    load()
      .then(({ blob }) => {
        const url = window.URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
      })
      .catch(async (err) => setError(await extractBlobErrorMessage(err)))
      .finally(() => setLoading(false));

    return () => {
      if (objectUrlRef.current) {
        window.URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>;
  }
  if (error) {
    return <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>;
  }
  if (!objectUrl) return null;

  return (
    <div className="rounded-2xl2 border border-slate-100 shadow-card overflow-hidden bg-slate-100" style={{ height }}>
      <iframe src={objectUrl} title="Aperçu du document" className="w-full h-full border-0" />
    </div>
  );
}
