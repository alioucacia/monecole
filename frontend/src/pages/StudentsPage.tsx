import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { classesApi, elevesApi, typesFraisApi, unwrapList, usersApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { ClasseOptions, CycleSelect } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import { usePaginated } from "../hooks/usePaginated";
import type { Classe, Cycle, EleveProfile, User } from "../types";

type ParentMode = "aucun" | "existant" | "nouveau";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

const emptyForm = {
  first_name: "", last_name: "", email: "", matricule: "", classe: "", parent: "",
  phone: "", address: "", date_of_birth: "", lieu_naissance: "", sexe: "", password: "changeme123",
  nom_pere: "", nom_mere: "", nom_tuteur: "", regime: "externe", statut_inscription: "nouveau",
  parentMode: "aucun" as ParentMode,
  parent_username: "", parent_first_name: "", parent_last_name: "", parent_phone: "", parent_email: "",
  parent_password: "changeme123",
};

export default function StudentsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [classeFilter, setClasseFilter] = useState("");
  const [cycleFilter, setCycleFilter] = useState<Cycle | "">("");
  const [classes, setClasses] = useState<Classe[]>([]);
  const [parents, setParents] = useState<User[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EleveProfile | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importRapport, setImportRapport] = useState<{ crees: number; total_lignes: number; erreurs: { ligne: number; message: string }[] } | null>(null);
  const [importError, setImportError] = useState("");
  // Frais d'inscription réglé pour la classe choisie (voir TypeFrais.usage + TarifClasse) —
  // purement informatif ici : le frais lui-même reste créé à la main dans Paiements, comme
  // avant, ce chiffre sert juste de repère à l'admin au moment d'inscrire l'élève.
  const [tarifInscription, setTarifInscription] = useState<{ type_frais_nom: string | null; montant: string | null } | null>(null);

  const { items, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<EleveProfile>(
    () => elevesApi.list({ search: search || undefined, classe: classeFilter || undefined, cycle: cycleFilter || undefined }),
    [search, classeFilter, cycleFilter]
  );

  useEffect(() => {
    classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
    if (isAdmin) {
      usersApi.list({ role: "parent" }).then(({ data }) => setParents(unwrapList(data)));
    }
  }, [isAdmin]);

  useEffect(() => {
    // Uniquement pour une nouvelle inscription — un élève déjà inscrit n'a pas à réafficher ce
    // montant (déjà facturé ou non, ce n'est plus la question au moment d'une simple modification).
    if (!form.classe || editing) {
      setTarifInscription(null);
      return;
    }
    typesFraisApi.tarifParUsage("inscription", Number(form.classe))
      .then(({ data }) => setTarifInscription(data))
      .catch(() => setTarifInscription(null));
  }, [form.classe, editing]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setPhotoFile(null);
    setPhotoPreview(null);
    setError("");
    setModalOpen(true);
  };

  const openEdit = (eleve: EleveProfile) => {
    setEditing(eleve);
    setForm({
      first_name: eleve.user.first_name, last_name: eleve.user.last_name, email: eleve.user.email,
      matricule: eleve.matricule, classe: eleve.classe ? String(eleve.classe) : "",
      parent: eleve.parent ? String(eleve.parent) : "", phone: eleve.user.phone, address: eleve.user.address,
      date_of_birth: eleve.user.date_of_birth || "", lieu_naissance: eleve.lieu_naissance,
      sexe: eleve.user.sexe || "", password: "",
      nom_pere: eleve.nom_pere, nom_mere: eleve.nom_mere, nom_tuteur: eleve.nom_tuteur,
      regime: eleve.regime, statut_inscription: eleve.statut_inscription,
      parentMode: eleve.parent ? "existant" : "aucun",
      parent_username: "", parent_first_name: "", parent_last_name: "", parent_phone: "", parent_email: "",
      parent_password: "changeme123",
    });
    setPhotoFile(null);
    setPhotoPreview(eleve.user.photo);
    setError("");
    setModalOpen(true);
  };

  // Revenu depuis la fiche détail d'un élève avec l'intention de le modifier (StudentDetailPage → "✏️ Modifier").
  useEffect(() => {
    const editEleveId = (location.state as { editEleveId?: number } | null)?.editEleveId;
    if (!editEleveId || !isAdmin) return;
    elevesApi.get(editEleveId).then(({ data }) => openEdit(data));
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isAdmin]);

  const handlePhotoChange = (file: File | null) => {
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : editing?.user.photo || null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        ...form,
        classe: form.classe || null,
        parent: form.parentMode === "existant" ? (form.parent || null) : null,
        parent_creer: form.parentMode === "nouveau",
      };
      delete payload.parentMode;
      if (photoFile) payload.photo = photoFile;
      if (editing && !form.password) delete payload.password;
      if (editing) {
        await elevesApi.update(editing.id, payload);
      } else {
        const { data: nouvelEleve } = await elevesApi.create(payload);
        // Reçu d'inscription imprimé automatiquement dès la création du dossier de l'élève.
        elevesApi.recuInscription(nouvelEleve.id, `recu_inscription_${nouvelEleve.matricule}.pdf`).catch(() => {});
      }
      if (form.parentMode === "nouveau") {
        // Le parent tout juste créé doit apparaître dans le sélecteur "parent existant" dès la
        // prochaine ouverture du formulaire (ex: un autre enfant de la même famille).
        usersApi.list({ role: "parent" }).then(({ data }) => setParents(unwrapList(data)));
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (eleve: EleveProfile) => {
    if (!confirm(`Supprimer définitivement ${eleve.user.first_name} ${eleve.user.last_name} ?`)) return;
    await elevesApi.remove(eleve.id);
    reload();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await elevesApi.exportCsv({ search: search || undefined, classe: classeFilter || undefined });
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await elevesApi.exportPdf({ search: search || undefined, classe: classeFilter || undefined });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    setImporting(true);
    setImportRapport(null);
    setImportError("");
    try {
      const { data } = await elevesApi.importExcel(fichier);
      setImportRapport(data);
      if (data.crees > 0) reload();
    } catch (err) {
      setImportError(extractErrorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Élèves"
        description="Gestion des inscriptions et des profils élèves."
        actions={isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>{exporting ? "Export…" : "📤 Exporter CSV"}</Button>
            <Button variant="secondary" onClick={handleExportPdf} disabled={exportingPdf}>{exportingPdf ? "Export…" : "🖨️ Exporter PDF"}</Button>
            <Button variant="secondary" onClick={() => { setImportRapport(null); setImportError(""); setImportModalOpen(true); }}>📥 Importer Excel</Button>
            <Button onClick={openCreate}>+ Nouvel élève</Button>
          </div>
        ) : undefined}
      />

      <div className="flex flex-wrap gap-3 mb-4">
        <Input placeholder="Rechercher un élève…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <CycleSelect
          value={cycleFilter}
          onChange={(c) => { setCycleFilter(c); setClasseFilter(""); }}
          className="max-w-xs"
        />
        <Select value={classeFilter} onChange={(e) => setClasseFilter(e.target.value)} className="max-w-xs">
          <option value="">Toutes les classes</option>
          {classes.filter((c) => !cycleFilter || c.cycle === cycleFilter).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun élève trouvé" />
      ) : (
        <>
          <Table headers={["Matricule", "Nom complet", "Classe", "Parent", "Contact", "Actions"]}>
            {items.map((eleve) => (
              <tr key={eleve.id}>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{eleve.matricule}</td>
                <td className="px-4 py-3 font-medium text-slate-700">
                  <Link to={`/eleves/${eleve.id}`} className="flex items-center gap-2.5 hover:text-brand-700">
                    {eleve.user.photo ? (
                      <img src={eleve.user.photo} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                        {(eleve.user.first_name[0] || "?").toUpperCase()}
                      </div>
                    )}
                    {eleve.user.first_name} {eleve.user.last_name}
                  </Link>
                </td>
                <td className="px-4 py-3">{eleve.classe_nom || "—"}</td>
                <td className="px-4 py-3">{eleve.parent_nom || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{eleve.user.email || eleve.user.phone || "—"}</td>
                <td className="px-4 py-3">
                  <RowActions>
                    <Link to={`/eleves/${eleve.id}`} className="text-xs font-semibold text-brand-700 hover:underline">
                      👁️ Fiche
                    </Link>
                    <button
                      className="text-xs font-semibold text-brand-700 hover:underline"
                      onClick={() => elevesApi.recuInscription(eleve.id, `recu_inscription_${eleve.matricule}.pdf`)}
                    >
                      🧾 Reçu
                    </button>
                    {isAdmin && (
                      <>
                        <EditButton onClick={() => openEdit(eleve)} />
                        <DeleteButton onClick={() => handleDelete(eleve)} />
                      </>
                    )}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier l'élève" : "Nouvel élève"} wide>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 flex items-center gap-4">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-brand-100 shrink-0" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg shrink-0">
                {(form.first_name[0] || "?").toUpperCase()}
              </div>
            )}
            <label className="block">
              <span className="block text-sm font-semibold text-slate-600 mb-1.5">Photo (optionnel)</span>
              <input
                type="file" accept="image/*"
                onChange={(e) => handlePhotoChange(e.target.files?.[0] || null)}
                className="text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
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
                Généré automatiquement (initiales + n° d'inscription)
              </p>
            </label>
          )}
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div>
            <Select label="Classe" value={form.classe} onChange={(e) => setForm({ ...form, classe: e.target.value })}>
              <option value="">— Aucune —</option>
              <ClasseOptions classes={classes} avecPlacesDisponibles />
            </Select>
            {tarifInscription?.type_frais_nom && tarifInscription.montant !== null && (
              <p className="text-xs text-slate-500 mt-1.5">
                {tarifInscription.type_frais_nom} pour cette classe : <span className="font-semibold text-ink-900">{money(tarifInscription.montant)}</span>
                {" "}— à créer dans Paiements une fois l'élève inscrit.
              </p>
            )}
          </div>
          <Select label="Genre" value={form.sexe} onChange={(e) => setForm({ ...form, sexe: e.target.value })}>
            <option value="">— Non précisé —</option>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
          </Select>
          <Input label="Téléphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Date de naissance" type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
          <Input label="Lieu de naissance" value={form.lieu_naissance} onChange={(e) => setForm({ ...form, lieu_naissance: e.target.value })} />
          <Input label="Adresse" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />

          <div className="sm:col-span-2 border-t border-slate-100 pt-4 mt-1">
            <p className="text-sm font-bold text-ink-900 mb-1">Parent / Tuteur (compte de connexion)</p>
            <p className="text-xs text-slate-400 mb-3">
              Permet au parent de se connecter pour suivre les notes, présences et paiements de l'élève.
            </p>
          </div>
          <Select
            label="Compte parent"
            className="sm:col-span-2"
            value={form.parentMode}
            onChange={(e) => setForm({ ...form, parentMode: e.target.value as ParentMode })}
          >
            <option value="aucun">Aucun compte parent associé</option>
            <option value="existant">Associer un parent déjà inscrit</option>
            <option value="nouveau">Créer un nouveau compte parent</option>
          </Select>
          {form.parentMode === "existant" && (
            <Select
              label="Parent"
              className="sm:col-span-2"
              value={form.parent}
              onChange={(e) => setForm({ ...form, parent: e.target.value })}
            >
              <option value="">— Choisir un parent —</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
            </Select>
          )}
          {form.parentMode === "nouveau" && (
            <>
              <Input
                label="Identifiant de connexion"
                required
                value={form.parent_username}
                onChange={(e) => setForm({ ...form, parent_username: e.target.value })}
              />
              <Input
                label="Mot de passe"
                value={form.parent_password}
                onChange={(e) => setForm({ ...form, parent_password: e.target.value })}
              />
              <Input
                label="Prénom du parent"
                required
                value={form.parent_first_name}
                onChange={(e) => setForm({ ...form, parent_first_name: e.target.value })}
              />
              <Input
                label="Nom du parent"
                required
                value={form.parent_last_name}
                onChange={(e) => setForm({ ...form, parent_last_name: e.target.value })}
              />
              <Input
                label="Téléphone du parent"
                value={form.parent_phone}
                onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
              />
              <Input
                label="Email du parent"
                type="email"
                value={form.parent_email}
                onChange={(e) => setForm({ ...form, parent_email: e.target.value })}
              />
            </>
          )}

          <div className="sm:col-span-2 border-t border-slate-100 pt-4 mt-1">
            <p className="text-sm font-bold text-ink-900 mb-3">Filiation (pour la fiche d'inscription)</p>
          </div>
          <Input label="Nom du père" value={form.nom_pere} onChange={(e) => setForm({ ...form, nom_pere: e.target.value })} />
          <Input label="Nom de la mère" value={form.nom_mere} onChange={(e) => setForm({ ...form, nom_mere: e.target.value })} />
          <Input label="Nom du tuteur(rice)" value={form.nom_tuteur} onChange={(e) => setForm({ ...form, nom_tuteur: e.target.value })} className="sm:col-span-2" />

          <div className="sm:col-span-2 border-t border-slate-100 pt-4 mt-1">
            <p className="text-sm font-bold text-ink-900 mb-3">Inscription</p>
          </div>
          <Select label="Régime" value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value })}>
            <option value="externe">Externe</option>
            <option value="demi_pension">Demi-pension</option>
            <option value="interne">Interne</option>
          </Select>
          <Select label="Statut" value={form.statut_inscription} onChange={(e) => setForm({ ...form, statut_inscription: e.target.value })}>
            <option value="nouveau">Nouvelle inscription</option>
            <option value="reinscription">Réinscription</option>
            <option value="transfert">Transfert</option>
          </Select>
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

      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title="Importer des élèves depuis Excel">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Remplissez le modèle (une ligne par élève), puis importez-le ici. Chaque ligne est traitée indépendamment :
            les lignes valides créent l'élève (matricule généré automatiquement si absent, identifiants envoyés par
            email/SMS), les lignes en erreur sont listées ci-dessous pour correction.
          </p>

          <Button variant="secondary" onClick={() => elevesApi.importExcelModele("modele_import_eleves.xlsx")}>
            ⬇️ Télécharger le modèle Excel
          </Button>

          <label className="block">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Fichier rempli (.xlsx)</span>
            <input
              type="file" accept=".xlsx" onChange={handleImportFile} disabled={importing}
              className="text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
            />
          </label>

          {importing && <div className="flex justify-center py-4"><Spinner /></div>}

          {importError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{importError}</p>}

          {importRapport && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink-900">
                {importRapport.crees} élève{importRapport.crees > 1 ? "s" : ""} importé{importRapport.crees > 1 ? "s" : ""} sur {importRapport.total_lignes} ligne{importRapport.total_lignes > 1 ? "s" : ""}.
              </p>
              {importRapport.erreurs.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-rose-100 bg-rose-50 divide-y divide-rose-100">
                  {importRapport.erreurs.map((err, i) => (
                    <p key={i} className="px-3.5 py-2 text-xs text-rose-700">
                      <strong>Ligne {err.ligne}</strong> — {err.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => setImportModalOpen(false)}>Fermer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
