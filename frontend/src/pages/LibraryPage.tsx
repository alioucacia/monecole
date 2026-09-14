import { useEffect, useState, type FormEvent } from "react";

import { elevesApi, empruntsApi, livresApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { usePaginated } from "../hooks/usePaginated";
import type { EleveProfile, Emprunt, Livre } from "../types";

const STATUT_LABELS: Record<string, { label: string; color: "green" | "amber" | "rose" }> = {
  en_cours: { label: "En cours", color: "amber" },
  en_retard: { label: "En retard", color: "rose" },
  rendu: { label: "Rendu", color: "green" },
};

const emptyLivreForm = { titre: "", auteur: "", isbn: "", categorie: "", exemplaires_total: 1, duree_emprunt_jours: 14 };
const emptyEmpruntForm = { livre: "", eleve: "", date_retour_prevue: "" };

/** "AAAA-MM-JJ" pour aujourd'hui + n jours (valeur attendue par un <input type="date">). */
function dateDansNJours(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function LibraryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canLend = user?.role === "admin" || user?.role === "teacher";

  const [livres, setLivres] = useState<Livre[]>([]);
  const [loadingLivres, setLoadingLivres] = useState(true);
  const [livreModalOpen, setLivreModalOpen] = useState(false);
  const [editingLivre, setEditingLivre] = useState<Livre | null>(null);
  const [livreForm, setLivreForm] = useState(emptyLivreForm);
  const [livreCouverture, setLivreCouverture] = useState<File | null>(null);
  const [livreCouverturePreview, setLivreCouverturePreview] = useState<string | null>(null);
  const [livreError, setLivreError] = useState("");
  const [livreSaving, setLivreSaving] = useState(false);

  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [empruntModalOpen, setEmpruntModalOpen] = useState(false);
  const [empruntForm, setEmpruntForm] = useState(emptyEmpruntForm);
  const [empruntError, setEmpruntError] = useState("");
  const [empruntSaving, setEmpruntSaving] = useState(false);

  const { items: emprunts, loading: loadingEmprunts, reload: reloadEmprunts } = usePaginated<Emprunt>(
    () => empruntsApi.list({ page_size: 100 }), []
  );

  const loadLivres = () => {
    setLoadingLivres(true);
    livresApi.list({ page_size: 100 }).then(({ data }) => setLivres(unwrapList(data))).finally(() => setLoadingLivres(false));
  };

  useEffect(loadLivres, []);
  useEffect(() => {
    if (canLend) elevesApi.list({ page_size: 500 }).then(({ data }) => setEleves(unwrapList(data)));
  }, [canLend]);

  const openCreateLivre = () => {
    setEditingLivre(null);
    setLivreForm(emptyLivreForm);
    setLivreCouverture(null);
    setLivreCouverturePreview(null);
    setLivreError("");
    setLivreModalOpen(true);
  };

  const openEditLivre = (livre: Livre) => {
    setEditingLivre(livre);
    setLivreForm({
      titre: livre.titre, auteur: livre.auteur, isbn: livre.isbn, categorie: livre.categorie,
      exemplaires_total: livre.exemplaires_total, duree_emprunt_jours: livre.duree_emprunt_jours,
    });
    setLivreCouverture(null);
    setLivreCouverturePreview(livre.couverture);
    setLivreError("");
    setLivreModalOpen(true);
  };

  const handleLivreCouvertureChange = (file: File | null) => {
    setLivreCouverture(file);
    setLivreCouverturePreview(file ? URL.createObjectURL(file) : editingLivre?.couverture || null);
  };

  const handleLivreSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLivreSaving(true);
    setLivreError("");
    try {
      const payload: Record<string, unknown> = { ...livreForm };
      if (livreCouverture) payload.couverture = livreCouverture;
      if (editingLivre) await livresApi.update(editingLivre.id, payload);
      else await livresApi.create(payload);
      setLivreModalOpen(false);
      loadLivres();
    } catch (err) {
      setLivreError(extractErrorMessage(err));
    } finally {
      setLivreSaving(false);
    }
  };

  const handleDeleteLivre = async (livre: Livre) => {
    if (!confirm(`Supprimer le livre "${livre.titre}" ?`)) return;
    await livresApi.remove(livre.id);
    loadLivres();
  };

  const openEmpruntModal = (livre?: Livre) => {
    setEmpruntForm({
      ...emptyEmpruntForm,
      livre: livre ? String(livre.id) : "",
      date_retour_prevue: livre ? dateDansNJours(livre.duree_emprunt_jours) : "",
    });
    setEmpruntError("");
    setEmpruntModalOpen(true);
  };

  /** Sélectionner un livre préremplit la date de retour selon sa durée d'emprunt par défaut
   * (l'utilisateur peut ensuite l'ajuster manuellement si besoin). */
  const handleEmpruntLivreChange = (livreId: string) => {
    const livre = livres.find((l) => String(l.id) === livreId);
    setEmpruntForm({
      ...empruntForm, livre: livreId,
      date_retour_prevue: livre ? dateDansNJours(livre.duree_emprunt_jours) : empruntForm.date_retour_prevue,
    });
  };

  const handleEmpruntSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setEmpruntSaving(true);
    setEmpruntError("");
    try {
      await empruntsApi.create({
        livre: Number(empruntForm.livre), eleve: Number(empruntForm.eleve),
        date_retour_prevue: empruntForm.date_retour_prevue,
      });
      setEmpruntModalOpen(false);
      loadLivres();
      reloadEmprunts();
    } catch (err) {
      setEmpruntError(extractErrorMessage(err));
    } finally {
      setEmpruntSaving(false);
    }
  };

  const handleRetourner = async (emprunt: Emprunt) => {
    await empruntsApi.retourner(emprunt.id);
    loadLivres();
    reloadEmprunts();
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Bibliothèque"
        description="Catalogue des livres et suivi des emprunts."
        actions={
          <div className="flex flex-wrap gap-2">
            {canLend && <Button variant="secondary" onClick={() => openEmpruntModal()}>+ Nouvel emprunt</Button>}
            {isAdmin && <Button onClick={openCreateLivre}>+ Nouveau livre</Button>}
          </div>
        }
      />

      <div>
        <h3 className="font-bold text-ink-900 mb-3">Catalogue</h3>
        {loadingLivres ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : livres.length === 0 ? (
          <EmptyState title="Aucun livre au catalogue" />
        ) : (
          <Table headers={["", "Titre", "Auteur", "Catégorie", "Disponibles", "Durée d'emprunt", ...(canLend ? ["Actions"] : [])]}>
            {livres.map((livre) => (
              <tr key={livre.id}>
                <td className="px-4 py-3">
                  {livre.couverture ? (
                    <img src={livre.couverture} alt="" className="h-12 w-9 rounded object-cover border border-slate-100 shrink-0" />
                  ) : (
                    <div className="h-12 w-9 rounded bg-slate-100 text-slate-300 flex items-center justify-center text-lg shrink-0">📕</div>
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-slate-700">{livre.titre}</td>
                <td className="px-4 py-3 text-slate-500">{livre.auteur || "—"}</td>
                <td className="px-4 py-3">{livre.categorie ? <Badge>{livre.categorie}</Badge> : "—"}</td>
                <td className="px-4 py-3">
                  <Badge color={livre.exemplaires_disponibles > 0 ? "green" : "rose"}>
                    {livre.exemplaires_disponibles} / {livre.exemplaires_total}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{livre.duree_emprunt_jours} jours</td>
                {canLend && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {livre.exemplaires_disponibles > 0 && (
                        <button onClick={() => openEmpruntModal(livre)} className="text-brand-600 hover:underline text-sm">Emprunter</button>
                      )}
                      {isAdmin && (
                        <RowActions>
                          <EditButton onClick={() => openEditLivre(livre)} />
                          <DeleteButton onClick={() => handleDeleteLivre(livre)} />
                        </RowActions>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </div>

      <div>
        <h3 className="font-bold text-ink-900 mb-3">{canLend ? "Emprunts" : "Mes emprunts"}</h3>
        {loadingEmprunts ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : emprunts.length === 0 ? (
          <EmptyState title="Aucun emprunt enregistré" />
        ) : (
          <Table headers={["Livre", "Élève", "Emprunté le", "Retour prévu", "Statut", ...(canLend ? ["Actions"] : [])]}>
            {emprunts.map((emprunt) => (
              <tr key={emprunt.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{emprunt.livre_titre}</td>
                <td className="px-4 py-3">{emprunt.eleve_nom}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(emprunt.date_emprunt).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(emprunt.date_retour_prevue).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3"><Badge color={STATUT_LABELS[emprunt.statut].color}>{STATUT_LABELS[emprunt.statut].label}</Badge></td>
                {canLend && (
                  <td className="px-4 py-3">
                    {emprunt.statut !== "rendu" && (
                      <button onClick={() => handleRetourner(emprunt)} className="text-brand-600 hover:underline text-sm">Marquer rendu</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </div>

      <Modal open={livreModalOpen} onClose={() => setLivreModalOpen(false)} title={editingLivre ? "Modifier le livre" : "Nouveau livre"}>
        <form onSubmit={handleLivreSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            {livreCouverturePreview ? (
              <img src={livreCouverturePreview} alt="" className="h-24 w-18 rounded-lg object-cover border-2 border-brand-100 shrink-0" />
            ) : (
              <div className="h-24 w-18 rounded-lg bg-slate-100 text-slate-300 flex items-center justify-center text-3xl shrink-0">📕</div>
            )}
            <label className="block">
              <span className="block text-sm font-semibold text-slate-600 mb-1.5">Couverture (optionnel)</span>
              <input type="file" accept="image/*" onChange={(e) => handleLivreCouvertureChange(e.target.files?.[0] || null)} className="text-sm" />
            </label>
          </div>
          <Input label="Titre" required value={livreForm.titre} onChange={(e) => setLivreForm({ ...livreForm, titre: e.target.value })} />
          <Input label="Auteur" value={livreForm.auteur} onChange={(e) => setLivreForm({ ...livreForm, auteur: e.target.value })} />
          <Input label="Catégorie" value={livreForm.categorie} onChange={(e) => setLivreForm({ ...livreForm, categorie: e.target.value })} />
          <Input label="ISBN (optionnel)" value={livreForm.isbn} onChange={(e) => setLivreForm({ ...livreForm, isbn: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nombre d'exemplaires" type="number" min={1} required value={livreForm.exemplaires_total} onChange={(e) => setLivreForm({ ...livreForm, exemplaires_total: Number(e.target.value) })} />
            <Input
              label="Durée d'emprunt (jours)" type="number" min={1} required
              value={livreForm.duree_emprunt_jours}
              onChange={(e) => setLivreForm({ ...livreForm, duree_emprunt_jours: Number(e.target.value) })}
            />
          </div>

          {livreError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{livreError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setLivreModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={livreSaving}>{livreSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={empruntModalOpen} onClose={() => setEmpruntModalOpen(false)} title="Nouvel emprunt">
        <form onSubmit={handleEmpruntSubmit} className="space-y-4">
          <Select label="Livre" required value={empruntForm.livre} onChange={(e) => handleEmpruntLivreChange(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {livres.filter((l) => l.exemplaires_disponibles > 0).map((l) => <option key={l.id} value={l.id}>{l.titre}</option>)}
          </Select>
          <Select label="Élève" required value={empruntForm.eleve} onChange={(e) => setEmpruntForm({ ...empruntForm, eleve: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {eleves.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
          </Select>
          <div>
            <Input label="Date de retour prévue" type="date" required value={empruntForm.date_retour_prevue} onChange={(e) => setEmpruntForm({ ...empruntForm, date_retour_prevue: e.target.value })} />
            <p className="text-xs text-slate-400 mt-1.5">Préremplie selon la durée d'emprunt par défaut du livre — modifiable si besoin.</p>
          </div>

          {empruntError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{empruntError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setEmpruntModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={empruntSaving}>{empruntSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
