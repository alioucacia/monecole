import { useEffect, useRef, useState } from "react";

import { extractBlobErrorMessage } from "../api/client";
import { Button, Spinner } from "./ui";

/**
 * Aperçu d'un PDF (bulletin, fiche de paie…) avant téléchargement : charge le fichier en `Blob`
 * (via `load`) dès l'ouverture, l'affiche dans un `<iframe>` pleine page, et ne déclenche le
 * téléchargement réel qu'au clic sur « Télécharger » — jamais automatiquement.
 */
export function PdfPreviewModal({
  open, onClose, title, load,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  load: () => Promise<{ blob: Blob; filename: string }>;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState("document.pdf");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setObjectUrl(null);

    load()
      .then(({ blob, filename }) => {
        const url = window.URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setObjectUrl(url);
        setFilename(filename);
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
  }, [open]);

  if (!open) return null;

  const handleDownload = () => {
    if (!objectUrl) return;
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm p-4 animate-fade-in-up" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[92vh] flex flex-col overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-ink-900 truncate">{title}</h3>
            <p className="text-xs text-slate-400">Aperçu — vérifiez le document avant de le télécharger.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={handleDownload} disabled={!objectUrl}>⬇️ Télécharger</Button>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-xl leading-none transition"
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full"><Spinner /></div>
          ) : error ? (
            <div className="flex items-center justify-center h-full p-6">
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>
            </div>
          ) : objectUrl ? (
            <iframe src={objectUrl} title={title} className="w-full h-full border-0" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
