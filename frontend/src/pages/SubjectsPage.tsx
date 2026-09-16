import { useEffect, useState, type FormEvent } from "react";

import { matieresApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import type { Matiere } from "../types";

const emptyForm = { nom: "", code: "", coefficient: 1, couleur: "#8b5cf6" };

export default function SubjectsPage() {
  const { user } = useAuth();
  // Page réservée jusqu'ici à l'admin exclusivement — le Directeur Général (accès lecture
  // seule, voir TeachersPage.tsx) y accède désormais aussi, d'où ce garde-fou.
  const isAdmin = user?.role === "admin";
  const confirmer = useConfirm();
  const [matieres, setMatieres] = useState<Matiere[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Matiere | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    matieresApi.list().then(({ data }) => setMatieres(unwrapList(data))).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setModalOpen(true);
  };

  const openEdit = (matiere: Matiere) => {
    setEditing(matiere);
    setForm({ nom: matiere.nom, code: matiere.code, coefficient: matiere.coefficient, couleur: matiere.couleur });
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) await matieresApi.update(editing.id, form);
      else await matieresApi.create(form);
      setModalOpen(false);
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (matiere: Matiere) => {
    if (!(await confirmer(`Supprimer la matière ${matiere.nom} ?`, { danger: true }))) return;
    await matieresApi.remove(matiere.id);
    load();
  };

  return (
    <div>
      <PageHeader title="Matières" description="Référentiel des matières enseignées." actions={isAdmin ? <Button onClick={openCreate}>+ Nouvelle matière</Button> : undefined} />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : matieres.length === 0 ? (
        <EmptyState title="Aucune matière définie" />
      ) : (
        <Table headers={["Couleur", "Nom", "Code", "Coefficient", "Actions"]}>
          {matieres.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3"><span className="inline-block h-4 w-4 rounded-full" style={{ backgroundColor: m.couleur }} /></td>
              <td className="px-4 py-3 font-medium text-slate-700">{m.nom}</td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500">{m.code}</td>
              <td className="px-4 py-3">{m.coefficient}</td>
              <td className="px-4 py-3">
                {isAdmin && (
                  <RowActions>
                    <EditButton onClick={() => openEdit(m)} />
                    <DeleteButton onClick={() => handleDelete(m)} />
                  </RowActions>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier la matière" : "Nouvelle matière"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nom" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
          <Input label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          <Input label="Coefficient" type="number" min={1} required value={form.coefficient} onChange={(e) => setForm({ ...form, coefficient: Number(e.target.value) })} />
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-600">Couleur</span>
            <input
              type="color" value={form.couleur} onChange={(e) => setForm({ ...form, couleur: e.target.value })}
              className="h-10 w-16 rounded-xl border border-slate-200 cursor-pointer"
            />
            <span className="text-xs font-mono text-slate-400">{form.couleur}</span>
          </div>

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
