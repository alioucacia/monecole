import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { documentVerifyApi, plateformeBrandingApi, type DocumentVerifie } from "../api/services";
import { Button, Input, Spinner } from "../components/ui";

function Ligne({ label, valeur }: { label: string; valeur?: string | number | null }) {
  if (valeur === undefined || valeur === null || valeur === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800 text-right">{valeur}</span>
    </div>
  );
}

/** Page publique (sans connexion) ouverte en scannant le QR code d'un bulletin ou d'un
 * certificat de scolarité — ou en saisissant le code court imprimé dessous. Affiche les
 * informations enregistrées par l'école au moment de l'émission : c'est à elles qu'il faut
 * comparer le document présenté (voir core.DocumentVerifyView). */
export default function VerifyDocumentPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<DocumentVerifie | null>(null);
  const [loading, setLoading] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [nomPlateforme, setNomPlateforme] = useState("");

  useEffect(() => {
    plateformeBrandingApi.get().then(({ data }) => setNomPlateforme(data.nom_plateforme)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!code) { setResult(null); return; }
    setLoading(true);
    documentVerifyApi.verify(code)
      .then(({ data }) => setResult(data))
      .catch(() => setResult({ valide: false, detail: "Aucun document ne correspond à ce code." }))
      .finally(() => setLoading(false));
  }, [code]);

  const verifier = (e: FormEvent) => {
    e.preventDefault();
    const nettoye = saisie.trim().replace(/\s+/g, "");
    if (nettoye) navigate(`/verifier-document/${nettoye}`);
  };

  const d = result?.donnees;
  const estBulletin = result?.type === "bulletin";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface">
      <div className="relative w-full max-w-md bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden p-8">
        {!code ? (
          <form noValidate onSubmit={verifier} className="text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-3xl">🔎</div>
            <h1 className="text-xl font-extrabold text-ink-900">Vérifier un document</h1>
            <p className="text-sm text-slate-500">
              Saisissez le code imprimé sous le QR code du bulletin ou du certificat de scolarité.
            </p>
            <Input label="Code du document" required placeholder="Ex : 3F9A1C07B2" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
            <Button type="submit" className="w-full">Vérifier</Button>
          </form>
        ) : loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : result?.valide && d ? (
          <>
            <div className="text-center">
              <div className="mx-auto mb-3 h-16 w-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl">✓</div>
              <h1 className="text-xl font-extrabold text-ink-900">Document authentique</h1>
              <p className="text-sm font-semibold text-brand-700 uppercase tracking-wide mt-1">{result.type_label}</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                {result.ecole_logo && <img src={result.ecole_logo} alt="" className="h-8 w-8 rounded-lg object-contain" />}
                <p className="text-sm font-semibold text-slate-700">{result.ecole_nom}</p>
              </div>
            </div>

            {result.version_plus_recente && (
              <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                ⚠️ Une version plus récente de ce document a été émise le{" "}
                {new Date(result.version_plus_recente).toLocaleDateString("fr-FR")} (notes corrigées depuis).
              </p>
            )}

            <p className="mt-4 text-xs text-slate-500">
              Informations enregistrées par l'école à l'émission — elles doivent être identiques à celles du document présenté :
            </p>
            <div className="mt-2 bg-slate-50 rounded-xl px-4 py-2 text-sm">
              <Ligne label="Élève" valeur={d.nom_complet} />
              <Ligne label="Matricule" valeur={d.matricule} />
              <Ligne label="Né(e) le" valeur={d.date_naissance} />
              <Ligne label="Lieu de naissance" valeur={d.lieu_naissance} />
              <Ligne label="Classe" valeur={d.classe} />
              <Ligne label="Année scolaire" valeur={d.annee_scolaire} />
              {estBulletin && (
                <>
                  <Ligne label="Période" valeur={d.periode} />
                  <Ligne label="Moyenne générale" valeur={d.moyenne_generale ? `${d.moyenne_generale} / ${d.bareme}` : "—"} />
                  <Ligne label="Rang" valeur={d.rang ? `${d.rang} / ${d.effectif}` : null} />
                  <Ligne label="Mention" valeur={d.mention} />
                  <Ligne label="Décision" valeur={d.decision} />
                </>
              )}
            </div>

            {estBulletin && d.matieres && d.matieres.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-brand-700">Moyennes par matière</summary>
                <div className="mt-2 bg-slate-50 rounded-xl px-4 py-2">
                  {d.matieres.map((m) => <Ligne key={m.nom} label={m.nom} valeur={m.moyenne ?? "—"} />)}
                </div>
              </details>
            )}

            <p className="text-xs text-slate-400 mt-4 text-center">
              Émis le {result.emis_le ? new Date(result.emis_le).toLocaleDateString("fr-FR") : "—"} · Code {result.code}
            </p>
          </>
        ) : (
          <div className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-3xl">✕</div>
            <h1 className="text-xl font-extrabold text-ink-900 mb-1">Document non reconnu</h1>
            <p className="text-sm text-slate-500">
              {result?.detail || "Ce document n'a pas pu être vérifié."} Il n'a peut-être pas été émis par l'établissement.
            </p>
            <button onClick={() => navigate("/verifier-document")} className="mt-4 text-sm font-semibold text-brand-600 hover:underline">
              Saisir un autre code
            </button>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-6 text-center">{nomPlateforme} — Vérification de document</p>
      </div>
    </div>
  );
}
