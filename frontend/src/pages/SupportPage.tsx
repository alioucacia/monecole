import { useEffect, useRef, useState, type FormEvent } from "react";

import { supportApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, Select, Spinner, Textarea } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { MessageTicket, PrioriteTicket, StatutTicket, Ticket } from "../types";

const STATUT_BADGE: Record<StatutTicket, { color: "amber" | "brand" | "green" | "slate" }> = {
  ouvert: { color: "amber" },
  en_cours: { color: "brand" },
  resolu: { color: "green" },
  ferme: { color: "slate" },
};

const PRIORITE_BADGE: Record<PrioriteTicket, { color: "slate" | "teal" | "amber" | "rose" }> = {
  basse: { color: "slate" },
  normale: { color: "teal" },
  haute: { color: "amber" },
  urgente: { color: "rose" },
};

const PRIORITE_OPTIONS: { value: PrioriteTicket; label: string }[] = [
  { value: "basse", label: "Basse" },
  { value: "normale", label: "Normale" },
  { value: "haute", label: "Haute" },
  { value: "urgente", label: "Urgente" },
];

const STATUT_OPTIONS: { value: StatutTicket; label: string }[] = [
  { value: "ouvert", label: "Ouvert" },
  { value: "en_cours", label: "En cours de traitement" },
  { value: "resolu", label: "Résolu" },
  { value: "ferme", label: "Fermé" },
];

const TAILLE_MAX_FICHIER = 15 * 1024 * 1024; // 15 Mo, doit correspondre à la limite backend

export default function SupportPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "superadmin";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [thread, setThread] = useState<MessageTicket[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [changingStatut, setChangingStatut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [newForm, setNewForm] = useState({ sujet: "", priorite: "normale" as PrioriteTicket, message: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadTickets = () => {
    setLoadingTickets(true);
    supportApi.list({ page_size: 200 }).then(({ data }) => setTickets(unwrapList(data))).finally(() => setLoadingTickets(false));
  };

  useEffect(loadTickets, []);

  const openThread = (ticket: Ticket) => {
    setSelected(ticket);
    setError("");
    setLoadingThread(true);
    supportApi.messages(ticket.id).then(({ data }) => setThread(unwrapList(data))).finally(() => setLoadingThread(false));
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await supportApi.envoyerMessage(selected.id, draft.trim());
      setDraft("");
      openThread(selected);
      loadTickets();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected) return;
    if (file.size > TAILLE_MAX_FICHIER) {
      setError("Le fichier dépasse la taille maximale autorisée (15 Mo).");
      return;
    }
    setSending(true);
    setError("");
    try {
      await supportApi.envoyerPieceJointe(selected.id, file);
      openThread(selected);
      loadTickets();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleChangerStatut = async (statut: StatutTicket) => {
    if (!selected) return;
    setChangingStatut(true);
    try {
      const { data } = await supportApi.changerStatut(selected.id, { statut });
      setSelected(data);
      loadTickets();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setChangingStatut(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const { data } = await supportApi.create(newForm);
      setModalOpen(false);
      setNewForm({ sujet: "", priorite: "normale", message: "" });
      loadTickets();
      openThread(data);
    } catch (err) {
      setCreateError(extractErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold text-ink-900 tracking-tight">Support technique</h1>
          <p className="text-slate-500 mt-1.5">
            {isSuperAdmin ? "Tickets ouverts par les établissements de la plateforme." : "Une question, un problème ? Contactez le support technique."}
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ Nouveau ticket</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 h-[calc(100vh-14rem)] min-h-[420px]">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-y-auto flex flex-col">
          {loadingTickets ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : tickets.length === 0 ? (
            <EmptyState title="Aucun ticket" description="Ouvrez-en un si vous avez besoin d'aide." />
          ) : (
            <ul className="divide-y divide-slate-50">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => openThread(t)}
                    className={`w-full text-left px-4 py-3 transition ${selected?.id === t.id ? "bg-brand-50" : "hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-semibold text-slate-700 truncate">{t.sujet}</p>
                      <Badge color={STATUT_BADGE[t.statut].color}>{t.statut_display}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      {isSuperAdmin && <span className="truncate">{t.ecole_nom || t.auteur_nom}</span>}
                      <Badge color={PRIORITE_BADGE[t.priorite].color}>{t.priorite_display}</Badge>
                      <span className="ml-auto shrink-0">{new Date(t.maj_le).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-soft flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState title="Sélectionnez un ticket" description="Choisissez un ticket dans la liste, ou ouvrez-en un nouveau." />
            </div>
          ) : (
            <>
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-bold text-ink-900 truncate">{selected.sujet}</p>
                  <p className="text-xs text-slate-400">
                    {selected.auteur_nom}{selected.ecole_nom ? ` · ${selected.ecole_nom}` : ""} · {new Date(selected.cree_le).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                {isSuperAdmin ? (
                  <Select
                    value={selected.statut}
                    onChange={(e) => handleChangerStatut(e.target.value as StatutTicket)}
                    disabled={changingStatut}
                    className="max-w-[200px] text-xs"
                  >
                    {STATUT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                ) : (
                  <Badge color={STATUT_BADGE[selected.statut].color}>{selected.statut_display}</Badge>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {loadingThread ? (
                  <div className="flex justify-center py-10"><Spinner /></div>
                ) : thread.length === 0 ? (
                  <EmptyState title="Aucun message" />
                ) : (
                  thread.map((m) => {
                    const mine = m.auteur === user?.id;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                          mine ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white" : "bg-slate-100 text-slate-700"
                        }`}>
                          {!mine && <p className="text-[10px] font-bold uppercase tracking-wide opacity-60 mb-0.5">{m.auteur_nom}</p>}
                          {m.fichier_url ? (
                            <a
                              href={m.fichier_url} target="_blank" rel="noreferrer" download
                              className={`flex items-center gap-2 underline decoration-dotted ${mine ? "text-white" : "text-brand-700"}`}
                            >
                              📎 <span className="truncate">{m.fichier_nom || "Pièce jointe"}</span>
                            </a>
                          ) : (
                            <p className="whitespace-pre-wrap">{m.contenu}</p>
                          )}
                          <p className={`text-[10px] mt-1 ${mine ? "text-brand-100" : "text-slate-400"}`}>
                            {new Date(m.cree_le).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {error && <p className="px-4 pb-2 text-sm text-rose-600">{error}</p>}

              <form onSubmit={handleSend} className="p-4 border-t border-slate-100 flex items-center gap-2">
                <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
                <button
                  type="button" onClick={() => fileInputRef.current?.click()} disabled={sending}
                  title="Joindre un fichier"
                  className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                >
                  📎
                </button>
                <input
                  value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Écrire une réponse…"
                  disabled={sending}
                  className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400 disabled:opacity-60"
                />
                <Button type="submit" disabled={sending || !draft.trim()}>{sending ? "…" : "Envoyer"}</Button>
              </form>
            </>
          )}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau ticket de support">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Sujet" required value={newForm.sujet} onChange={(e) => setNewForm({ ...newForm, sujet: e.target.value })} />
          <Select label="Priorité" value={newForm.priorite} onChange={(e) => setNewForm({ ...newForm, priorite: e.target.value as PrioriteTicket })}>
            {PRIORITE_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <Textarea label="Décrivez votre problème" required rows={5} value={newForm.message} onChange={(e) => setNewForm({ ...newForm, message: e.target.value })} />

          {createError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{createError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={creating}>{creating ? "Envoi…" : "Envoyer le ticket"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
