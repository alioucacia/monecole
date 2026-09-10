import { useEffect, useState, type FormEvent } from "react";

import { plansAbonnementApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { useToast } from "../context/ToastContext";
import type { PlanAbonnement } from "../types";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

const emptyForm = {
  nom: "", montant: "", periodicite: "mensuel", description: "",
  limite_eleves: "", limite_enseignants: "", limite_administrateurs: "", actif: true,
};

export default function PlansAbonnementPage() {
  const toast = useToast();
  const [plans, setPlans] = useState<PlanAbonnement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PlanAbonnement | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    plansAbonnementApi.list().then(({ data }) => setPlans(unwrapList(data))).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (plan: PlanAbonnement) => {
    setEditing(plan);
    setForm({
      nom: plan.nom, montant: plan.montant, periodicite: plan.periodicite, description: plan.description,
      limite_eleves: plan.limite_eleves !== null ? String(plan.limite_eleves) : "",
      limite_enseignants: plan.limite_enseignants !== null ? String(plan.limite_enseignants) : "",
      limite_administrateurs: plan.limite_administrateurs !== null ? String(plan.limite_administrateurs) : "",
      actif: plan.actif,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form, periodicite: form.periodicite as PlanAbonnement["periodicite"],
        limite_eleves: form.limite_eleves ? Number(form.limite_eleves) : null,
        limite_enseignants: form.limite_enseignants ? Number(form.limite_enseignants) : null,
        limite_administrateurs: form.limite_administrateurs ? Number(form.limite_administrateurs) : null,
      };
      if (editing) await plansAbonnementApi.update(editing.id, payload);
      else await plansAbonnementApi.create(payload);
      setModalOpen(false);
      load();
      toast.success(editing ? "Plan mis à jour." : "Plan créé.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (plan: PlanAbonnement) => {
    const avertissement = plan.nombre_ecoles > 0
      ? `${plan.nombre_ecoles} école(s) utilisent actuellement ce plan (elles repasseront en montant personnalisé). `
      : "";
    if (!confirm(`${avertissement}Supprimer le plan "${plan.nom}" ?`)) return;
    await plansAbonnementApi.remove(plan.id);
    load();
  };

  const handleToggleActif = async (plan: PlanAbonnement) => {
    await plansAbonnementApi.update(plan.id, { actif: !plan.actif });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Plans d'abonnement"
        description="Tarifs proposés aux établissements — réutilisables lors de la création ou modification d'une école."
        actions={<Button onClick={openCreate}>+ Nouveau plan</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : plans.length === 0 ? (
        <EmptyState title="Aucun plan tarifaire défini" description="Créez votre premier plan pour l'associer aux écoles clientes." />
      ) : (
        <Table headers={["Nom", "Montant", "Périodicité", "Limites (élèves/profs/admins)", "Écoles associées", "Description", "Statut", "Actions"]}>
          {plans.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3 font-medium text-slate-700">{p.nom}</td>
              <td className="px-4 py-3">{money(p.montant)}</td>
              <td className="px-4 py-3 text-slate-500">{p.periodicite_display}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">
                {p.limite_eleves ?? "∞"} / {p.limite_enseignants ?? "∞"} / {p.limite_administrateurs ?? "∞"}
              </td>
              <td className="px-4 py-3">
                <Badge color={p.nombre_ecoles > 0 ? "brand" : "slate"}>{p.nombre_ecoles}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">{p.description || "—"}</td>
              <td className="px-4 py-3">
                <button onClick={() => handleToggleActif(p)}>
                  <Badge color={p.actif ? "green" : "slate"}>{p.actif ? "Actif" : "Désactivé"}</Badge>
                </button>
              </td>
              <td className="px-4 py-3">
                <RowActions>
                  <EditButton onClick={() => openEdit(p)} />
                  <DeleteButton onClick={() => handleDelete(p)} />
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier le plan" : "Nouveau plan"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nom du plan" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
          <Input label="Montant (GNF)" type="number" min={0} required value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} />
          <Select label="Périodicité" value={form.periodicite} onChange={(e) => setForm({ ...form, periodicite: e.target.value })}>
            <option value="mensuel">Mensuel</option>
            <option value="trimestriel">Trimestriel</option>
            <option value="annuel">Annuel</option>
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Limite élèves" placeholder="Illimité" type="number" min={1}
              value={form.limite_eleves} onChange={(e) => setForm({ ...form, limite_eleves: e.target.value })}
            />
            <Input
              label="Limite enseignants" placeholder="Illimité" type="number" min={1}
              value={form.limite_enseignants} onChange={(e) => setForm({ ...form, limite_enseignants: e.target.value })}
            />
            <Input
              label="Limite administrateurs" placeholder="Illimité" type="number" min={1}
              value={form.limite_administrateurs} onChange={(e) => setForm({ ...form, limite_administrateurs: e.target.value })}
            />
          </div>
          <p className="text-xs text-slate-400 -mt-2">Champs vides = illimité.</p>
          <label className="block">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Description (optionnel)</span>
            <textarea
              rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
            Plan actif (proposable aux écoles)
          </label>

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
