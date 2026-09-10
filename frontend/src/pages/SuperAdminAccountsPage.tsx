import { useEffect, useState, type FormEvent } from "react";

import { comptesSuperAdminApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Spinner, Table } from "../components/ui";
import type { User } from "../types";

const emptyCreateForm = { username: "", first_name: "", last_name: "", email: "", phone: "", password: "" };
const emptyEditForm = { username: "", first_name: "", last_name: "", email: "", phone: "" };

export default function SuperAdminAccountsPage() {
  const toast = useToast();
  const { user: moi } = useAuth();
  const [comptes, setComptes] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyCreateForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const load = () => {
    setLoading(true);
    comptesSuperAdminApi.list({ page_size: 100 }).then(({ data }) => setComptes(unwrapList(data))).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setForm(emptyCreateForm);
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await comptesSuperAdminApi.create(form);
      setModalOpen(false);
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: User) => {
    setEditTarget(u);
    setEditForm({ username: u.username, first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone });
    setEditError("");
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    setEditError("");
    try {
      await comptesSuperAdminApi.update(editTarget.id, editForm);
      setEditTarget(null);
      load();
    } catch (err) {
      setEditError(extractErrorMessage(err));
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActif = async (u: User) => {
    await comptesSuperAdminApi.update(u.id, { is_active: !u.is_active });
    load();
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Supprimer définitivement le compte « ${u.full_name || u.username} » ?`)) return;
    try {
      await comptesSuperAdminApi.remove(u.id);
      load();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Comptes Super Admin"
        description="Personnes ayant accès à la gestion complète de la plateforme (toutes écoles)."
        actions={<Button onClick={openCreate}>+ Nouveau compte</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : comptes.length === 0 ? (
        <EmptyState title="Aucun compte" />
      ) : (
        <Table headers={["Nom", "Identifiant", "Email", "Téléphone", "Statut", "Actions"]}>
          {comptes.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3 font-medium text-slate-700">
                {u.full_name || u.username} {u.id === moi?.id && <Badge color="brand">Vous</Badge>}
              </td>
              <td className="px-4 py-3 text-xs font-mono text-slate-500">{u.username}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{u.email || "—"}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{u.phone || "—"}</td>
              <td className="px-4 py-3"><Badge color={u.is_active ? "green" : "rose"}>{u.is_active ? "Actif" : "Désactivé"}</Badge></td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  <button onClick={() => openEdit(u)} className="text-xs font-semibold text-brand-600 hover:underline">Modifier</button>
                  {u.id !== moi?.id && (
                    <>
                      <button onClick={() => handleToggleActif(u)} className={`text-xs font-semibold hover:underline ${u.is_active ? "text-rose-600" : "text-emerald-600"}`}>
                        {u.is_active ? "Désactiver" : "Réactiver"}
                      </button>
                      <button onClick={() => handleDelete(u)} className="text-xs font-semibold text-rose-600 hover:underline">Supprimer</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau compte Super Admin">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Prénom" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            <Input label="Nom" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <Input label="Nom d'utilisateur" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <Input label="Mot de passe initial" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Téléphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Création…" : "Créer le compte"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Modifier — ${editTarget?.full_name || editTarget?.username || ""}`}>
        {editTarget && (
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Prénom" required value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
              <Input label="Nom" required value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
            </div>
            <Input label="Nom d'utilisateur" required value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} />
            <Input label="Email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <Input label="Téléphone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />

            {editError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{editError}</p>}
            <p className="text-xs text-slate-400">Pour changer le mot de passe, utilisez « Mot de passe oublié » depuis la page de connexion.</p>

            <div className="flex justify-end gap-2 mt-2">
              <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={editSaving}>{editSaving ? "Enregistrement…" : "Enregistrer"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
