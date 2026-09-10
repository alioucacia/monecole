import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { messagesApi, reunionsApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, EmptyState, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Message, Role, User } from "../types";

const TAILLE_MAX_FICHIER = 15 * 1024 * 1024; // 15 Mo, doit correspondre à la limite backend

/** Ordre d'affichage des catégories dans la liste de contacts — staff d'abord, puis
 * enseignants, puis familles/élèves (utile surtout pour comptabilité/surveillance, qui voient
 * désormais tout l'établissement plutôt qu'une poignée de relations pédagogiques). */
const ORDRE_ROLES: Role[] = ["admin", "comptabilite", "surveillance", "teacher", "parent", "student"];

function grouperContactsParRole(contacts: User[]) {
  const groupes = new Map<Role, User[]>();
  for (const c of contacts) {
    if (!groupes.has(c.role)) groupes.set(c.role, []);
    groupes.get(c.role)!.push(c);
  }
  return ORDRE_ROLES
    .filter((role) => groupes.has(role))
    .map((role) => ({ role, label: groupes.get(role)![0].role_display, contacts: groupes.get(role)! }));
}

function formatDuree(secondes: number) {
  const m = Math.floor(secondes / 60).toString().padStart(2, "0");
  const s = (secondes % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function MessagesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [appelEnCours, setAppelEnCours] = useState(false);
  const [contacts, setContacts] = useState<User[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [selected, setSelected] = useState<User | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [unreadByContact, setUnreadByContact] = useState<Record<number, number>>({});
  const [contactSearch, setContactSearch] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadContacts = () => {
    setLoadingContacts(true);
    Promise.all([messagesApi.contacts(), messagesApi.list({ box: "inbox", page_size: 200 })])
      .then(([contactsRes, inboxRes]) => {
        setContacts(contactsRes.data);
        const inbox = unwrapList(inboxRes.data);
        const counts: Record<number, number> = {};
        inbox.forEach((m) => {
          if (!m.lu) counts[m.expediteur] = (counts[m.expediteur] || 0) + 1;
        });
        setUnreadByContact(counts);
      })
      .finally(() => setLoadingContacts(false));
  };

  useEffect(loadContacts, []);

  // Coupe proprement le micro si l'utilisateur quitte la page en cours d'enregistrement.
  useEffect(() => () => {
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const openThread = (contact: User) => {
    setSelected(contact);
    setError("");
    setLoadingThread(true);
    messagesApi.list({ avec: contact.id, page_size: 200 }).then(({ data }) => {
      const messages = unwrapList(data).slice().reverse();
      setThread(messages);
      // Marquer comme lus les messages reçus non lus
      messages.filter((m) => m.destinataire === user?.id && !m.lu).forEach((m) => messagesApi.marquerLu(m.id));
      setUnreadByContact((prev) => ({ ...prev, [contact.id]: 0 }));
    }).finally(() => setLoadingThread(false));
  };

  const handleAppeler = async (contact: User, type: "audio" | "video") => {
    setAppelEnCours(true);
    try {
      const { data } = await reunionsApi.appelInstantane(contact.id, type);
      // Le destinataire n'a pas de notification en temps réel (pas de WebSocket dans ce
      // projet) : un message lui est envoyé automatiquement côté backend avec le lien de la
      // salle, en plus de rejoindre nous-même directement.
      navigate(`/visioconference?salle=${data.salle}`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setAppelEnCours(false);
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await messagesApi.create({ destinataire: selected.id, contenu: draft.trim() });
      setDraft("");
      openThread(selected);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de resélectionner le même fichier plus tard
    if (!file || !selected) return;
    if (file.size > TAILLE_MAX_FICHIER) {
      setError("Le fichier dépasse la taille maximale autorisée (15 Mo).");
      return;
    }
    setSending(true);
    setError("");
    try {
      await messagesApi.sendAttachment(selected.id, file, "fichier", file.name);
      openThread(selected);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (evt) => { if (evt.data.size > 0) chunksRef.current.push(evt.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        void sendVoiceMessage(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      setError("Impossible d'accéder au microphone. Vérifiez les autorisations du navigateur.");
    }
  };

  const stopRecording = (cancel = false) => {
    if (!mediaRecorderRef.current) return;
    if (cancel) chunksRef.current = [];
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const sendVoiceMessage = async (blob: Blob) => {
    if (!selected || blob.size === 0) return;
    setSending(true);
    setError("");
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      await messagesApi.sendAttachment(selected.id, blob, "vocal", `vocal.${extension}`);
      openThread(selected);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const recherche = contactSearch.trim().toLowerCase();
  const contactsFiltres = recherche
    ? contacts.filter((c) =>
        (c.full_name || c.username).toLowerCase().includes(recherche)
        || c.username.toLowerCase().includes(recherche)
        || c.role_display.toLowerCase().includes(recherche)
      )
    : contacts;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-ink-900 tracking-tight">Messagerie</h1>
        <p className="text-slate-500 mt-1.5">Échangez avec l'administration, les enseignants, élèves ou parents.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 h-[calc(100vh-14rem)] min-h-[420px]">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-y-auto flex flex-col">
          {!loadingContacts && contacts.length > 0 && (
            <div className="p-3 border-b border-slate-100 shrink-0">
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="🔍 Rechercher un contact…"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
              />
            </div>
          )}
          {loadingContacts ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : contacts.length === 0 ? (
            <EmptyState title="Aucun contact disponible" />
          ) : contactsFiltres.length === 0 ? (
            <EmptyState title="Aucun résultat" description={`Personne ne correspond à « ${contactSearch} ».`} />
          ) : (
            <div className="overflow-y-auto">
              {grouperContactsParRole(contactsFiltres).map((groupe) => (
                <div key={groupe.role}>
                  <p className="sticky top-0 px-4 py-1.5 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500 border-y border-slate-100">
                    {groupe.label} ({groupe.contacts.length})
                  </p>
                  <ul className="divide-y divide-slate-50">
                    {groupe.contacts.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => openThread(c)}
                          className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 transition ${
                            selected?.id === c.id ? "bg-brand-50" : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-700 truncate">{c.full_name || c.username}</p>
                          </div>
                          {unreadByContact[c.id] > 0 && (
                            <span className="shrink-0 h-5 min-w-5 px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center">
                              {unreadByContact[c.id]}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-soft flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState title="Sélectionnez un contact" description="Choisissez une personne dans la liste pour voir la conversation." />
            </div>
          ) : (
            <>
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-ink-900 truncate">{selected.full_name || selected.username}</p>
                  <p className="text-xs text-slate-400">{selected.role_display}</p>
                </div>
                <div className="shrink-0 flex items-center gap-3">
                  <button
                    onClick={() => handleAppeler(selected, "audio")}
                    disabled={appelEnCours}
                    className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50 whitespace-nowrap"
                  >
                    {appelEnCours ? "Démarrage…" : "🎙️ Appel audio"}
                  </button>
                  <button
                    onClick={() => handleAppeler(selected, "video")}
                    disabled={appelEnCours}
                    className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50 whitespace-nowrap"
                  >
                    {appelEnCours ? "Démarrage…" : "📹 Appel vidéo"}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {loadingThread ? (
                  <div className="flex justify-center py-10"><Spinner /></div>
                ) : thread.length === 0 ? (
                  <EmptyState title="Aucun message" description="Envoyez le premier message ci-dessous." />
                ) : (
                  thread.map((m) => {
                    const mine = m.expediteur === user?.id;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                          mine ? "bg-gradient-to-br from-brand-600 to-brand-700 text-white" : "bg-slate-100 text-slate-700"
                        }`}>
                          {m.type_message === "vocal" && m.fichier_url ? (
                            <audio controls src={m.fichier_url} className="max-w-full h-9" />
                          ) : m.type_message === "fichier" && m.fichier_url ? (
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
                            {new Date(m.date_envoi).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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
                  type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || isRecording}
                  title="Joindre un fichier"
                  className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                >
                  📎
                </button>

                {isRecording ? (
                  <div className="flex-1 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
                    <span className="text-sm font-medium text-rose-600">Enregistrement… {formatDuree(recordingSeconds)}</span>
                    <button type="button" onClick={() => stopRecording(true)} className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-700">
                      Annuler
                    </button>
                  </div>
                ) : (
                  <input
                    value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Écrire un message…"
                    disabled={sending}
                    className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400 disabled:opacity-60"
                  />
                )}

                <button
                  type="button"
                  onClick={() => (isRecording ? stopRecording() : startRecording())}
                  disabled={sending}
                  title={isRecording ? "Arrêter et envoyer" : "Message vocal"}
                  className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-xl transition disabled:opacity-40 ${
                    isRecording ? "bg-rose-600 text-white hover:bg-rose-700" : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {isRecording ? "⏹️" : "🎙️"}
                </button>

                {!isRecording && <Button type="submit" disabled={sending || !draft.trim()}>{sending ? "…" : "Envoyer"}</Button>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
