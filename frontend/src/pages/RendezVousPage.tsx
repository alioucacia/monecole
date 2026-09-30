import { useCallback, useEffect, useState, type FormEvent } from "react";

import { elevesApi, rendezVousApi, unwrapList, type RendezVous, type StatutRendezVous } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm, usePrompt } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import type { EleveProfile } from "../types";

const STATUTS: Record<StatutRendezVous, { label: string; color: "amber" | "green" | "rose" | "slate" }> = {
  en_attente: { label: "En attente", color: "amber" },
  accepte: { label: "Accepté", color: "green" },
  refuse: { label: "Refusé", color: "rose" },
  annule: { label: "Annulé", color: "slate" },
};

const MOTIFS = [
  { value: "resultats", label: "Résultats scolaires" },
  { value: "comportement", label: "Comportement" },
  { value: "absences", label: "Absences / retards" },
  { value: "orientation", label: "Orientation" },
  { value: "autre", label: "Autre" },
];

function dateLongue(date: string, heure: string) {
  const jour = new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} à ${heure.slice(0, 5).replace(":", "h")}`;
}

const formVide = { eleve: "", enseignant: "", date: "", heure: "", motif: "resultats", message: "" };

/** Rendez-vous parents ↔ enseignants : le parent demande (enfant, enseignant, date, heure,
 * motif), l'enseignant accepte ou refuse, le parent peut annuler. La direction voit tout. */
export default function RendezVousPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmer = useConfirm();
  const demander = usePrompt();
  const estParent = user?.role === "parent";
  const estEnseignant = user?.role === "teacher";

  const [liste, setListe] = useState<RendezVous[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState("");
  const [enCours, setEnCours] = useState<number | null>(null);

  const [enfants, setEnfants] = useState<EleveProfile[]>([]);
  const [enseignants, setEnseignants] = useState<{ id: number; nom: string; matieres: string[] }[]>([]);
  const [form, setForm] = useState(formVide);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    setLoading(true);
    rendezVousApi.list({ statut: filtre || undefined })
      .then(({ data }) => setListe(unwrapList(data)))
      .catch((err) => toast.error(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [filtre, toast]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!estParent) return;
    elevesApi.list({ page_size: 50 }).then(({ data }) => {
      const liste = unwrapList(data);
      setEnfants(liste);
      if (liste.length === 1) setForm((f) => ({ ...f, eleve: String(liste[0].id) }));
    });
  }, [estParent]);

  useEffect(() => {
    setEnseignants([]);
    if (!form.eleve) return;
    rendezVousApi.enseignants(Number(form.eleve)).then(({ data }) => setEnseignants(data)).catch(() => setEnseignants([]));
  }, [form.eleve]);

  const demanderRdv = async (e: FormEvent) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await rendezVousApi.create({ ...form, eleve: Number(form.eleve), enseignant: Number(form.enseignant) });
      toast.success("Demande envoyée : l'enseignant va l'accepter ou la refuser.");
      setForm({ ...formVide, eleve: form.eleve });
      charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setEnvoi(false);
    }
  };

  const repondre = async (r: RendezVous, accepter: boolean) => {
    const reponse = await demander(
      accepter
        ? "Message pour le parent (facultatif) — ex : lieu du rendez-vous."
        : "Motif du refus ou autre créneau proposé (facultatif).",
      { title: accepter ? "Accepter le rendez-vous" : "Refuser le rendez-vous", label: "Message", confirmLabel: accepter ? "Accepter" : "Refuser" },
    );
    if (reponse === null) return;
    setEnCours(r.id);
    try {
      await (accepter ? rendezVousApi.accepter(r.id, reponse) : rendezVousApi.refuser(r.id, reponse));
      toast.success(accepter ? "Rendez-vous accepté : le parent est prévenu." : "Rendez-vous refusé : le parent est prévenu.");
      charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setEnCours(null);
    }
  };

  const annuler = async (r: RendezVous) => {
    if (!(await confirmer(`Annuler le rendez-vous du ${dateLongue(r.date, r.heure)} avec ${r.enseignant_nom} ?`, { danger: true }))) return;
    setEnCours(r.id);
    try {
      await rendezVousApi.annuler(r.id);
      toast.success("Rendez-vous annulé : l'enseignant est prévenu.");
      charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setEnCours(null);
    }
  };

  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Rendez-vous"
        description={
          estParent ? "Demandez un rendez-vous à un enseignant de votre enfant — il l'accepte ou le refuse."
          : estEnseignant ? "Demandes de rendez-vous des parents : acceptez ou refusez-les."
          : "Tous les rendez-vous parents ↔ enseignants de l'établissement."
        }
      />

      {estParent && (
        <Card className="mb-6">
          <h3 className="font-bold text-ink-900 mb-4">Nouvelle demande</h3>
          <form noValidate onSubmit={demanderRdv} className="grid gap-4 sm:grid-cols-2">
            <Select label="Enfant" required value={form.eleve} onChange={(e) => setForm({ ...form, eleve: e.target.value, enseignant: "" })}>
              <option value="">— Choisir —</option>
              {enfants.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}{el.classe_nom ? ` (${el.classe_nom})` : ""}</option>)}
            </Select>
            <Select label="Enseignant" required value={form.enseignant} onChange={(e) => setForm({ ...form, enseignant: e.target.value })} disabled={!form.eleve}>
              <option value="">{form.eleve && enseignants.length === 0 ? "— Aucun enseignant pour cette classe —" : "— Choisir —"}</option>
              {enseignants.map((en) => <option key={en.id} value={en.id}>{en.nom} — {en.matieres.join(", ")}</option>)}
            </Select>
            <Input label="Date" type="date" required min={aujourdhui} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Input label="Heure" type="time" required value={form.heure} onChange={(e) => setForm({ ...form, heure: e.target.value })} />
            <Select label="Motif" required value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })}>
              {MOTIFS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Textarea label="Précision (facultatif)" rows={2} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={envoi}>{envoi ? "Envoi…" : "📅 Demander le rendez-vous"}</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <Select value={filtre} onChange={(e) => setFiltre(e.target.value)} className="w-auto">
          <option value="">Tous les rendez-vous</option>
          {Object.entries(STATUTS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : liste.length === 0 ? (
        <EmptyState title="Aucun rendez-vous" description={estParent ? "Vos demandes apparaîtront ici." : "Aucune demande pour le moment."} />
      ) : (
        <div className="space-y-3">
          {liste.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-bold text-ink-900">📅 {dateLongue(r.date, r.heure)}</p>
                  <p className="text-sm text-slate-600">
                    {estParent ? <>Avec <b>{r.enseignant_nom}</b></> : estEnseignant ? <>Parent : <b>{r.parent_nom}</b></> : <><b>{r.parent_nom}</b> → <b>{r.enseignant_nom}</b></>}
                    {" "}· Élève : {r.eleve_nom}{r.classe_nom ? ` (${r.classe_nom})` : ""}
                  </p>
                  <p className="text-sm text-slate-500">Motif : {r.motif_display}{r.message ? ` — ${r.message}` : ""}</p>
                  {r.reponse && <p className="text-sm text-brand-700">💬 Réponse de l'enseignant : {r.reponse}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge color={STATUTS[r.statut].color}>{STATUTS[r.statut].label}</Badge>
                  {estEnseignant && r.statut === "en_attente" && (
                    <div className="flex gap-2">
                      <Button onClick={() => repondre(r, true)} disabled={enCours === r.id}>✓ Accepter</Button>
                      <Button variant="danger" onClick={() => repondre(r, false)} disabled={enCours === r.id}>✕ Refuser</Button>
                    </div>
                  )}
                  {estParent && (r.statut === "en_attente" || r.statut === "accepte") && (
                    <button onClick={() => annuler(r)} disabled={enCours === r.id} className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50">
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
