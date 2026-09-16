import { useEffect, useState, type FormEvent } from "react";

import { usersApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { Role, User } from "../types";

const ROLE_LABELS: Record<string, string> = {
  comptabilite: "Comptabilité", surveillance: "Surveillance Générale", directeur: "Directeur Général",
};

const emptyForm = { username: "", first_name: "", last_name: "", email: "", phone: "", password: "", role: "comptabilite" as Role };

export default function PersonnelAdminPage() {
  const { user: moi } = useAuth();
  // Page réservée jusqu'ici à l'admin exclusivement — le Directeur Général (accès lecture
  // seule, voir TeachersPage.tsx) y accède désormais aussi, d'où ce garde-fou.
  const isAdmin = moi?.role === "admin";
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      usersApi.list({ role: "comptabilite", page_size: 100 }).then(({ data }) => unwrapList(data)),
      usersApi.list({ role: "surveillance", page_size: 100 }).then(({ data }) => unwrapList(data)),
      usersApi.list({ role: "directeur", page_size: 100 }).then(({ data }) => unwrapList(data)),
    ]).then(([compta, surveillance, directeurs]) => setUsers([...compta, ...surveillance, ...directeurs])).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setForm(emptyForm);
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await usersApi.create(form);
      setModalOpen(false);
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActif = async (user: User) => {
    await usersApi.update(user.id, { is_active: !user.is_active });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Personnel administratif"
        description="Comptes Comptabilité, Surveillance Générale et Directeur Général de votre établissement."
        actions={isAdmin ? <Button onClick={openCreate}>+ Nouveau compte</Button> : undefined}
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : users.length === 0 ? (
        <EmptyState title="Aucun compte créé" description="Créez un compte Comptabilité ou Surveillance pour déléguer certaines tâches." />
      ) : (
        <Table headers={["Nom", "Rôle", "Identifiant", "Email", "Statut", "Actions"]}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3 font-medium text-slate-700">{u.full_name || `${u.first_name} ${u.last_name}`}</td>
              <td className="px-4 py-3"><Badge color="brand">{ROLE_LABELS[u.role] ?? u.role_display}</Badge></td>
              <td className="px-4 py-3 text-xs font-mono text-slate-500">{u.username}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{u.email || "—"}</td>
              <td className="px-4 py-3"><Badge color={u.is_active ? "green" : "rose"}>{u.is_active ? "Actif" : "Désactivé"}</Badge></td>
              <td className="px-4 py-3">
                {isAdmin && (
                  <button onClick={() => handleToggleActif(u)} className={`text-xs font-semibold hover:underline ${u.is_active ? "text-rose-600" : "text-emerald-600"}`}>
                    {u.is_active ? "Désactiver" : "Réactiver"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau compte personnel">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select label="Rôle" required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="comptabilite">Comptabilité</option>
            <option value="surveillance">Surveillance Générale</option>
            <option value="directeur">Directeur Général</option>
          </Select>
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
    </div>
  );
}
