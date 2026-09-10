import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { categoriesDepenseApi, depensesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { usePaginated } from "../hooks/usePaginated";
import type { CategorieDepense, Depense } from "../types";

const MODE_OPTIONS: { value: Depense["mode_paiement"]; label: string }[] = [
  { value: "especes", label: "Espèces" },
  { value: "cheque", label: "Chèque" },
  { value: "virement", label: "Virement" },
  { value: "mobile_money", label: "Mobile Money" },
];

function money(value: string | number) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

const emptyForm = {
  date: new Date().toISOString().slice(0, 10), categorie: "", motif: "",
  montant: "", mode_paiement: "especes" as Depense["mode_paiement"], reference: "", responsable: "", commentaire: "",
};

export default function DepensesPage() {
  const [categories, setCategories] = useState<CategorieDepense[]>([]);

  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [categorieFiltre, setCategorieFiltre] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Depense | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [justificatif, setJustificatif] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Gestion des catégories — un admin peut en ajouter/renommer/supprimer directement ici,
  // plutôt que de dépendre d'une liste fixe (voir CategorieDepense côté backend).
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const [nouvelleCategorie, setNouvelleCategorie] = useState("");
  const [categorieEnEdition, setCategorieEnEdition] = useState<number | null>(null);
  const [categorieEditionNom, setCategorieEditionNom] = useState("");
  const [categorieError, setCategorieError] = useState("");
  const [categorieSaving, setCategorieSaving] = useState(false);

  const loadCategories = () => {
    categoriesDepenseApi.list().then(({ data }) => setCategories(unwrapList(data)));
  };
  useEffect(loadCategories, []);

  const filtres = {
    date__gte: dateDebut || undefined, date__lte: dateFin || undefined, categorie: categorieFiltre || undefined,
  };

  const { items, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<Depense>(
    () => depensesApi.list(filtres),
    [dateDebut, dateFin, categorieFiltre]
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, categorie: categories[0] ? String(categories[0].id) : "" });
    setJustificatif(null);
    setError("");
    setModalOpen(true);
  };

  const openEdit = (depense: Depense) => {
    setEditing(depense);
    setForm({
      date: depense.date, categorie: String(depense.categorie), motif: depense.motif, montant: depense.montant,
      mode_paiement: depense.mode_paiement, reference: depense.reference, responsable: depense.responsable,
      commentaire: depense.commentaire,
    });
    setJustificatif(null);
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { ...form };
      if (justificatif) payload.justificatif = justificatif;
      if (editing) await depensesApi.update(editing.id, payload);
      else await depensesApi.create(payload);
      setModalOpen(false);
      reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (depense: Depense) => {
    if (!confirm(`Supprimer la dépense « ${depense.motif} » (${money(depense.montant)}) ?`)) return;
    await depensesApi.remove(depense.id);
    reload();
  };

  const handleAjouterCategorie = async (e: FormEvent) => {
    e.preventDefault();
    if (!nouvelleCategorie.trim()) return;
    setCategorieSaving(true);
    setCategorieError("");
    try {
      await categoriesDepenseApi.create(nouvelleCategorie.trim());
      setNouvelleCategorie("");
      loadCategories();
    } catch (err) {
      setCategorieError(extractErrorMessage(err));
    } finally {
      setCategorieSaving(false);
    }
  };

  const handleRenommerCategorie = async (id: number) => {
    if (!categorieEditionNom.trim()) return;
    setCategorieSaving(true);
    setCategorieError("");
    try {
      await categoriesDepenseApi.update(id, categorieEditionNom.trim());
      setCategorieEnEdition(null);
      loadCategories();
    } catch (err) {
      setCategorieError(extractErrorMessage(err));
    } finally {
      setCategorieSaving(false);
    }
  };

  const handleSupprimerCategorie = async (categorie: CategorieDepense) => {
    if (!confirm(`Supprimer la catégorie « ${categorie.nom} » ?`)) return;
    setCategorieError("");
    try {
      await categoriesDepenseApi.remove(categorie.id);
      loadCategories();
    } catch (err) {
      setCategorieError(extractErrorMessage(err));
    }
  };

  const totalAffiche = items.reduce((sum, d) => sum + Number(d.montant), 0);

  return (
    <div>
      <PageHeader
        title="Dépenses"
        description="Toutes les sorties de caisse de l'établissement — fournitures, entretien, factures..."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/caisse" className="text-sm text-brand-600 font-medium hover:underline self-center">← Voir la Caisse</Link>
            <Button variant="secondary" onClick={() => setCategoriesModalOpen(true)}>⚙️ Catégories</Button>
            <Button variant="secondary" onClick={() => depensesApi.exportCsv(filtres)}>⬇️ Export CSV</Button>
            <Button onClick={openCreate} disabled={categories.length === 0}>+ Nouvelle dépense</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Input label="Du" type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className="max-w-[160px]" />
        <Input label="Au" type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="max-w-[160px]" />
        <Select label="Catégorie" value={categorieFiltre} onChange={(e) => setCategorieFiltre(e.target.value)} className="max-w-xs">
          <option value="">Toutes les catégories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </Select>
        {(dateDebut || dateFin || categorieFiltre) && (
          <button
            onClick={() => { setDateDebut(""); setDateFin(""); setCategorieFiltre(""); }}
            className="text-sm text-slate-400 hover:text-slate-600 pb-2.5"
          >
            ✕ Réinitialiser
          </button>
        )}
        <span className="text-sm text-slate-400 ml-auto pb-2.5">Total affiché : <strong className="text-rose-600">{money(totalAffiche)}</strong></span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucune dépense" description="Les dépenses enregistrées apparaîtront ici." />
      ) : (
        <>
          <Table headers={["Date", "Catégorie", "Motif", "Montant", "Mode", "Responsable", "Enregistré par", "Actions"]}>
            {items.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-3 text-slate-500">{new Date(d.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3">{d.categorie_nom}</td>
                <td className="px-4 py-3 font-medium text-slate-700">
                  {d.motif}
                  {d.justificatif && (
                    <a href={d.justificatif} target="_blank" rel="noreferrer" className="ml-2 text-xs text-brand-600 hover:underline">📎 Justificatif</a>
                  )}
                </td>
                <td className="px-4 py-3 font-bold text-rose-600">−{money(d.montant)}</td>
                <td className="px-4 py-3 text-slate-500">{d.mode_paiement_display}</td>
                <td className="px-4 py-3">{d.responsable}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{d.enregistre_par_nom || "—"}</td>
                <td className="px-4 py-3">
                  <RowActions>
                    <EditButton onClick={() => openEdit(d)} />
                    <DeleteButton onClick={() => handleDelete(d)} />
                  </RowActions>
                </td>
              </tr>
            ))}
          </Table>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" disabled={!hasPrevious} onClick={goPrevious}>← Précédent</Button>
            <Button variant="secondary" disabled={!hasNext} onClick={goNext}>Suivant →</Button>
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier la dépense" : "Nouvelle dépense"} wide>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select label="Catégorie" required value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Select>
          <Input label="Motif" required value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} className="sm:col-span-2" />
          <Input label="Montant (GNF)" type="number" min={0} required value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} />
          <Select label="Mode de paiement" value={form.mode_paiement} onChange={(e) => setForm({ ...form, mode_paiement: e.target.value as Depense["mode_paiement"] })}>
            {MODE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <Input label="Responsable" required placeholder="Personne ayant autorisé/émis la dépense" value={form.responsable} onChange={(e) => setForm({ ...form, responsable: e.target.value })} />
          <Input label="Référence (optionnel)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <Input label="Commentaire (optionnel)" value={form.commentaire} onChange={(e) => setForm({ ...form, commentaire: e.target.value })} className="sm:col-span-2" />
          <label className="block sm:col-span-2">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Justificatif (reçu/facture — optionnel)</span>
            <input
              type="file" accept="application/pdf,image/*"
              onChange={(e) => setJustificatif(e.target.files?.[0] || null)}
              className="text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
            />
          </label>

          {error && <p className="sm:col-span-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}

          <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={categoriesModalOpen} onClose={() => setCategoriesModalOpen(false)} title="Catégories de dépense">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Propres à votre établissement — renommez, ajoutez ou supprimez librement.
          </p>

          <form onSubmit={handleAjouterCategorie} className="flex gap-2">
            <Input
              placeholder="Nouvelle catégorie…" value={nouvelleCategorie}
              onChange={(e) => setNouvelleCategorie(e.target.value)} className="flex-1"
            />
            <Button type="submit" disabled={categorieSaving || !nouvelleCategorie.trim()}>+ Ajouter</Button>
          </form>

          {categorieError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{categorieError}</p>}

          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3.5 py-2.5">
                {categorieEnEdition === c.id ? (
                  <>
                    <Input
                      value={categorieEditionNom} onChange={(e) => setCategorieEditionNom(e.target.value)}
                      className="flex-1" autoFocus
                    />
                    <Button type="button" onClick={() => handleRenommerCategorie(c.id)} disabled={categorieSaving}>OK</Button>
                    <Button type="button" variant="secondary" onClick={() => setCategorieEnEdition(null)}>Annuler</Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-slate-700">{c.nom}</span>
                    <EditButton onClick={() => { setCategorieEnEdition(c.id); setCategorieEditionNom(c.nom); }} />
                    <DeleteButton onClick={() => handleSupprimerCategorie(c)} />
                  </>
                )}
              </li>
            ))}
            {categories.length === 0 && (
              <li className="px-3.5 py-6 text-center text-sm text-slate-400">Aucune catégorie — ajoutez-en une ci-dessus.</li>
            )}
          </ul>

          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => setCategoriesModalOpen(false)}>Fermer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
