import { useEffect, useRef, useState, type FormEvent } from "react";

import { assistantIaApi } from "../api/services";
import { PageHeader, Spinner } from "../components/ui";
import type { MessageIA } from "../types";

export default function AssistantIAPage() {
  const [messages, setMessages] = useState<MessageIA[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    assistantIaApi.historique().then(({ data }) => setMessages(data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const texte = input.trim();
    if (!texte || sending) return;
    setInput("");
    setSending(true);
    // Affichage optimiste du message de l'élève pendant que la réponse arrive.
    const optimiste: MessageIA = { id: -Date.now(), role: "user", contenu: texte, cree_le: new Date().toISOString() };
    setMessages((prev) => [...prev, optimiste]);
    try {
      const { data } = await assistantIaApi.envoyer(texte);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimiste.id), data.message, data.reponse]);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimiste.id));
      setInput(texte);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader title="Assistant IA" description="Pose tes questions sur tes cours — l'assistant connaît tes matières en difficulté." />

      <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-100 shadow-soft p-4 space-y-3 mb-4">
        {loading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2">
            <span className="text-4xl">🤖</span>
            <p className="text-sm">Pose ta première question — par exemple « Comment progresser en mathématiques ? »</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "bg-brand-600 text-white rounded-br-sm" : "bg-slate-100 text-slate-700 rounded-bl-sm"
                }`}
              >
                {m.contenu}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 text-slate-400 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">L'assistant réfléchit…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Écris ta question…"
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="bg-brand-600 text-white font-semibold text-sm rounded-xl px-5 disabled:opacity-50"
        >
          Envoyer
        </button>
      </form>
    </div>
  );
}
