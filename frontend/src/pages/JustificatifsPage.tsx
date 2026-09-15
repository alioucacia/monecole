import { useEffect, useRef, useState, type FormEvent } from "react";

import { elevesApi, justificatifsApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { usePrompt } from "../context/ConfirmContext";
import type { EleveProfile, JustificatifAbsence } from "../types";

const STATUT_LABELS: Record<string, { label: string; color: "amber" | "green" | "rose" }> = {
  en_attente: { label: "En attente", color: "amber" },
  approuve: { label: "Approuvé", color: "green" },
  rejete: { label: "Rejeté", color: "rose" },
};
const MOTIF_LABELS: Record<string, string> = { maladie: "Maladie", autre: "Autre motif" };

const emptyForm = { eleve: "", date_absence: "", motif: "maladie", description: "" };

export default function JustificatifsPage() {
  const { user } = useAuth();
  const demander = usePrompt();
  const peutTraiter = user?.role === "admin" || user?.role === "surveillance";
  const peutSoumettre = user?.role === "student" || user?.role === "parent" || user?.role === "admin" || user?.role === "surveillance";

  const [items, setItems] = useState<JustificatifAbsence[]>([]);
  const [enfants, setEnfants] = useState<EleveProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [fichier, setFichier] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    justificatifsApi.list({ page_size: 100 }).then(({ data }) => setItems(unwrapList(data))).finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (user?.role === "parent") {
      elevesApi.list({ page_size: 100 }).then(({ data }) => setEnfants(unwrapList(data)));
    }
    if (user?.role === "student") {
      // L'API élèves ne renvoie que le profil de l'élève connecté pour ce rôle.
      elevesApi.list().then(({ data }) => {
        const mine = unwrapList(data)[0];
        if (mine) setForm((f) => ({ ...f, eleve: String(mine.id) }));
      });
    }
  }, [user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await justificatifsApi.create({
        eleve: Number(form.eleve), date_absence: form.date_absence, motif: form.motif,
        description: form.description, piece_jointe: fichier,
      });
      setForm(emptyForm);
      setFichier(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTraiter = async (item: JustificatifAbsence, approuve: boolean) => {
    const commentaire = await demander(
      approuve ? "Vous pouvez ajouter un commentaire à cette approbation." : "Vous pouvez préciser le motif de ce rejet.",
      { title: approuve ? "Approuver" : "Rejeter", label: "Commentaire (optionnel)", confirmLabel: approuve ? "Approuver" : "Rejeter" }
    ) || "";
    if (approuve) await justificatifsApi.approuver(item.id, commentaire);
    else await justificatifsApi.rejeter(item.id, commentaire);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Justificatifs d'absence"
        description={peutTraiter ? "Validez les justificatifs soumis par les élèves et leurs parents." : "Signalez une absence ou une maladie avec une preuve à l'appui."}
      />

      {peutSoumettre && (user?.role === "student" || user?.role === "parent") && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {user?.role === "parent" && (
            <Select label="Enfant concerné" required value={form.eleve} onChange={(e) => setForm({ ...form, eleve: e.target.value })}>
              <option value="">— Sélectionner —</option>
              {enfants.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
            </Select>
          )}
          <Input label="Date de l'absence" type="date" required value={form.date_absence} onChange={(e) => setForm({ ...form, date_absence: e.target.value })} />
          <Select label="Motif" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })}>
            <option value="maladie">Maladie</option>
            <option value="autre">Autre motif</option>
          </Select>
          <Input label="Description (optionnel)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="sm:col-span-2" />
          <label className="block sm:col-span-2">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Preuve (certificat médical, etc. — optionnel)</span>
            <input ref={fileRef} type="file" onChange={(e) => setFichier(e.target.files?.[0] || null)} className="text-sm" />
          </label>
          {error && <p className="sm:col-span-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving || !form.eleve}>{saving ? "Envoi…" : "Soumettre le justificatif"}</Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun justificatif" />
      ) : (
        <Table headers={["Élève", "Date", "Motif", "Description", "Preuve", "Statut", ...(peutTraiter ? ["Actions"] : [])]}>
          {items.map((j) => (
            <tr key={j.id}>
              <td className="px-4 py-3 font-medium text-slate-700">{j.eleve_nom}</td>
              <td className="px-4 py-3">{new Date(j.date_absence).toLocaleDateString("fr-FR")}</td>
              <td className="px-4 py-3">{MOTIF_LABELS[j.motif]}</td>
              <td className="px-4 py-3 text-xs text-slate-500 max-w-[220px] truncate">{j.description || "—"}</td>
              <td className="px-4 py-3">
                {j.piece_jointe ? <a href={j.piece_jointe} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">Voir</a> : "—"}
              </td>
              <td className="px-4 py-3"><Badge color={STATUT_LABELS[j.statut].color}>{STATUT_LABELS[j.statut].label}</Badge></td>
              {peutTraiter && (
                <td className="px-4 py-3">
                  {j.statut === "en_attente" ? (
                    <div className="flex gap-3">
                      <button className="text-xs font-semibold text-emerald-600 hover:underline" onClick={() => handleTraiter(j, true)}>Approuver</button>
                      <button className="text-xs font-semibold text-rose-600 hover:underline" onClick={() => handleTraiter(j, false)}>Rejeter</button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">{j.traite_par_nom}</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
