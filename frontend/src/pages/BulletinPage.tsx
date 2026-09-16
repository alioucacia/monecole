import { useEffect, useState } from "react";

import { bulletinApi, classesApi, elevesApi, periodesApi, unwrapList } from "../api/services";
import type { PeriodeSelection } from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { PdfInlineViewer } from "../components/PdfInlineViewer";
import { Button, EmptyState, PageHeader, Select, Spinner } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import type { Bulletin, Classe, Cycle, EleveProfile, Periode } from "../types";

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
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [sendMessage, setSendMessage] = useState("");

  const needsSelector = user?.role === "admin" || user?.role === "teacher" || user?.role === "parent";
  // Tous les rôles voient désormais le même document : le vrai bulletin officiel (PDF, avec les
  // couleurs et le modèle réglés par l'école) — plus de carte interactive séparée pour
  // admin/enseignant, qui ne ressemblait pas à ce que voyaient élève/parent ni au PDF imprimé.

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

  const handleDownloadPdf = async () => {
    const selection = buildSelection();
    if (!eleveId || !selection || !bulletin) return;
    try {
      await bulletinApi.downloadPdf(Number(eleveId), selection, `bulletin_${bulletin.eleve.matricule}.pdf`);
    } catch (err) {
      // Sans ce catch, un échec (ex: bulletin pas encore complet) restait invisible pour
      // l'utilisateur — le bouton semblait "mort" (voir le même correctif sur les badges).
      setError(await extractBlobErrorMessage(err));
    }
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

  const handleSendWhatsApp = async () => {
    const selection = buildSelection();
    if (!eleveId || !selection) return;
    setSendingWhatsApp(true);
    setSendMessage("");
    try {
      const { data } = await bulletinApi.sendWhatsApp(Number(eleveId), selection);
      setSendMessage(data.detail);
    } catch (err) {
      setSendMessage(extractErrorMessage(err));
    } finally {
      setSendingWhatsApp(false);
    }
  };

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
            <Button variant="secondary" onClick={handleDownloadPdf}>⬇️ Télécharger</Button>
            {needsSelector && (
              <>
                <Button variant="secondary" onClick={handleSendEmail} disabled={sendingEmail}>
                  {sendingEmail ? "Envoi…" : "📧 Envoyer par email"}
                </Button>
                <Button variant="secondary" onClick={handleSendSms} disabled={sendingSms}>
                  {sendingSms ? "Envoi…" : "💬 Envoyer un lien SMS"}
                </Button>
                <Button variant="secondary" onClick={handleSendWhatsApp} disabled={sendingWhatsApp}>
                  {sendingWhatsApp ? "Envoi…" : "🟢 Envoyer par WhatsApp"}
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
      ) : (
        <PdfInlineViewer
          loadKey={`${eleveId}-${periodeValue}`}
          load={() => {
            const selection = buildSelection();
            if (!eleveId || !selection) return Promise.reject(new Error("Sélection incomplète."));
            return bulletinApi.previewPdf(Number(eleveId), selection, `bulletin_${bulletin.eleve.matricule}.pdf`);
          }}
        />
      )}
    </div>
  );
}
