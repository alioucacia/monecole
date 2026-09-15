import { useState, type FormEvent } from "react";

import { enseignantsApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { useConfirm } from "../context/ConfirmContext";
import { usePaginated } from "../hooks/usePaginated";
import type { EnseignantProfile } from "../types";

const emptyForm = {
  first_name: "", last_name: "", email: "", matricule: "", specialite: "", sexe: "",
  phone: "", address: "", date_embauche: "", diplome: "", password: "changeme123",
};

export default function TeachersPage() {
  const confirmer = useConfirm();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EnseignantProfile | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { items, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<EnseignantProfile>(
    () => enseignantsApi.list({ search: search || undefined }),
    [search]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setPhotoFile(null);
    setPhotoPreview(null);
    setError("");
    setModalOpen(true);
  };

  const openEdit = (ens: EnseignantProfile) => {
    setEditing(ens);
    setForm({
      first_name: ens.user.first_name, last_name: ens.user.last_name, email: ens.user.email,
      matricule: ens.matricule, specialite: ens.specialite, sexe: ens.user.sexe || "",
      phone: ens.user.phone, address: ens.user.address,
      date_embauche: ens.date_embauche || "", diplome: ens.diplome, password: "",
    });
    setPhotoFile(null);
    setPhotoPreview(ens.user.photo);
    setError("");
    setModalOpen(true);
  };

  const handlePhotoChange = (file: File | null) => {
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : editing?.user.photo || null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { ...form };
      if (photoFile) payload.photo = photoFile;
      if (editing && !form.password) delete payload.password;
      if (editing) {
        await enseignantsApi.update(editing.id, payload);
      } else {
        await enseignantsApi.create(payload);
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ens: EnseignantProfile) => {
    if (!(await confirmer(`Supprimer définitivement ${ens.user.first_name} ${ens.user.last_name} ?`, { danger: true }))) return;
    await enseignantsApi.remove(ens.id);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Enseignants"
        description="Gestion du corps enseignant."
        actions={<Button onClick={openCreate}>+ Nouvel enseignant</Button>}
      />

      <Input placeholder="Rechercher un enseignant…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs mb-4" />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun enseignant trouvé" />
      ) : (
        <>
          <Table headers={["Matricule", "Nom complet", "Spécialité", "Contact", "Actions"]}>
            {items.map((ens) => (
              <tr key={ens.id}>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{ens.matricule}</td>
                <td className="px-4 py-3 font-medium text-slate-700">
                  <div className="flex items-center gap-2.5">
                    {ens.user.photo ? (
                      <img src={ens.user.photo} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xs font-bold shrink-0">
                        {(ens.user.first_name[0] || "?").toUpperCase()}
                      </div>
                    )}
                    {ens.user.first_name} {ens.user.last_name}
                  </div>
                </td>
                <td className="px-4 py-3">{ens.specialite || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{ens.user.email || ens.user.phone || "—"}</td>
                <td className="px-4 py-3">
                  <RowActions>
                    <EditButton onClick={() => openEdit(ens)} />
                    <DeleteButton onClick={() => handleDelete(ens)} />
                  </RowActions>
                </td>
              </tr>
            ))}
          </Table>
          <div className="flex justify-between items-center mt-4 text-sm text-slate-500">
            <span>Total : {items.length}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!hasPrevious} onClick={goPrevious}>← Précédent</Button>
              <Button variant="secondary" disabled={!hasNext} onClick={goNext}>Suivant →</Button>
            </div>
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier l'enseignant" : "Nouvel enseignant"} wide>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 flex items-center gap-4">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-accent-100 shrink-0" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center font-bold text-lg shrink-0">
                {(form.first_name[0] || "?").toUpperCase()}
              </div>
            )}
            <label className="block">
              <span className="block text-sm font-semibold text-slate-600 mb-1.5">Photo (optionnel)</span>
              <input
                type="file" accept="image/*"
                onChange={(e) => handlePhotoChange(e.target.files?.[0] || null)}
                className="text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-accent-50 file:text-accent-700 hover:file:bg-accent-100"
              />
            </label>
          </div>
          <Input label="Prénom" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <Input label="Nom" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          {editing ? (
            <Input label="Matricule" required value={form.matricule} onChange={(e) => setForm({ ...form, matricule: e.target.value })} />
          ) : (
            <label className="block">
              <span className="block text-sm font-semibold text-slate-600 mb-1.5">Matricule</span>
              <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                Généré automatiquement (initiales + n° d'embauche)
              </p>
            </label>
          )}
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Spécialité" value={form.specialite} onChange={(e) => setForm({ ...form, specialite: e.target.value })} />
          <Input label="Diplôme" value={form.diplome} onChange={(e) => setForm({ ...form, diplome: e.target.value })} />
          <Select label="Genre" value={form.sexe} onChange={(e) => setForm({ ...form, sexe: e.target.value })}>
            <option value="">— Non précisé —</option>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
          </Select>
          <Input label="Téléphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Date d'embauche" type="date" value={form.date_embauche} onChange={(e) => setForm({ ...form, date_embauche: e.target.value })} />
          <Input label="Adresse" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input
            label={editing ? "Nouveau mot de passe (optionnel)" : "Mot de passe"}
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={editing ? "Laisser vide pour ne pas changer" : undefined}
          />

          {error && <p className="sm:col-span-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}

          <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
