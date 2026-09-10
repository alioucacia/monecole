import { useEffect, useState } from "react";

import { bulletinApi, classesApi, elevesApi, periodesApi, unwrapList } from "../api/services";
import type { PeriodeSelection } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { PdfPreviewModal } from "../components/PdfPreviewModal";
import { PdfInlineViewer } from "../components/PdfInlineViewer";
import { Button, EmptyState, PageHeader, Select, Spinner } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import type { Bulletin, BulletinMatiere, Classe, Cycle, EleveProfile, Periode } from "../types";

const MENTION_STYLES: Record<string, string> = {
  "Félicitations": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Encouragements": "bg-brand-50 text-brand-700 border-brand-200",
  "Tableau d'honneur": "bg-accent-50 text-accent-700 border-accent-200",
  "Passable": "bg-amber-50 text-amber-700 border-amber-200",
  "Doit fournir des efforts": "bg-orange-50 text-orange-700 border-orange-200",
  "Avertissement — travail insuffisant": "bg-rose-50 text-rose-700 border-rose-200",
};

/** Palette de performance (0-20) — réutilisée pour le texte de moyenne, la barre et la pastille d'appréciation. */
function tier(moyenne: number | null) {
  if (moyenne === null) return { text: "text-slate-400", bar: "bg-slate-300", pill: "bg-slate-100 text-slate-500" };
  if (moyenne >= 16) return { text: "text-emerald-600", bar: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-700" };
  if (moyenne >= 14) return { text: "text-green-600", bar: "bg-green-500", pill: "bg-green-100 text-green-700" };
  if (moyenne >= 12) return { text: "text-lime-600", bar: "bg-lime-500", pill: "bg-lime-100 text-lime-700" };
  if (moyenne >= 10) return { text: "text-amber-600", bar: "bg-amber-500", pill: "bg-amber-100 text-amber-700" };
  if (moyenne >= 8) return { text: "text-orange-600", bar: "bg-orange-500", pill: "bg-orange-100 text-orange-700" };
  return { text: "text-rose-600", bar: "bg-rose-500", pill: "bg-rose-100 text-rose-700" };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

const ANNUEL_VALUE = "annuel";

export default function BulletinPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<Classe[]>([]);
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  const [classeId, setClasseId] = useState("");
  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [eleveId, setEleveId] = useState("");
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [periodeValue, setPeriodeValue] = useState("");
  const [bulletin, setBulletin] = useState<Bulletin | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [sendMessage, setSendMessage] = useState("");

  const needsSelector = user?.role === "admin" || user?.role === "teacher" || user?.role === "parent";
  // L'élève/parent doit voir directement le vrai bulletin officiel (PDF, avec les couleurs et
  // le modèle réglés par l'école) plutôt qu'un aperçu à l'écran qui ne lui ressemble pas —
  // admin/enseignant gardent la carte interactive (plus pratique pour parcourir vite plusieurs
  // élèves) avec le PDF accessible via le bouton « Aperçu du PDF ».
  const affichePdfDirect = user?.role === "student" || user?.role === "parent";

  useEffect(() => {
    periodesApi.list().then(({ data }) => setPeriodes(unwrapList(data)));
    if (user?.role === "admin" || user?.role === "teacher") {
      classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
    }
    if (user?.role === "parent") {
      elevesApi.list({ page_size: 50 }).then(({ data }) => setEleves(unwrapList(data)));
    }
    if (user?.role === "student") {
      elevesApi.list({ page_size: 1 }).then(({ data }) => {
        const own = unwrapList(data)[0];
        if (own) setEleveId(String(own.id));
      });
    }
  }, [user]);

  useEffect(() => {
    if ((user?.role === "admin" || user?.role === "teacher") && classeId) {
      elevesApi.list({ classe: classeId, page_size: 200 }).then(({ data }) => setEleves(unwrapList(data)));
    }
  }, [classeId, user]);

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
    if (!eleveId || !selection) {
      setBulletin(null);
      return;
    }
    setLoading(true);
    setError("");
    bulletinApi.get(Number(eleveId), selection)
      .then(({ data }) => setBulletin(data))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eleveId, periodeValue]);

  const handlePreviewPdf = () => setPreviewOpen(true);

  const handleDownloadPdf = () => {
    const selection = buildSelection();
    if (!eleveId || !selection || !bulletin) return;
    bulletinApi.downloadPdf(Number(eleveId), selection, `bulletin_${bulletin.eleve.matricule}.pdf`).catch(() => {});
  };

  const handleSendEmail = async () => {
    const selection = buildSelection();
    if (!eleveId || !selection) return;
    setSendingEmail(true);
    setSendMessage("");
    try {
      const { data } = await bulletinApi.sendEmail(Number(eleveId), selection);
      setSendMessage(data.detail);
    } catch (err) {
      setSendMessage(extractErrorMessage(err));
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendSms = async () => {
    const selection = buildSelection();
    if (!eleveId || !selection) return;
    setSendingSms(true);
    setSendMessage("");
    try {
      const { data } = await bulletinApi.sendSms(Number(eleveId), selection);
      setSendMessage(data.detail);
    } catch (err) {
      setSendMessage(extractErrorMessage(err));
    } finally {
      setSendingSms(false);
    }
  };

  const moyGenTier = tier(bulletin?.moyenne_generale ?? null);

  return (
    <div>
      <PageHeader title="Bulletins" description="Consultez, imprimez ou téléchargez les bulletins scolaires." />

      <div className="flex flex-wrap gap-3 mb-6 no-print">
        {(user?.role === "admin" || user?.role === "teacher") && (
          <>
            <CycleSelect
              value={cycleFiltre}
              onChange={(c) => { setCycleFiltre(c); setClasseId(""); setEleveId(""); }}
              className="max-w-xs"
            />
            <Select value={classeId} onChange={(e) => { setClasseId(e.target.value); setEleveId(""); }} className="max-w-xs">
              <option value="">— Classe —</option>
              {classes.filter((c) => !cycleFiltre || c.cycle === cycleFiltre).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </Select>
          </>
        )}
        {needsSelector && (
          <Select value={eleveId} onChange={(e) => setEleveId(e.target.value)} className="max-w-xs">
            <option value="">— Élève —</option>
            {eleves.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
          </Select>
        )}
        <Select value={periodeValue} onChange={(e) => setPeriodeValue(e.target.value)} className="max-w-xs">
          <option value="">— Période —</option>
          {periodes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          <option value={ANNUEL_VALUE}>Année complète (cumul des trimestres)</option>
        </Select>
        {bulletin && (
          <div className="flex flex-wrap gap-2">
            {affichePdfDirect ? (
              <Button variant="secondary" onClick={handleDownloadPdf}>⬇️ Télécharger</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => window.print()}>🖨️ Imprimer</Button>
                <Button onClick={handlePreviewPdf}>👁️ Aperçu du PDF</Button>
              </>
            )}
            {needsSelector && (
              <>
                <Button variant="secondary" onClick={handleSendEmail} disabled={sendingEmail}>
                  {sendingEmail ? "Envoi…" : "📧 Envoyer par email"}
                </Button>
                <Button variant="secondary" onClick={handleSendSms} disabled={sendingSms}>
                  {sendingSms ? "Envoi…" : "💬 Envoyer un lien SMS"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {sendMessage && (
        <p className="no-print mb-4 text-sm text-slate-600 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5">{sendMessage}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>
      ) : !bulletin ? (
        <EmptyState title="Sélectionnez un élève et une période" description="Le bulletin s'affichera ici." />
      ) : affichePdfDirect ? (
        <PdfInlineViewer
          loadKey={`${eleveId}-${periodeValue}`}
          load={() => {
            const selection = buildSelection();
            if (!eleveId || !selection) return Promise.reject(new Error("Sélection incomplète."));
            return bulletinApi.previewPdf(Number(eleveId), selection, `bulletin_${bulletin.eleve.matricule}.pdf`);
          }}
        />
      ) : (
        <div className="print-area max-w-3xl mx-auto bg-white rounded-2xl2 shadow-card border border-slate-100 overflow-hidden">
          {/* Ruban de couleurs — un repère par matière */}
          <div className="flex h-1.5 w-full">
            {bulletin.matieres.map((m) => (
              <div key={m.matiere_id} className="flex-1" style={{ backgroundColor: m.matiere_couleur }} />
            ))}
          </div>

          {/* Bandeau d'en-tête */}
          <div className="relative gradient-surface px-7 py-6 overflow-hidden">
            <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-accent-400/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-brand-400/20 blur-3xl" />
            <div className="relative flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="h-14 w-14 shrink-0 rounded-2xl bg-white/15 ring-1 ring-white/25 text-white flex items-center justify-center text-lg font-bold">
                  {initials(bulletin.eleve.nom_complet)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-extrabold text-white truncate">{bulletin.eleve.nom_complet}</h2>
                  <p className="text-brand-100/90 text-sm">
                    {bulletin.eleve.matricule} · {bulletin.eleve.classe || "Classe non assignée"}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-white font-bold">{bulletin.periode.nom}</p>
                <p className="text-brand-100/80 text-xs">{bulletin.periode.annee_scolaire}</p>
              </div>
            </div>
          </div>

          {/* Bandeau d'indicateurs clés */}
          <div className="grid grid-cols-3 divide-x divide-slate-100 bg-slate-50/60 border-b border-slate-100">
            <div className="px-4 py-3.5 text-center">
              <p className={`text-2xl font-extrabold ${moyGenTier.text}`}>
                {bulletin.moyenne_generale !== null ? `${bulletin.moyenne_generale}` : "—"}
                <span className="text-xs font-medium text-slate-400">/20</span>
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Moyenne générale</p>
            </div>
            <div className="px-4 py-3.5 text-center">
              <p className="text-2xl font-extrabold text-accent-600">
                {bulletin.rang ?? "—"}<span className="text-xs font-medium text-slate-400"> / {bulletin.effectif_classe ?? "—"}</span>
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Classement</p>
            </div>
            <div className="px-4 py-3.5 text-center flex flex-col items-center justify-center">
              {bulletin.mention ? (
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${MENTION_STYLES[bulletin.mention] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                  {bulletin.mention}
                </span>
              ) : (
                <span className="text-slate-400 text-sm">—</span>
              )}
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-1.5">Mention</p>
            </div>
          </div>

          {/* Détail par matière */}
          <div className="p-6 space-y-2.5">
            {bulletin.matieres.map((m: BulletinMatiere) => {
              const t = tier(m.moyenne);
              const pct = m.moyenne !== null ? Math.min((m.moyenne / 20) * 100, 100) : 0;
              return (
                <div key={m.matiere_id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-4 py-3 hover:bg-slate-50/60 transition">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: m.matiere_couleur }} />
                  <div className="w-32 shrink-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{m.matiere_nom}</p>
                    <p className="text-[11px] text-slate-400">Coeff. {m.coefficient}</p>
                  </div>
                  <div className="flex-1 min-w-[80px]">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${t.bar} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    {m.moyenne_classe !== null && (
                      <p className="text-[10px] text-slate-400 mt-1">Moy. classe : {m.moyenne_classe}/20</p>
                    )}
                  </div>
                  <div className={`w-16 shrink-0 text-right font-extrabold ${t.text}`}>
                    {m.moyenne !== null ? `${m.moyenne}` : "—"}<span className="text-[10px] font-medium text-slate-400">/20</span>
                  </div>
                  <span className={`w-28 shrink-0 text-center text-[11px] font-bold px-2 py-1 rounded-full ${t.pill}`}>
                    {m.appreciation || "—"}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="px-6 pb-6 pt-2 flex justify-between text-xs text-slate-400">
            <span>Signature du professeur principal</span>
            <span>Signature de l'administration</span>
          </div>
        </div>
      )}

      <PdfPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={bulletin ? `Bulletin — ${bulletin.eleve.nom_complet}` : "Bulletin"}
        load={() => {
          const selection = buildSelection();
          if (!eleveId || !selection || !bulletin) return Promise.reject(new Error("Sélection incomplète."));
          return bulletinApi.previewPdf(Number(eleveId), selection, `bulletin_${bulletin.eleve.matricule}.pdf`);
        }}
      />
    </div>
  );
}
