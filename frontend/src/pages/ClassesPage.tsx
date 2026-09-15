import { useEffect, useState, type FormEvent } from "react";

import { anneesApi, classesApi, elevesApi, enseignantsApi, enseignementsApi, matieresApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import { CYCLE_LABELS } from "../types";
import type { AnneeScolaire, Classe, Cycle, EleveProfile, Enseignement, EnseignantProfile, Matiere } from "../types";

const CYCLE_COLORS: Record<string, "brand" | "teal" | "amber" | "rose" | "slate"> = {
  prescolaire: "rose", primaire: "teal", college: "brand", lycee: "amber",
};

// Ordre pédagogique (du plus jeune au plus âgé) plutôt qu'alphabétique — "" (non affecté) en dernier.
const ORDRE_CYCLES: Cycle[] = ["prescolaire", "primaire", "college", "lycee", ""];

const emptyForm = { nom: "", niveau: "", cycle: "", annee_scolaire: "", professeur_principal: "", capacite: 30 };

/** Couleur du badge d'effectif selon le taux de remplissage — vert tant qu'il reste de la
 * marge, ambre à l'approche du seuil (≥ 90% de la capacité, places bientôt épuisées),
 * rose une fois la classe pleine (ou en sureffectif). */
function effectifColor(effectif: number, capacite: number): "green" | "amber" | "rose" {
  if (!capacite) return "green";
  const taux = effectif / capacite;
  if (taux >= 1) return "rose";
  if (taux >= 0.9) return "amber";
  return "green";
}

export default function ClassesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmer = useConfirm();
  const isAdmin = user?.role === "admin";
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [teachers, setTeachers] = useState<EnseignantProfile[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Classe | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailClasse, setDetailClasse] = useState<Classe | null>(null);
  const [devinant, setDevinant] = useState(false);

  // page_size élevé : les classes sont regroupées par niveau ci-dessous plutôt que
  // paginées, il faut donc toutes les charger d'un coup.
  const { items, loading, reload } = usePaginated<Classe>(() => classesApi.list({ page_size: 500 }), []);

  const groupesParCycle = ORDRE_CYCLES
    .map((cycle) => ({ cycle, classes: items.filter((c) => c.cycle === cycle) }))
    .filter((g) => g.classes.length > 0);

  const handleDevinerCycles = async () => {
    setDevinant(true);
    try {
      const { data } = await classesApi.devinerCycles();
      toast.success(
        data.classes_affectees > 0
          ? `${data.classes_affectees} classe(s) affectée(s) à un niveau.`
          : "Toutes les classes reconnues ont déjà un niveau — rien à affecter."
      );
      reload();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setDevinant(false);
    }
  };

  useEffect(() => {
    anneesApi.list().then(({ data }) => setAnnees(unwrapList(data)));
    enseignantsApi.list().then(({ data }) => setTeachers(unwrapList(data)));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, annee_scolaire: annees.find((a) => a.active)?.id.toString() || "" });
    setError("");
    setModalOpen(true);
  };

  const openEdit = (classe: Classe) => {
    setEditing(classe);
    setForm({
      nom: classe.nom, niveau: classe.niveau, cycle: classe.cycle, annee_scolaire: String(classe.annee_scolaire),
      professeur_principal: classe.professeur_principal ? String(classe.professeur_principal) : "",
      capacite: classe.capacite,
    });
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        cycle: form.cycle as Classe["cycle"],
        annee_scolaire: Number(form.annee_scolaire),
        professeur_principal: form.professeur_principal ? Number(form.professeur_principal) : null,
      };
      if (editing) await classesApi.update(editing.id, payload);
      else await classesApi.create(payload);
      setModalOpen(false);
      reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (classe: Classe) => {
    if (!(await confirmer(`Supprimer la classe ${classe.nom} ?`, { danger: true }))) return;
    await classesApi.remove(classe.id);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Classes"
        description="Structure des classes et affectations pédagogiques."
        actions={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleDevinerCycles} disabled={devinant}>
                {devinant ? "Affectation…" : "🪄 Deviner les niveaux"}
              </Button>
              <Button onClick={openCreate}>+ Nouvelle classe</Button>
            </div>
          ) : undefined
        }
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucune classe créée" />
      ) : (
        <div className="space-y-8">
          {groupesParCycle.map(({ cycle, classes }) => (
            <div key={cycle || "non-affecte"}>
              <div className="flex items-center gap-2 mb-3">
                {cycle ? (
                  <Badge color={CYCLE_COLORS[cycle]}>{CYCLE_LABELS[cycle]}</Badge>
                ) : (
                  <Badge color="slate">Niveau non affecté</Badge>
                )}
                <span className="text-xs text-slate-400">
                  {classes.length} classe{classes.length > 1 ? "s" : ""}
                </span>
              </div>
              <Table headers={["Classe", "Niveau", "Année scolaire", "Professeur principal", "Effectif", "Actions"]}>
                {classes.map((classe) => (
                  <tr key={classe.id}>
                    <td className="px-4 py-3 font-medium text-slate-700">{classe.nom}</td>
                    <td className="px-4 py-3">{classe.niveau}</td>
                    <td className="px-4 py-3">{classe.annee_scolaire_libelle}</td>
                    <td className="px-4 py-3">{classe.professeur_principal_nom || "—"}</td>
                    <td className="px-4 py-3"><Badge color={effectifColor(classe.effectif, classe.capacite)}>{classe.effectif}/{classe.capacite}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setDetailClasse(classe)} className="text-brand-600 hover:underline text-sm">Détails</button>
                        {isAdmin && (
                          <RowActions>
                            <EditButton onClick={() => openEdit(classe)} />
                            <DeleteButton onClick={() => handleDelete(classe)} />
                          </RowActions>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier la classe" : "Nouvelle classe"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nom de la classe" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Ex: 6ème A" />
          <Input label="Niveau" required value={form.niveau} onChange={(e) => setForm({ ...form, niveau: e.target.value })} placeholder="Ex: 6ème" />
          <div>
            <Select label="Cycle" value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })}>
              <option value="">— Deviné automatiquement depuis le niveau —</option>
              {Object.entries(CYCLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <p className="text-xs text-slate-400 mt-1">
              Laissez vide pour laisser l'appli deviner le cycle depuis le niveau, ou choisissez-le manuellement.
            </p>
          </div>
          <Select label="Année scolaire" required value={form.annee_scolaire} onChange={(e) => setForm({ ...form, annee_scolaire: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </Select>
          <Select label="Professeur principal" value={form.professeur_principal} onChange={(e) => setForm({ ...form, professeur_principal: e.target.value })}>
            <option value="">— Aucun —</option>
            {teachers.map((t) => <option key={t.user.id} value={t.user.id}>{t.user.first_name} {t.user.last_name}</option>)}
          </Select>
          <Input label="Capacité" type="number" min={1} value={form.capacite} onChange={(e) => setForm({ ...form, capacite: Number(e.target.value) })} />

          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      {detailClasse && (
        <ClassDetailModal classe={detailClasse} isAdmin={isAdmin} onClose={() => setDetailClasse(null)} teachers={teachers} />
      )}
    </div>
  );
}

function ClassDetailModal({
  classe, isAdmin, onClose, teachers,
}: { classe: Classe; isAdmin: boolean; onClose: () => void; teachers: EnseignantProfile[] }) {
  const [matieres, setMatieres] = useState<Matiere[]>([]);
  const [enseignements, setEnseignements] = useState<Enseignement[]>([]);
  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [newMatiere, setNewMatiere] = useState("");
  const [newEnseignant, setNewEnseignant] = useState("");
  const [loading, setLoading] = useState(true);

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      matieresApi.list(),
      enseignementsApi.list({ classe: classe.id }),
      elevesApi.list({ classe: classe.id }),
    ]).then(([m, e, el]) => {
      setMatieres(unwrapList(m.data));
      setEnseignements(unwrapList(e.data));
      setEleves(unwrapList(el.data));
    }).finally(() => setLoading(false));
  };

  useEffect(loadAll, [classe.id]);

  const addEnseignement = async () => {
    if (!newMatiere || !newEnseignant) return;
    await enseignementsApi.create({ classe: classe.id, matiere: Number(newMatiere), enseignant: Number(newEnseignant) });
    setNewMatiere("");
    setNewEnseignant("");
    loadAll();
  };

  const removeEnseignement = async (id: number) => {
    await enseignementsApi.remove(id);
    loadAll();
  };

  return (
    <Modal open onClose={onClose} title={`${classe.nom} — Détails`} wide>
      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          <div>
            <h4 className="font-bold text-ink-900 mb-2">Enseignements affectés</h4>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
              {enseignements.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Aucun enseignement affecté</li>}
              {enseignements.map((e) => (
                <li key={e.id} className="px-3 py-2 flex items-center justify-between text-sm">
                  <span>{e.matiere_nom} — {e.enseignant_nom}</span>
                  {isAdmin && <button onClick={() => removeEnseignement(e.id)} className="text-rose-600 hover:underline">Retirer</button>}
                </li>
              ))}
            </ul>
            {isAdmin && (
              <div className="flex gap-2 mt-3">
                <Select value={newMatiere} onChange={(e) => setNewMatiere(e.target.value)} className="flex-1">
                  <option value="">Matière…</option>
                  {matieres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                </Select>
                <Select value={newEnseignant} onChange={(e) => setNewEnseignant(e.target.value)} className="flex-1">
                  <option value="">Enseignant…</option>
                  {teachers.map((t) => <option key={t.user.id} value={t.user.id}>{t.user.first_name} {t.user.last_name}</option>)}
                </Select>
                <Button type="button" onClick={addEnseignement}>Affecter</Button>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-bold text-ink-900 mb-2">Élèves ({eleves.length})</h4>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-64 overflow-y-auto">
              {eleves.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Aucun élève inscrit</li>}
              {eleves.map((el) => (
                <li key={el.id} className="px-3 py-2 text-sm flex justify-between">
                  <span>{el.user.first_name} {el.user.last_name}</span>
                  <span className="text-slate-400 font-mono text-xs">{el.matricule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
