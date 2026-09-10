import { useEffect, useState, type FormEvent } from "react";

import { enseignantsApi, paiesEnseignantsApi, pointagesEnseignantsApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { PdfPreviewModal } from "../components/PdfPreviewModal";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { EnseignantProfile, PaieEnseignant, PointageEnseignant } from "../types";

const emptyPaieForm = {
  enseignant: "", mois: "", mode_calcul: "fixe" as "fixe" | "horaire",
  salaire_base: "", nombre_heures: "", taux_horaire: "", primes: "0", retenues: "0", commentaire: "",
};

const emptyPointageForm = {
  enseignant: "", date: new Date().toISOString().slice(0, 10),
  heure_arrivee: "", heure_depart: "", statut: "present" as "present" | "retard" | "absent", commentaire: "",
};

const STATUT_COLORS: Record<string, "green" | "amber" | "rose"> = {
  present: "green", retard: "amber", absent: "rose",
};
const STATUT_LABELS: Record<string, string> = { present: "Présent", retard: "Retard", absent: "Absent" };

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function StaffPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Comptabilité gère la paie, Surveillance générale gère le pointage — l'admin voit tout.
  const peutGererPaie = user?.role === "admin" || user?.role === "comptabilite";
  const peutGererPointage = user?.role === "admin" || user?.role === "surveillance";
  // La comptabilité peut aussi CONSULTER (sans corriger) les pointages de tous les enseignants —
  // utile pour vérifier les heures d'une fiche de paie au taux horaire.
  const peutVoirPointage = peutGererPointage || user?.role === "comptabilite";

  const [tab, setTab] = useState<"paie" | "pointage">(peutGererPaie ? "paie" : "pointage");
  const [enseignants, setEnseignants] = useState<EnseignantProfile[]>([]);
  const [paies, setPaies] = useState<PaieEnseignant[]>([]);
  const [pointages, setPointages] = useState<PointageEnseignant[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPaie, setEditingPaie] = useState<PaieEnseignant | null>(null);
  const [form, setForm] = useState(emptyPaieForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewPaie, setPreviewPaie] = useState<PaieEnseignant | null>(null);
  const [heuresPointeesInfo, setHeuresPointeesInfo] = useState<{ heures: string; jours_pointes: number } | null>(null);
  const [heuresLoading, setHeuresLoading] = useState(false);

  const [pointageModalOpen, setPointageModalOpen] = useState(false);
  const [editingPointage, setEditingPointage] = useState<PointageEnseignant | null>(null);
  const [pointageForm, setPointageForm] = useState(emptyPointageForm);
  const [pointageError, setPointageError] = useState("");
  const [pointageSaving, setPointageSaving] = useState(false);

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      paiesEnseignantsApi.list().then(({ data }) => unwrapList(data)),
      pointagesEnseignantsApi.list().then(({ data }) => unwrapList(data)),
    ]).then(([paieItems, pointageItems]) => {
      setPaies(paieItems);
      setPointages(pointageItems);
    }).finally(() => setLoading(false));
  };

  useEffect(loadAll, []);

  useEffect(() => {
    // La liste des enseignants sert aussi bien au sélecteur de la fiche de paie qu'à celui
    // du formulaire de pointage — chargée dès que l'un des deux est utilisable.
    if (peutGererPaie || peutGererPointage) {
      enseignantsApi.list({ page_size: 200 }).then(({ data }) => setEnseignants(unwrapList(data)));
    }
  }, [peutGererPaie, peutGererPointage]);

  const openCreate = () => {
    setEditingPaie(null);
    setForm(emptyPaieForm);
    setError("");
    setHeuresPointeesInfo(null);
    setModalOpen(true);
  };

  const openEdit = (paie: PaieEnseignant) => {
    setEditingPaie(paie);
    setForm({
      enseignant: String(paie.enseignant), mois: paie.mois.slice(0, 7), mode_calcul: paie.mode_calcul,
      salaire_base: paie.salaire_base, nombre_heures: paie.nombre_heures ?? "", taux_horaire: paie.taux_horaire ?? "",
      primes: paie.primes, retenues: paie.retenues, commentaire: paie.commentaire,
    });
    setError("");
    setHeuresPointeesInfo(null);
    setModalOpen(true);
  };

  /** Récupère les heures réellement pointées (arrivée/départ) pour l'enseignant/mois choisis et
   * pré-remplit « Heures enseignées ». Appelé automatiquement à la création (dès que enseignant
   * + mois sont choisis) — jamais automatiquement en modification, pour ne pas écraser en
   * silence une valeur déjà saisie/ajustée à la main ; l'admin peut alors cliquer sur
   * « Recalculer depuis les pointages » pour la rafraîchir explicitement. */
  const chargerHeuresPointees = async () => {
    if (!form.enseignant || !form.mois) return;
    setHeuresLoading(true);
    try {
      const { data } = await paiesEnseignantsApi.heuresPointees(Number(form.enseignant), `${form.mois}-01`);
      setHeuresPointeesInfo(data);
      setForm((f) => ({ ...f, nombre_heures: data.heures }));
    } catch {
      setHeuresPointeesInfo(null);
    } finally {
      setHeuresLoading(false);
    }
  };

  useEffect(() => {
    if (!editingPaie && form.mode_calcul === "horaire" && form.enseignant && form.mois) {
      chargerHeuresPointees();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.enseignant, form.mois, form.mode_calcul, editingPaie]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        enseignant: Number(form.enseignant), mois: `${form.mois}-01`, mode_calcul: form.mode_calcul,
        salaire_base: form.salaire_base || "0",
        nombre_heures: form.mode_calcul === "horaire" ? form.nombre_heures || null : null,
        taux_horaire: form.mode_calcul === "horaire" ? form.taux_horaire || null : null,
        primes: form.primes, retenues: form.retenues, commentaire: form.commentaire,
      };
      if (editingPaie) await paiesEnseignantsApi.update(editingPaie.id, payload);
      else await paiesEnseignantsApi.create(payload);
      setModalOpen(false);
      loadAll();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePayee = async (paie: PaieEnseignant) => {
    await paiesEnseignantsApi.update(paie.id, {
      payee: !paie.payee,
      date_paiement: !paie.payee ? new Date().toISOString().slice(0, 10) : null,
    });
    loadAll();
  };

  const handlePreviewPdf = (paie: PaieEnseignant) => setPreviewPaie(paie);

  const openCreatePointage = () => {
    setEditingPointage(null);
    setPointageForm(emptyPointageForm);
    setPointageError("");
    setPointageModalOpen(true);
  };

  const openEditPointage = (p: PointageEnseignant) => {
    setEditingPointage(p);
    setPointageForm({
      enseignant: String(p.enseignant), date: p.date,
      heure_arrivee: p.heure_arrivee?.slice(0, 5) || "", heure_depart: p.heure_depart?.slice(0, 5) || "",
      statut: p.statut, commentaire: p.commentaire,
    });
    setPointageError("");
    setPointageModalOpen(true);
  };

  // À la création, un enseignant ayant déjà un pointage pour la date choisie est exclu du
  // sélecteur — la contrainte d'unicité (un seul pointage par enseignant et par jour, voir
  // PointageEnseignant côté backend) refuserait sinon une seconde création : on guide plutôt
  // la surveillance vers « Modifier » la ligne existante.
  const enseignantsDisponiblesPointage = editingPointage
    ? enseignants
    : enseignants.filter((ens) => !pointages.some((p) => p.enseignant === ens.id && p.date === pointageForm.date));

  const handleSubmitPointage = async (e: FormEvent) => {
    e.preventDefault();
    setPointageSaving(true);
    setPointageError("");
    try {
      const payload = {
        enseignant: Number(pointageForm.enseignant), date: pointageForm.date,
        heure_arrivee: pointageForm.heure_arrivee || null, heure_depart: pointageForm.heure_depart || null,
        statut: pointageForm.statut, commentaire: pointageForm.commentaire,
      };
      if (editingPointage) await pointagesEnseignantsApi.update(editingPointage.id, payload);
      else await pointagesEnseignantsApi.create(payload);
      setPointageModalOpen(false);
      loadAll();
    } catch (err) {
      setPointageError(extractErrorMessage(err));
    } finally {
      setPointageSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Ressources humaines"
        description={isAdmin ? "Paie et pointage du personnel enseignant." : peutGererPaie ? "Paie et pointage du personnel enseignant." : peutGererPointage ? "Pointage du personnel enseignant." : "Mes fiches de paie et mon historique de pointage."}
        actions={
          peutGererPaie && tab === "paie" ? <Button onClick={openCreate}>+ Nouvelle fiche de paie</Button>
          : peutGererPointage && tab === "pointage" ? <Button onClick={openCreatePointage}>+ Nouveau pointage</Button>
          : undefined
        }
      />

      <div className="flex gap-2 mb-6">
        {(peutGererPaie || !peutVoirPointage) && (
          <button
            onClick={() => setTab("paie")}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === "paie" ? "bg-brand-600 text-white shadow-soft" : "bg-white text-slate-600 border border-slate-200"}`}
          >
            💰 Paie
          </button>
        )}
        {(peutVoirPointage || !peutGererPaie) && (
          <button
            onClick={() => setTab("pointage")}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === "pointage" ? "bg-brand-600 text-white shadow-soft" : "bg-white text-slate-600 border border-slate-200"}`}
          >
            ⏱️ Pointage
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : tab === "paie" ? (
        paies.length === 0 ? <EmptyState title="Aucune fiche de paie" /> : (
          <Table headers={["Enseignant", "Mois", "Salaire de base", "Primes", "Retenues", "Net à payer", "Statut", "Actions"]}>
            {paies.map((paie) => (
              <tr key={paie.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{paie.enseignant_nom}</td>
                <td className="px-4 py-3">{new Date(paie.mois).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
                <td className="px-4 py-3">
                  {money(paie.salaire_calcule)}
                  {paie.mode_calcul === "horaire" && (
                    <span className="block text-[10px] text-slate-400">{paie.nombre_heures} h × {money(paie.taux_horaire || 0)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-emerald-600">+{money(paie.primes)}</td>
                <td className="px-4 py-3 text-rose-600">−{money(paie.retenues)}</td>
                <td className="px-4 py-3 font-bold">{money(paie.net_a_payer)}</td>
                <td className="px-4 py-3">
                  <Badge color={paie.payee ? "green" : "amber"}>{paie.payee ? "Payée" : "En attente"}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => handlePreviewPdf(paie)}>PDF</button>
                    {peutGererPaie && (
                      <>
                        <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => openEdit(paie)}>Modifier</button>
                        <button className="text-xs font-semibold text-slate-500 hover:underline" onClick={() => handleTogglePayee(paie)}>
                          {paie.payee ? "Marquer non payée" : "Marquer payée"}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )
      ) : (
        pointages.length === 0 ? (
          <EmptyState
            title="Aucun pointage enregistré"
            description={peutGererPointage ? "Enregistrez le premier pointage d'un enseignant." : undefined}
          />
        ) : (
          <Table headers={peutGererPointage ? ["Enseignant", "Date", "Arrivée", "Départ", "Statut", "Actions"] : ["Enseignant", "Date", "Arrivée", "Départ", "Statut"]}>
            {pointages.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{p.enseignant_nom}</td>
                <td className="px-4 py-3">{new Date(p.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3">{p.heure_arrivee?.slice(0, 5) || "—"}</td>
                <td className="px-4 py-3">{p.heure_depart?.slice(0, 5) || "—"}</td>
                <td className="px-4 py-3"><Badge color={STATUT_COLORS[p.statut]}>{STATUT_LABELS[p.statut]}</Badge></td>
                {peutGererPointage && (
                  <td className="px-4 py-3">
                    <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => openEditPointage(p)}>
                      Corriger
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingPaie ? "Modifier la fiche de paie" : "Nouvelle fiche de paie"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select label="Enseignant" required value={form.enseignant} onChange={(e) => setForm({ ...form, enseignant: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {enseignants.map((ens) => <option key={ens.id} value={ens.id}>{ens.user.first_name} {ens.user.last_name}</option>)}
          </Select>
          <Input label="Mois concerné" type="month" required value={form.mois} onChange={(e) => setForm({ ...form, mois: e.target.value })} />
          <Select label="Mode de calcul" value={form.mode_calcul} onChange={(e) => setForm({ ...form, mode_calcul: e.target.value as "fixe" | "horaire" })}>
            <option value="fixe">Salaire fixe</option>
            <option value="horaire">Taux horaire (heures enseignées)</option>
          </Select>
          {form.mode_calcul === "fixe" ? (
            <Input label="Salaire de base (GNF)" type="number" step="0.01" min={0} required value={form.salaire_base} onChange={(e) => setForm({ ...form, salaire_base: e.target.value })} />
          ) : (
            <div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Heures enseignées" type="number" step="0.5" min={0} required
                  value={form.nombre_heures} onChange={(e) => setForm({ ...form, nombre_heures: e.target.value })}
                />
                <Input label="Taux horaire (GNF/h)" type="number" step="0.01" min={0} required value={form.taux_horaire} onChange={(e) => setForm({ ...form, taux_horaire: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  type="button" onClick={chargerHeuresPointees} disabled={heuresLoading || !form.enseignant || !form.mois}
                  className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50"
                >
                  {heuresLoading ? "Calcul…" : "🔄 Recalculer depuis les pointages"}
                </button>
                {heuresPointeesInfo && (
                  <span className="text-xs text-slate-400">
                    {heuresPointeesInfo.jours_pointes} jour{heuresPointeesInfo.jours_pointes > 1 ? "s" : ""} pointé{heuresPointeesInfo.jours_pointes > 1 ? "s" : ""} ce mois-ci
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Primes" type="number" step="0.01" min={0} value={form.primes} onChange={(e) => setForm({ ...form, primes: e.target.value })} />
            <Input label="Retenues" type="number" step="0.01" min={0} value={form.retenues} onChange={(e) => setForm({ ...form, retenues: e.target.value })} />
          </div>
          <Input label="Commentaire (optionnel)" value={form.commentaire} onChange={(e) => setForm({ ...form, commentaire: e.target.value })} />

          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={pointageModalOpen}
        onClose={() => setPointageModalOpen(false)}
        title={editingPointage ? "Corriger le pointage" : "Nouveau pointage"}
      >
        <form onSubmit={handleSubmitPointage} className="space-y-4">
          <Select
            label="Enseignant" required value={pointageForm.enseignant} disabled={!!editingPointage}
            onChange={(e) => setPointageForm({ ...pointageForm, enseignant: e.target.value })}
          >
            <option value="">— Sélectionner —</option>
            {enseignantsDisponiblesPointage.map((ens) => (
              <option key={ens.id} value={ens.id}>{ens.user.first_name} {ens.user.last_name}</option>
            ))}
          </Select>
          <Input
            label="Date" type="date" required value={pointageForm.date} disabled={!!editingPointage}
            onChange={(e) => setPointageForm({ ...pointageForm, date: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Heure d'arrivée" type="time" value={pointageForm.heure_arrivee}
              onChange={(e) => setPointageForm({ ...pointageForm, heure_arrivee: e.target.value })}
            />
            <Input
              label="Heure de départ" type="time" value={pointageForm.heure_depart}
              onChange={(e) => setPointageForm({ ...pointageForm, heure_depart: e.target.value })}
            />
          </div>
          <Select
            label="Statut" value={pointageForm.statut}
            onChange={(e) => setPointageForm({ ...pointageForm, statut: e.target.value as "present" | "retard" | "absent" })}
          >
            <option value="present">Présent</option>
            <option value="retard">Retard</option>
            <option value="absent">Absent</option>
          </Select>
          <Input
            label="Commentaire (optionnel)" value={pointageForm.commentaire}
            onChange={(e) => setPointageForm({ ...pointageForm, commentaire: e.target.value })}
          />

          {pointageError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{pointageError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setPointageModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={pointageSaving}>{pointageSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <PdfPreviewModal
        open={!!previewPaie}
        onClose={() => setPreviewPaie(null)}
        title={previewPaie ? `Fiche de paie — ${previewPaie.enseignant_nom}` : "Fiche de paie"}
        load={() => {
          if (!previewPaie) return Promise.reject(new Error("Aucune fiche sélectionnée."));
          return paiesEnseignantsApi.previewPdf(previewPaie.id, `paie_${previewPaie.enseignant_nom.replace(/\s+/g, "_")}_${previewPaie.mois.slice(0, 7)}.pdf`);
        }}
      />
    </div>
  );
}
