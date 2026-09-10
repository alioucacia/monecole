import { useEffect, useState, type FormEvent } from "react";

import { classesApi, elevesApi, enseignementsApi, notesApi, periodesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import { usePaginated } from "../hooks/usePaginated";
import type { Classe, Cycle, EleveProfile, Enseignement, Note, Periode } from "../types";

const TYPE_LABELS: Record<string, string> = {
  devoir: "Devoir", composition: "Composition", interrogation: "Interrogation", projet: "Projet",
};

const emptyForm = {
  eleve: "", matiere: "", periode: "", type_evaluation: "devoir", valeur: "", coefficient: 1,
  date: new Date().toISOString().slice(0, 10), commentaire: "",
};

export default function GradesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "teacher";

  const [classes, setClasses] = useState<Classe[]>([]);
  const [enseignements, setEnseignements] = useState<Enseignement[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  const [classeFilter, setClasseFilter] = useState("");
  const [matiereFilter, setMatiereFilter] = useState("");
  const [periodeFilter, setPeriodeFilter] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { items, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<Note>(
    () => notesApi.list({
      matiere: matiereFilter || undefined,
      periode: periodeFilter || undefined,
      eleve__classe: classeFilter || undefined,
    }),
    [classeFilter, matiereFilter, periodeFilter]
  );

  useEffect(() => {
    periodesApi.list().then(({ data }) => setPeriodes(unwrapList(data)));
    if (canEdit) {
      classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
      enseignementsApi.list().then(({ data }) => setEnseignements(unwrapList(data)));
    }
  }, [canEdit]);

  useEffect(() => {
    if (classeFilter) {
      elevesApi.list({ classe: classeFilter, page_size: 200 }).then(({ data }) => setEleves(unwrapList(data)));
    } else {
      setEleves([]);
    }
  }, [classeFilter]);

  const matieresDisponibles = enseignements.filter((e) => !classeFilter || e.classe === Number(classeFilter));
  const classesFiltrees = classes.filter((c) => !cycleFiltre || c.cycle === cycleFiltre);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, matiere: matiereFilter, periode: periodeFilter });
    setError("");
    setModalOpen(true);
  };

  const openEdit = (note: Note) => {
    setEditing(note);
    setForm({
      eleve: String(note.eleve), matiere: String(note.matiere), periode: String(note.periode),
      type_evaluation: note.type_evaluation, valeur: note.valeur, coefficient: note.coefficient,
      date: note.date, commentaire: note.commentaire,
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
        eleve: Number(form.eleve), matiere: Number(form.matiere), periode: Number(form.periode),
        type_evaluation: form.type_evaluation as Note["type_evaluation"],
      };
      if (editing) await notesApi.update(editing.id, payload);
      else await notesApi.create(payload);
      setModalOpen(false);
      reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (note: Note) => {
    if (!confirm("Supprimer cette note ?")) return;
    await notesApi.remove(note.id);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Notes"
        description={canEdit ? "Saisie et consultation des notes des élèves." : "Consultation de vos notes."}
        actions={canEdit ? <Button onClick={openCreate}>+ Saisir une note</Button> : undefined}
      />

      <div className="flex flex-wrap gap-3 mb-4">
        {canEdit && (
          <CycleSelect
            value={cycleFiltre}
            onChange={(c) => { setCycleFiltre(c); setClasseFilter(""); setMatiereFilter(""); }}
            className="max-w-xs"
          />
        )}
        {canEdit && (
          <Select value={classeFilter} onChange={(e) => { setClasseFilter(e.target.value); setMatiereFilter(""); }} className="max-w-xs">
            <option value="">Toutes les classes</option>
            {classesFiltrees.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Select>
        )}
        {canEdit && (
          <Select value={matiereFilter} onChange={(e) => setMatiereFilter(e.target.value)} className="max-w-xs">
            <option value="">Toutes les matières</option>
            {[...new Map(matieresDisponibles.map((e) => [e.matiere, e.matiere_nom])).entries()].map(([id, nom]) => (
              <option key={id} value={id}>{nom}</option>
            ))}
          </Select>
        )}
        <Select value={periodeFilter} onChange={(e) => setPeriodeFilter(e.target.value)} className="max-w-xs">
          <option value="">Toutes les périodes</option>
          {periodes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucune note trouvée" />
      ) : (
        <>
          <Table headers={["Élève", "Matière", "Type", "Note", "Coeff.", "Période", "Date", ...(canEdit ? ["Actions"] : [])]}>
            {items.map((note) => (
              <tr key={note.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{note.eleve_nom}</td>
                <td className="px-4 py-3">{note.matiere_nom}</td>
                <td className="px-4 py-3"><Badge>{TYPE_LABELS[note.type_evaluation]}</Badge></td>
                <td className="px-4 py-3 font-semibold">{note.valeur}/20</td>
                <td className="px-4 py-3">{note.coefficient}</td>
                <td className="px-4 py-3">{note.periode_nom}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(note.date).toLocaleDateString("fr-FR")}</td>
                {canEdit && (
                  <td className="px-4 py-3">
                    <RowActions>
                      <EditButton onClick={() => openEdit(note)} />
                      <DeleteButton onClick={() => handleDelete(note)} />
                    </RowActions>
                  </td>
                )}
              </tr>
            ))}
          </Table>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" disabled={!hasPrevious} onClick={goPrevious}>← Précédent</Button>
            <Button variant="secondary" disabled={!hasNext} onClick={goNext}>Suivant →</Button>
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier la note" : "Saisir une note"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select label="Classe" value={classeFilter} onChange={(e) => { setClasseFilter(e.target.value); setForm({ ...form, eleve: "", matiere: "" }); }}>
            <option value="">— Sélectionner une classe —</option>
            {classesFiltrees.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Select>
          <Select label="Élève" required value={form.eleve} onChange={(e) => setForm({ ...form, eleve: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {eleves.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
          </Select>
          <Select label="Matière" required value={form.matiere} onChange={(e) => setForm({ ...form, matiere: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {[...new Map(matieresDisponibles.map((e) => [e.matiere, e.matiere_nom])).entries()].map(([id, nom]) => (
              <option key={id} value={id}>{nom}</option>
            ))}
          </Select>
          <Select label="Période" required value={form.periode} onChange={(e) => setForm({ ...form, periode: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {periodes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </Select>
          <Select label="Type d'évaluation" value={form.type_evaluation} onChange={(e) => setForm({ ...form, type_evaluation: e.target.value })}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Note (/20)" type="number" min={0} max={20} step="0.25" required value={form.valeur} onChange={(e) => setForm({ ...form, valeur: e.target.value })} />
            <Input label="Coefficient" type="number" min={1} required value={form.coefficient} onChange={(e) => setForm({ ...form, coefficient: Number(e.target.value) })} />
          </div>
          <Input label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Commentaire" value={form.commentaire} onChange={(e) => setForm({ ...form, commentaire: e.target.value })} />

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
