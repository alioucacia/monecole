import { useEffect, useState, type FormEvent } from "react";

import { classesApi, creneauxApi, enseignementsApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, DeleteButton, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import type { Classe, Creneau, Cycle, Enseignement } from "../types";

const JOURS: { value: string; label: string }[] = [
  { value: "lundi", label: "Lundi" }, { value: "mardi", label: "Mardi" }, { value: "mercredi", label: "Mercredi" },
  { value: "jeudi", label: "Jeudi" }, { value: "vendredi", label: "Vendredi" }, { value: "samedi", label: "Samedi" },
];

const emptyForm = { enseignement: "", jour: "lundi", heure_debut: "08:00", heure_fin: "10:00", salle: "" };

export default function SchedulePage() {
  const { user } = useAuth();
  const confirmer = useConfirm();
  const isAdmin = user?.role === "admin";

  const [classes, setClasses] = useState<Classe[]>([]);
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  const [classeId, setClasseId] = useState("");
  const [enseignements, setEnseignements] = useState<Enseignement[]>([]);
  const [creneaux, setCreneaux] = useState<Creneau[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Creneau | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isAdmin) classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
  }, [isAdmin]);

  const loadCreneaux = () => {
    setLoading(true);
    const params = isAdmin && classeId ? { classe: classeId } : {};
    Promise.all([
      creneauxApi.list({ ...params, page_size: 200 }),
      isAdmin && classeId ? enseignementsApi.list({ classe: classeId }) : Promise.resolve({ data: [] as Enseignement[] }),
    ]).then(([cRes, eRes]) => {
      setCreneaux(unwrapList(cRes.data as any));
      setEnseignements(unwrapList(eRes.data as any));
    }).finally(() => setLoading(false));
  };

  useEffect(loadCreneaux, [isAdmin, classeId]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setModalOpen(true);
  };

  const openEdit = (c: Creneau) => {
    setEditing(c);
    setForm({ enseignement: String(c.enseignement), jour: c.jour, heure_debut: c.heure_debut.slice(0, 5), heure_fin: c.heure_fin.slice(0, 5), salle: c.salle });
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, enseignement: Number(form.enseignement), classe: Number(classeId) };
      if (editing) await creneauxApi.update(editing.id, payload);
      else await creneauxApi.create(payload);
      setModalOpen(false);
      loadCreneaux();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Creneau) => {
    if (!(await confirmer("Supprimer ce créneau ?", { danger: true }))) return;
    await creneauxApi.remove(c.id);
    loadCreneaux();
  };

  return (
    <div>
      <PageHeader
        title="Emploi du temps"
        description={isAdmin ? "Gérer l'emploi du temps par classe." : "Votre emploi du temps hebdomadaire."}
        actions={isAdmin && classeId ? <Button onClick={openCreate}>+ Ajouter un créneau</Button> : undefined}
      />

      {isAdmin && (
        <div className="flex flex-wrap gap-3 mb-6">
          <CycleSelect
            value={cycleFiltre}
            onChange={(c) => { setCycleFiltre(c); setClasseId(""); }}
            className="max-w-xs"
          />
          <Select value={classeId} onChange={(e) => setClasseId(e.target.value)} className="max-w-xs">
            <option value="">— Sélectionner une classe —</option>
            {classes.filter((c) => !cycleFiltre || c.cycle === cycleFiltre).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Select>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : isAdmin && !classeId ? (
        <EmptyState title="Sélectionnez une classe pour afficher son emploi du temps" />
      ) : creneaux.length === 0 ? (
        <EmptyState title="Aucun créneau programmé" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {JOURS.map((jour) => {
            const items = creneaux
              .filter((c) => c.jour === jour.value)
              .sort((a, b) => a.heure_debut.localeCompare(b.heure_debut));
            return (
              <div key={jour.value} className="bg-white rounded-2xl border border-slate-100 shadow-soft p-3.5">
                <h4 className="font-bold text-ink-900 mb-3 text-sm">{jour.label}</h4>
                <div className="space-y-2">
                  {items.length === 0 && <p className="text-xs text-slate-400">—</p>}
                  {items.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl p-2.5 text-xs text-white shadow-soft cursor-pointer transition hover:-translate-y-0.5"
                      style={{ backgroundColor: c.matiere_couleur }}
                      onClick={() => isAdmin && openEdit(c)}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="font-semibold">{c.matiere_nom}</p>
                        {isAdmin && (
                          <DeleteButton
                            tone="light"
                            size="sm"
                            className="-mt-1 -mr-1"
                            onClick={(e) => { e.stopPropagation(); handleDelete(c); }}
                          />
                        )}
                      </div>
                      <p className="opacity-90">{c.heure_debut.slice(0, 5)} - {c.heure_fin.slice(0, 5)}</p>
                      {!isAdmin && <p className="opacity-90">{c.classe_nom} · {c.enseignant_nom}</p>}
                      {c.salle && <p className="opacity-80">Salle {c.salle}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier le créneau" : "Nouveau créneau"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select label="Matière / Enseignant" required value={form.enseignement} onChange={(e) => setForm({ ...form, enseignement: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {enseignements.map((e) => <option key={e.id} value={e.id}>{e.matiere_nom} — {e.enseignant_nom}</option>)}
          </Select>
          <Select label="Jour" value={form.jour} onChange={(e) => setForm({ ...form, jour: e.target.value })}>
            {JOURS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Heure de début" type="time" required value={form.heure_debut} onChange={(e) => setForm({ ...form, heure_debut: e.target.value })} />
            <Input label="Heure de fin" type="time" required value={form.heure_fin} onChange={(e) => setForm({ ...form, heure_fin: e.target.value })} />
          </div>
          <Input label="Salle" value={form.salle} onChange={(e) => setForm({ ...form, salle: e.target.value })} />

          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
