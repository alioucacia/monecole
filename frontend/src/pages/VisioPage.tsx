import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { reunionsApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import type { Participant, Reunion, Role } from "../types";

/** Ordre d'affichage des catégories dans le sélecteur de participants — staff d'abord, puis
 * enseignants, puis familles/élèves. */
const ORDRE_ROLES: Role[] = ["admin", "comptabilite", "surveillance", "teacher", "parent", "student"];

function grouperParRole(participants: Participant[]) {
  const groupes = new Map<Role, Participant[]>();
  for (const p of participants) {
    if (!groupes.has(p.role)) groupes.set(p.role, []);
    groupes.get(p.role)!.push(p);
  }
  return ORDRE_ROLES
    .filter((role) => groupes.has(role))
    .map((role) => ({ role, label: groupes.get(role)![0].role_display, participants: groupes.get(role)! }));
}

const STATUT_COLORS: Record<Reunion["statut"], "brand" | "teal" | "amber" | "rose" | "slate"> = {
  planifiee: "brand", en_cours: "teal", terminee: "slate", annulee: "rose",
};

const emptyForm = { titre: "", description: "", date_debut: "", duree_minutes: 30, participants: [] as number[] };

/** Génère l'URL Jitsi Meet à partir du nom de salle, avec la page de pré-jonction désactivée
 * (on a déjà les infos du participant côté plateforme), l'interface forcée en français
 * (`config.defaultLanguage` — meet.jit.si détecte sinon la langue du navigateur, pas toujours
 * le français) et les toolbars essentielles visibles. `avecVideo=false` (appel audio) coupe la
 * caméra à l'entrée dans la salle — chaque participant peut la rallumer lui-même ensuite. */
function jitsiUrl(salle: string, avecVideo: boolean = true) {
  const base = `https://meet.jit.si/${salle}#config.prejoinPageEnabled=false&config.defaultLanguage=%22fr%22&userInfo.displayName=%22Participant%22`;
  return avecVideo ? base : `${base}&config.startWithVideoMuted=true`;
}

export default function VisioPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmer = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const [reunions, setReunions] = useState<Reunion[]>([]);
  const [loading, setLoading] = useState(true);
  const [participantsPossibles, setParticipantsPossibles] = useState<Participant[]>([]);
  const [categorieFiltre, setCategorieFiltre] = useState<Role | "">("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const salleActive = searchParams.get("salle");
  const reunionActive = reunions.find((r) => r.salle === salleActive) || null;

  const load = () => {
    setLoading(true);
    reunionsApi.list({ page_size: 100 })
      .then(({ data }) => setReunions(unwrapList(data)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    reunionsApi.participantsPossibles().then(({ data }) => setParticipantsPossibles(data)).catch(() => {});
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setError("");
    setCategorieFiltre("");
    setModalOpen(true);
  };

  const toggleParticipant = (id: number) => {
    setForm((prev) => ({
      ...prev,
      participants: prev.participants.includes(id)
        ? prev.participants.filter((p) => p !== id)
        : [...prev.participants, id],
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await reunionsApi.create({
        titre: form.titre,
        description: form.description,
        date_debut: new Date(form.date_debut).toISOString(),
        duree_minutes: form.duree_minutes,
        participants: form.participants,
      });
      setModalOpen(false);
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAnnuler = async (r: Reunion) => {
    if (!(await confirmer(`Annuler « ${r.titre} » ?`, { danger: true }))) return;
    try {
      await reunionsApi.remove(r.id);
      load();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const rejoindre = (r: Reunion) => setSearchParams({ salle: r.salle });
  const quitter = () => setSearchParams({});

  if (reunionActive) {
    return (
      <div className="h-[calc(100vh-2rem)] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-ink-900">{reunionActive.titre}</h2>
            <p className="text-xs text-slate-400">
              {reunionActive.participants_detail.length + 1} participant{reunionActive.participants_detail.length ? "s" : ""} invité(s)
            </p>
          </div>
          <Button variant="secondary" onClick={quitter}>← Quitter la réunion</Button>
        </div>
        <div className="flex-1 rounded-2xl2 overflow-hidden border border-slate-100 shadow-card bg-ink-950">
          <iframe
            src={jitsiUrl(reunionActive.salle, reunionActive.avec_video)}
            title={reunionActive.titre}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            className="w-full h-full border-0"
          />
        </div>
      </div>
    );
  }

  const aVenir = reunions.filter((r) => r.statut === "planifiee" || r.statut === "en_cours");
  const passees = reunions.filter((r) => r.statut === "terminee" || r.statut === "annulee");

  return (
    <div>
      <PageHeader
        title="Visioconférence"
        description="Organisez des réunions vidéo ou démarrez un appel avec un contact de votre établissement."
        actions={<Button onClick={openCreate}>+ Nouvelle réunion</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : reunions.length === 0 ? (
        <EmptyState title="Aucune réunion" description="Planifiez votre première réunion vidéo, ou lancez un appel depuis la messagerie." />
      ) : (
        <div className="space-y-8">
          {aVenir.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">À venir / en cours</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {aVenir.map((r) => (
                  <div key={r.id} className="bg-white rounded-2xl2 border border-slate-100 shadow-card p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-ink-900">{r.titre}</h4>
                      <Badge color={STATUT_COLORS[r.statut]}>{r.statut_display}</Badge>
                    </div>
                    {r.description && <p className="text-xs text-slate-500">{r.description}</p>}
                    <p className="text-xs text-slate-400">
                      📅 {new Date(r.date_debut).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })} · {r.duree_minutes} min
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      👤 {r.organisateur_nom}{r.participants_detail.length > 0 && ` + ${r.participants_detail.length}`}
                    </p>
                    <div className="flex gap-2 mt-1">
                      <Button onClick={() => rejoindre(r)} className="flex-1">{r.avec_video ? "📹" : "🎙️"} Rejoindre</Button>
                      {(r.est_organisateur || user?.role === "admin") && (
                        <button onClick={() => handleAnnuler(r)} className="text-xs font-semibold text-rose-600 hover:underline px-2">
                          Annuler
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {passees.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Terminées / annulées</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {passees.map((r) => (
                  <div key={r.id} className="bg-white rounded-2xl2 border border-slate-100 p-5 flex flex-col gap-2 opacity-70">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-slate-600">{r.titre}</h4>
                      <Badge color={STATUT_COLORS[r.statut]}>{r.statut_display}</Badge>
                    </div>
                    <p className="text-xs text-slate-400">
                      📅 {new Date(r.date_debut).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle réunion">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Titre" required value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} />
          <Input
            label="Description (optionnel)" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date et heure" type="datetime-local" required
              value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })}
            />
            <Input
              label="Durée (minutes)" type="number" min={5} max={480} required
              value={form.duree_minutes} onChange={(e) => setForm({ ...form, duree_minutes: Number(e.target.value) })}
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="block text-sm font-semibold text-slate-600">Participants</span>
              {participantsPossibles.length > 0 && (
                <Select
                  value={categorieFiltre}
                  onChange={(e) => setCategorieFiltre(e.target.value as Role | "")}
                  className="!w-auto !py-1.5 text-xs"
                >
                  <option value="">Toutes les catégories</option>
                  {grouperParRole(participantsPossibles).map((groupe) => (
                    <option key={groupe.role} value={groupe.role}>{groupe.label} ({groupe.participants.length})</option>
                  ))}
                </Select>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
              {participantsPossibles.length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-2">Aucun autre compte dans votre établissement.</p>
              ) : (
                grouperParRole(participantsPossibles)
                  .filter((groupe) => !categorieFiltre || groupe.role === categorieFiltre)
                  .map((groupe) => {
                  const idsGroupe = groupe.participants.map((p) => p.id);
                  const tousSelectionnes = idsGroupe.every((id) => form.participants.includes(id));
                  return (
                    <div key={groupe.role} className="border-b border-slate-100 last:border-b-0">
                      <label className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500 cursor-pointer">
                        <span>{groupe.label} ({groupe.participants.length})</span>
                        <input
                          type="checkbox"
                          checked={tousSelectionnes}
                          onChange={() => setForm((prev) => ({
                            ...prev,
                            participants: tousSelectionnes
                              ? prev.participants.filter((id) => !idsGroupe.includes(id))
                              : [...new Set([...prev.participants, ...idsGroupe])],
                          }))}
                          title="Tout sélectionner dans cette catégorie"
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                        />
                      </label>
                      <div className="divide-y divide-slate-100">
                        {groupe.participants.map((p) => (
                          <label key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                            <span>{p.full_name || p.username}</span>
                            <input
                              type="checkbox"
                              checked={form.participants.includes(p.id)}
                              onChange={() => toggleParticipant(p.id)}
                              className="h-4 w-4 rounded border-slate-300 text-brand-600"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Création…" : "Planifier la réunion"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
