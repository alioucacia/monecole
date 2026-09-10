import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ecolesApi, paiementsEcolesApi, plansAbonnementApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, StatCard, Table } from "../components/ui";
import { useToast } from "../context/ToastContext";
import type { Ecole, EcoleStatsGlobales, PlanAbonnement } from "../types";

const STATUT_LABELS: Record<string, { label: string; color: "green" | "amber" | "rose" | "slate" }> = {
  paye: { label: "À jour", color: "green" },
  en_attente: { label: "En attente", color: "slate" },
  en_retard: { label: "En retard", color: "amber" },
  bloque: { label: "Bloquée", color: "rose" },
  suspendu: { label: "Suspendue", color: "rose" },
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

/** Suggère l'année scolaire en cours au format "AAAA-AAAA" (bascule au 1er septembre). */
function anneeScolaireSuggeree() {
  const now = new Date();
  const debut = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${debut}-${debut + 1}`;
}

const emptyEcoleForm = {
  nom: "", adresse: "", ville: "", pays: "Guinée", telephone: "", email: "",
  directeur_nom: "", type_etablissement: "", annee_scolaire_libelle: anneeScolaireSuggeree(), actif: true,
  plan: "", abonnement_mensuel: "", jour_echeance: 5, jours_grace: 5,
  admin_username: "", admin_first_name: "", admin_last_name: "", admin_email: "", admin_password: "changeme123",
};

const emptyEditForm = {
  nom: "", adresse: "", ville: "", pays: "", telephone: "", email: "",
  directeur_nom: "", type_etablissement: "",
  plan: "", abonnement_mensuel: "", jour_echeance: 5, jours_grace: 5,
};

const TYPE_ETABLISSEMENT_LABELS: Record<string, string> = {
  primaire: "Primaire", college: "Collège", lycee: "Lycée", universite: "Université",
  prive: "Établissement privé", public: "Établissement public",
};

const emptyPaiementForm = { mois: new Date().toISOString().slice(0, 7), montant: "", mode_paiement: "virement", reference: "" };

export default function EcolesPage() {
  const toast = useToast();
  const [ecoles, setEcoles] = useState<Ecole[]>([]);
  const [stats, setStats] = useState<EcoleStatsGlobales | null>(null);
  const [plans, setPlans] = useState<PlanAbonnement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyEcoleForm);
  const [createLogo, setCreateLogo] = useState<File | null>(null);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<Ecole | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editLogo, setEditLogo] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [paiementTarget, setPaiementTarget] = useState<Ecole | null>(null);
  const [paiementForm, setPaiementForm] = useState(emptyPaiementForm);
  const [paiementError, setPaiementError] = useState("");
  const [paiementSaving, setPaiementSaving] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [relancing, setRelancing] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([ecolesApi.list({ page_size: 100 }), ecolesApi.stats()])
      .then(([ecolesRes, statsRes]) => {
        setEcoles(unwrapList(ecolesRes.data));
        setStats(statsRes.data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    plansAbonnementApi.list({ actif: true }).then(({ data }) => setPlans(unwrapList(data)));
  }, []);

  const ecolesFiltrees = useMemo(() => {
    return ecoles.filter((e) => {
      const matchSearch = !search || e.nom.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase());
      const matchStatut = !statutFilter || e.statut_abonnement === statutFilter;
      return matchSearch && matchStatut;
    });
  }, [ecoles, search, statutFilter]);

  const chartData = stats?.historique_revenu.map((h) => ({
    mois: new Date(`${h.mois}-01`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
    Encaissé: Number(h.total),
  })) ?? [];

  const croissanceData = stats?.historique_croissance.map((h) => ({
    mois: new Date(`${h.mois}-01`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
    Écoles: h.total,
  })) ?? [];

  const openCreate = () => {
    setCreateForm(emptyEcoleForm);
    setCreateLogo(null);
    setCreateError("");
    setCreateOpen(true);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const payload: Record<string, unknown> = { ...createForm, plan: createForm.plan || null };
      if (createLogo) payload.logo = createLogo;
      await ecolesApi.create(payload);
      setCreateOpen(false);
      load();
    } catch (err) {
      setCreateError(extractErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActif = async (ecole: Ecole) => {
    const verbe = ecole.actif ? "suspendre" : "réactiver";
    if (!confirm(`Voulez-vous ${verbe} l'accès de "${ecole.nom}" ?`)) return;
    await ecolesApi.update(ecole.id, { actif: !ecole.actif });
    load();
  };

  const openEdit = (ecole: Ecole) => {
    setEditTarget(ecole);
    setEditForm({
      nom: ecole.nom, adresse: ecole.adresse, ville: ecole.ville, pays: ecole.pays, telephone: ecole.telephone, email: ecole.email,
      directeur_nom: ecole.directeur_nom, type_etablissement: ecole.type_etablissement,
      plan: ecole.plan ? String(ecole.plan) : "",
      abonnement_mensuel: ecole.abonnement_mensuel, jour_echeance: ecole.jour_echeance, jours_grace: ecole.jours_grace,
    });
    setEditLogo(null);
    setEditLogoPreview(ecole.logo);
    setEditError("");
  };

  const handleEditLogoChange = (file: File | null) => {
    setEditLogo(file);
    setEditLogoPreview(file ? URL.createObjectURL(file) : editTarget?.logo || null);
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    setEditError("");
    try {
      const payload: Record<string, unknown> = { ...editForm, plan: editForm.plan || null };
      if (editLogo) payload.logo = editLogo;
      await ecolesApi.update(editTarget.id, payload);
      setEditTarget(null);
      load();
    } catch (err) {
      setEditError(extractErrorMessage(err));
    } finally {
      setEditSaving(false);
    }
  };

  const openPaiement = (ecole: Ecole) => {
    setPaiementTarget(ecole);
    setPaiementForm({ ...emptyPaiementForm, montant: ecole.abonnement_mensuel });
    setPaiementError("");
  };

  const handlePaiementSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!paiementTarget) return;
    setPaiementSaving(true);
    setPaiementError("");
    try {
      await paiementsEcolesApi.create({
        ecole: paiementTarget.id, mois: `${paiementForm.mois}-01`, montant: paiementForm.montant,
        mode_paiement: paiementForm.mode_paiement, reference: paiementForm.reference,
      });
      setPaiementTarget(null);
      load();
    } catch (err) {
      setPaiementError(extractErrorMessage(err));
    } finally {
      setPaiementSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await ecolesApi.export();
    } finally {
      setExporting(false);
    }
  };

  const handleRelancer = async () => {
    setRelancing(true);
    try {
      const { data } = await ecolesApi.relancerRetard();
      toast.success(`${data.relances} école(s) relancée(s) par email/SMS.`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setRelancing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Établissements"
        description="Gestion des écoles clientes de la plateforme et de leurs abonnements."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>{exporting ? "Export…" : "📤 Exporter CSV"}</Button>
            {stats && stats.ecoles_a_surveiller.length > 0 && (
              <Button variant="secondary" onClick={handleRelancer} disabled={relancing}>
                {relancing ? "Envoi…" : "📣 Relancer les retards"}
              </Button>
            )}
            <Button onClick={openCreate}>+ Nouvelle école</Button>
          </div>
        }
      />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <StatCard label="Écoles" value={String(stats.total_ecoles)} icon="🏫" accent="brand" />
          <StatCard label="Actives" value={String(stats.ecoles_actives)} icon="✅" accent="teal" />
          <StatCard label="À jour" value={String(stats.ecoles_a_jour)} icon="💚" accent="green" />
          <StatCard label="En retard" value={String(stats.ecoles_en_retard)} icon="⏰" accent="amber" />
          <StatCard label="Revenu mensuel attendu" value={money(stats.revenu_mensuel_attendu)} icon="💰" accent="rose" />
        </div>
      )}

      {stats && (
        <div className="mb-6">
          <StatCard label="Revenu total encaissé (toutes écoles, tout historique)" value={money(stats.revenu_total_encaisse)} icon="🏦" accent="brand" />
        </div>
      )}

      {stats && stats.ecoles_a_surveiller.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 mb-6">
          <h3 className="font-bold text-amber-800 mb-2">⚠️ Écoles à relancer avant blocage</h3>
          <ul className="space-y-1.5">
            {stats.ecoles_a_surveiller.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <Link to={`/ecoles/${e.id}`} className="text-amber-900 font-medium hover:underline">{e.nom}</Link>
                <Badge color="amber">{e.jours_avant_blocage} jour{e.jours_avant_blocage > 1 ? "s" : ""} avant blocage</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {stats && (chartData.some((c) => c.Encaissé > 0) || croissanceData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {chartData.some((c) => c.Encaissé > 0) && (
            <Card>
              <h3 className="font-bold text-ink-900 mb-4">Revenu d'abonnement encaissé (6 derniers mois)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Bar dataKey="Encaissé" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Croissance de la plateforme (écoles inscrites)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={croissanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="Écoles" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <Input placeholder="Rechercher une école…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} className="max-w-xs">
          <option value="">Tous les statuts</option>
          <option value="paye">À jour</option>
          <option value="en_attente">En attente</option>
          <option value="en_retard">En retard</option>
          <option value="bloque">Bloquée</option>
          <option value="suspendu">Suspendue</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : ecolesFiltrees.length === 0 ? (
        <EmptyState title="Aucune école trouvée" description="Commencez par créer votre première école cliente." />
      ) : (
        <Table headers={["École", "Contact", "Plan", "Abonnement / mois", "Dernier paiement", "Statut", "Utilisateurs", "Actions"]}>
          {ecolesFiltrees.map((ecole) => (
            <tr key={ecole.id}>
              <td className="px-4 py-3 font-medium text-slate-700">
                <Link to={`/ecoles/${ecole.id}`} className="flex items-center gap-2.5 hover:text-brand-700 group w-fit">
                  {ecole.logo ? (
                    <img src={ecole.logo} alt="" className="h-8 w-8 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                      {ecole.nom[0]?.toUpperCase()}
                    </div>
                  )}
                  <span className="group-hover:underline">{ecole.nom}</span>
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">{ecole.email || ecole.telephone || "—"}</td>
              <td className="px-4 py-3">
                {ecole.plan_nom ? <Badge color="brand">{ecole.plan_nom}</Badge> : <span className="text-slate-400 text-xs">Personnalisé</span>}
              </td>
              <td className="px-4 py-3">{money(ecole.abonnement_mensuel)}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">
                {ecole.dernier_paiement ? new Date(ecole.dernier_paiement.mois).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "—"}
              </td>
              <td className="px-4 py-3">
                <Badge color={STATUT_LABELS[ecole.statut_abonnement]?.color || "slate"}>
                  {STATUT_LABELS[ecole.statut_abonnement]?.label || ecole.statut_abonnement}
                </Badge>
              </td>
              <td className="px-4 py-3 text-slate-500">{ecole.nombre_utilisateurs}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => openPaiement(ecole)} className="text-brand-600 hover:underline text-sm">💳 Encaisser</button>
                  <button onClick={() => openEdit(ecole)} className="text-slate-500 hover:underline text-sm">✏️ Modifier</button>
                  <button onClick={() => handleToggleActif(ecole)} className={`text-sm hover:underline ${ecole.actif ? "text-rose-600" : "text-emerald-600"}`}>
                    {ecole.actif ? "Suspendre" : "Réactiver"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouvelle école" wide>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block sm:col-span-2">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Logo (optionnel)</span>
            <input type="file" accept="image/*" onChange={(e) => setCreateLogo(e.target.files?.[0] || null)} className="text-sm" />
          </label>
          <Input label="Nom de l'école" required value={createForm.nom} onChange={(e) => setCreateForm({ ...createForm, nom: e.target.value })} className="sm:col-span-2" />
          <Input label="Directeur" value={createForm.directeur_nom} onChange={(e) => setCreateForm({ ...createForm, directeur_nom: e.target.value })} />
          <Select label="Type d'école" value={createForm.type_etablissement} onChange={(e) => setCreateForm({ ...createForm, type_etablissement: e.target.value })}>
            <option value="">— Non précisé —</option>
            {Object.entries(TYPE_ETABLISSEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Input label="Adresse" value={createForm.adresse} onChange={(e) => setCreateForm({ ...createForm, adresse: e.target.value })} className="sm:col-span-2" />
          <Input label="Ville" value={createForm.ville} onChange={(e) => setCreateForm({ ...createForm, ville: e.target.value })} />
          <Input label="Pays" value={createForm.pays} onChange={(e) => setCreateForm({ ...createForm, pays: e.target.value })} />
          <Input label="Téléphone" value={createForm.telephone} onChange={(e) => setCreateForm({ ...createForm, telephone: e.target.value })} />
          <Input label="Email de contact" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
          <Input
            label="Année scolaire" placeholder="2025-2026" value={createForm.annee_scolaire_libelle}
            onChange={(e) => setCreateForm({ ...createForm, annee_scolaire_libelle: e.target.value })}
          />
          <Select label="Statut" value={createForm.actif ? "actif" : "suspendu"} onChange={(e) => setCreateForm({ ...createForm, actif: e.target.value === "actif" })}>
            <option value="actif">Actif</option>
            <option value="suspendu">Suspendu</option>
          </Select>
          <Select
            label="Plan d'abonnement (optionnel)" value={createForm.plan}
            onChange={(e) => {
              const plan = plans.find((p) => p.id === Number(e.target.value));
              setCreateForm({ ...createForm, plan: e.target.value, abonnement_mensuel: plan ? plan.montant : createForm.abonnement_mensuel });
            }}
          >
            <option value="">— Montant personnalisé —</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.nom} — {Number(p.montant).toLocaleString("fr-FR")} GNF ({p.periodicite_display})</option>)}
          </Select>
          <Input label="Abonnement mensuel (GNF)" type="number" min={0} required value={createForm.abonnement_mensuel} onChange={(e) => setCreateForm({ ...createForm, abonnement_mensuel: e.target.value })} />
          <Input label="Jour d'échéance (1-28)" type="number" min={1} max={28} value={createForm.jour_echeance} onChange={(e) => setCreateForm({ ...createForm, jour_echeance: Number(e.target.value) })} />
          <Input label="Jours de grâce" type="number" min={0} value={createForm.jours_grace} onChange={(e) => setCreateForm({ ...createForm, jours_grace: Number(e.target.value) })} />

          <div className="sm:col-span-2 border-t border-slate-100 pt-4 mt-1">
            <p className="text-sm font-bold text-ink-900 mb-3">Compte administrateur de l'école</p>
          </div>
          <Input label="Nom d'utilisateur" required value={createForm.admin_username} onChange={(e) => setCreateForm({ ...createForm, admin_username: e.target.value })} />
          <Input label="Mot de passe initial" required value={createForm.admin_password} onChange={(e) => setCreateForm({ ...createForm, admin_password: e.target.value })} />
          <Input label="Prénom" required value={createForm.admin_first_name} onChange={(e) => setCreateForm({ ...createForm, admin_first_name: e.target.value })} />
          <Input label="Nom" required value={createForm.admin_last_name} onChange={(e) => setCreateForm({ ...createForm, admin_last_name: e.target.value })} />
          <Input label="Email de l'admin" type="email" value={createForm.admin_email} onChange={(e) => setCreateForm({ ...createForm, admin_email: e.target.value })} className="sm:col-span-2" />

          {createError && <p className="sm:col-span-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{createError}</p>}

          <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={creating}>{creating ? "Création…" : "Créer l'école"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Modifier — ${editTarget?.nom ?? ""}`} wide>
        {editTarget && (
          <form onSubmit={handleEditSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 flex items-center gap-4">
              {editLogoPreview ? (
                <img src={editLogoPreview} alt="" className="h-14 w-14 rounded-xl object-cover border-2 border-brand-100 shrink-0" />
              ) : (
                <div className="h-14 w-14 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
                  {editForm.nom[0]?.toUpperCase()}
                </div>
              )}
              <label className="block">
                <span className="block text-sm font-semibold text-slate-600 mb-1.5">Logo</span>
                <input type="file" accept="image/*" onChange={(e) => handleEditLogoChange(e.target.files?.[0] || null)} className="text-sm" />
              </label>
            </div>
            <Input label="Nom de l'école" required value={editForm.nom} onChange={(e) => setEditForm({ ...editForm, nom: e.target.value })} className="sm:col-span-2" />
            <Input label="Directeur" value={editForm.directeur_nom} onChange={(e) => setEditForm({ ...editForm, directeur_nom: e.target.value })} />
            <Select label="Type d'école" value={editForm.type_etablissement} onChange={(e) => setEditForm({ ...editForm, type_etablissement: e.target.value })}>
              <option value="">— Non précisé —</option>
              {Object.entries(TYPE_ETABLISSEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Input label="Adresse" value={editForm.adresse} onChange={(e) => setEditForm({ ...editForm, adresse: e.target.value })} className="sm:col-span-2" />
            <Input label="Ville" value={editForm.ville} onChange={(e) => setEditForm({ ...editForm, ville: e.target.value })} />
            <Input label="Pays" value={editForm.pays} onChange={(e) => setEditForm({ ...editForm, pays: e.target.value })} />
            <Input label="Téléphone" value={editForm.telephone} onChange={(e) => setEditForm({ ...editForm, telephone: e.target.value })} />
            <Input label="Email de contact" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <Select
              label="Plan d'abonnement (optionnel)" value={editForm.plan}
              onChange={(e) => {
                const plan = plans.find((p) => p.id === Number(e.target.value));
                setEditForm({ ...editForm, plan: e.target.value, abonnement_mensuel: plan ? plan.montant : editForm.abonnement_mensuel });
              }}
            >
              <option value="">— Montant personnalisé —</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.nom} — {Number(p.montant).toLocaleString("fr-FR")} GNF ({p.periodicite_display})</option>)}
            </Select>
            <Input label="Abonnement mensuel (GNF)" type="number" min={0} required value={editForm.abonnement_mensuel} onChange={(e) => setEditForm({ ...editForm, abonnement_mensuel: e.target.value })} />
            <Input label="Jour d'échéance (1-28)" type="number" min={1} max={28} value={editForm.jour_echeance} onChange={(e) => setEditForm({ ...editForm, jour_echeance: Number(e.target.value) })} />
            <Input label="Jours de grâce" type="number" min={0} value={editForm.jours_grace} onChange={(e) => setEditForm({ ...editForm, jours_grace: Number(e.target.value) })} />

            {editError && <p className="sm:col-span-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{editError}</p>}

            <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
              <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={editSaving}>{editSaving ? "Enregistrement…" : "Enregistrer"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!paiementTarget} onClose={() => setPaiementTarget(null)} title={`Encaisser — ${paiementTarget?.nom ?? ""}`}>
        {paiementTarget && (
          <form onSubmit={handlePaiementSubmit} className="space-y-4">
            <Input label="Mois couvert" type="month" required value={paiementForm.mois} onChange={(e) => setPaiementForm({ ...paiementForm, mois: e.target.value })} />
            <Input label="Montant (GNF)" type="number" min={0} required value={paiementForm.montant} onChange={(e) => setPaiementForm({ ...paiementForm, montant: e.target.value })} />
            <Select label="Mode de paiement" value={paiementForm.mode_paiement} onChange={(e) => setPaiementForm({ ...paiementForm, mode_paiement: e.target.value })}>
              <option value="virement">Virement</option>
              <option value="especes">Espèces</option>
              <option value="orange_money">Orange Money</option>
              <option value="mtn_money">MTN Mobile Money</option>
              <option value="moov_money">Moov Money</option>
              <option value="mobile_money">Mobile Money (autre)</option>
              <option value="carte_bancaire">Carte bancaire</option>
              <option value="cheque">Chèque</option>
            </Select>
            <Input label="Référence (optionnel)" value={paiementForm.reference} onChange={(e) => setPaiementForm({ ...paiementForm, reference: e.target.value })} />

            {paiementError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{paiementError}</p>}

            <div className="flex justify-end gap-2 mt-2">
              <Button type="button" variant="secondary" onClick={() => setPaiementTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={paiementSaving}>{paiementSaving ? "Enregistrement…" : "Confirmer"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
