import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { classesApi, elevesApi, typesFraisApi, unwrapList, usersApi, type DoublonImportEleve } from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { Badge, Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, StatCard, Table } from "../components/ui";
import { ClasseOptions, CycleSelect } from "../components/CycleSelect";
import { StatutMensualiteBadge } from "../components/StatutMensualite";
import { useAuth } from "../context/AuthContext";
import { useConfirm, usePrompt } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import type { Classe, Cycle, EleveProfile, User } from "../types";
import { photoTropLourde, TAILLE_MAX_PHOTO_MO } from "../validation";

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
  const estComptabilite = user?.role === "comptabilite";
  // Enregistrer/modifier un élève : admin et comptabilité (backend
  // IsAdminOrComptabiliteReadWriteNoDelete) — la suppression et l'export/import en masse restent
  // admin uniquement, voir plus bas.
  const peutModifier = isAdmin || estComptabilite;
  // Bascule Actif/Inactif (voir handleToggleActif) : mêmes droits que la réinscription
  // (backend IsAdminOrComptabilite sur marquer-non-reinscrit/reactiver, voir ReinscriptionPage).
  const peutGererStatut = isAdmin || estComptabilite;
  const confirmer = useConfirm();
  const demander = usePrompt();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [classeFilter, setClasseFilter] = useState("");
  const [cycleFilter, setCycleFilter] = useState<Cycle | "">("");
  // "" = tous, "inactif" = partis/transférés (voir EleveProfile.actif, avec leur motif de
  // départ), "reinscription"/"transfert" = filtrent sur EleveProfile.statut_inscription.
  const [statutFilter, setStatutFilter] = useState<"" | "inactif" | "reinscription" | "transfert">("");
  const [classes, setClasses] = useState<Classe[]>([]);
  const [parents, setParents] = useState<User[]>([]);
  // Recherche pour la liste déroulante "Associer un parent existant", envoyée à l'API (paramètre
  // `search` : nom, prénom, identifiant, e-mail, téléphone) pour trouver aussi les parents au-delà
  // de la liste chargée d'office, quel que soit l'ordre des mots tapés ("Diallo Moussa").
  const [parentSearch, setParentSearch] = useState("");
  // null = pas de recherche en cours, on affiche `parents`.
  const [parentResults, setParentResults] = useState<User[] | null>(null);
  const [parentSearching, setParentSearching] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EleveProfile | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Cycle choisi dans le formulaire : sert uniquement à filtrer la liste des classes.
  const [cycleForm, setCycleForm] = useState<Cycle | "">("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importRapport, setImportRapport] = useState<{ crees: number; total_lignes: number; erreurs: { ligne: number; message: string }[]; ignores: DoublonImportEleve[] } | null>(null);
  // Fichier analysé contenant des élèves déjà inscrits : en attente du choix de l'admin
  // (ignorer ces doublons et importer les autres, ou annuler) — voir handleImportFile.
  const [importEnAttente, setImportEnAttente] = useState<{ fichier: File; a_importer: number; doublons: DoublonImportEleve[] } | null>(null);
  const [importError, setImportError] = useState("");
  // Lignes déjà traitées / total pendant un import par lots (voir handleImportFile).
  const [importProgression, setImportProgression] = useState<{ traitees: number; total: number } | null>(null);
  // Frais d'inscription (ou de réinscription si le statut choisi est « Réinscription ») réglé
  // pour la classe choisie (voir TypeFrais.usage + TarifClasse) — le frais correspondant est
  // initié automatiquement à l'enregistrement de l'élève (voir synchroniser_frais_inscription).
  const [tarifInscription, setTarifInscription] = useState<{ type_frais_nom: string | null; montant: string | null } | null>(null);

  const { items, count, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<EleveProfile>(
    () => elevesApi.list({
      search: search || undefined, classe: classeFilter || undefined, cycle: cycleFilter || undefined,
      actif: statutFilter === "inactif" ? false : undefined,
      statut_inscription: statutFilter === "reinscription" || statutFilter === "transfert" ? statutFilter : undefined,
    }),
    [search, classeFilter, cycleFilter, statutFilter]
  );

  // Répartition rapide (actifs/inactifs/nouveaux/réinscrits) sur l'ensemble des élèves
  // correspondant aux filtres actuels — pas seulement la page affichée (`items`), d'où des appels
  // séparés en `page_size: 1` (seul `count` nous intéresse, pas les résultats eux-mêmes).
  const [stats, setStats] = useState<{ actifs: number; inactifs: number; reinscrits: number } | null>(null);
  useEffect(() => {
    const base = { search: search || undefined, classe: classeFilter || undefined, cycle: cycleFilter || undefined, page_size: 1 };
    const getCount = (data: { count?: number } | unknown[]) => Array.isArray(data) ? data.length : (data.count ?? 0);
    Promise.all([
      elevesApi.list({ ...base, actif: true }),
      elevesApi.list({ ...base, actif: false }),
      elevesApi.list({ ...base, statut_inscription: "reinscription" }),
    ]).then(([actifsRes, inactifsRes, reinscritsRes]) => {
      setStats({ actifs: getCount(actifsRes.data), inactifs: getCount(inactifsRes.data), reinscrits: getCount(reinscritsRes.data) });
    }).catch(() => setStats(null));
  }, [search, classeFilter, cycleFilter]);

  useEffect(() => {
    classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
    if (peutModifier) {
      // Sans ce catch, un échec (droits insuffisants, réseau...) laissait la liste "Parent"
      // vide sans aucune indication — voir IsAdminOrComptabiliteReadOnly côté backend pour le
      // cas qui a révélé ce silence (comptabilité sans accès à /auth/users/ jusqu'ici).
      usersApi.list({ role: "parent", page_size: 500 }).then(({ data }) => setParents(unwrapList(data)))
        .catch((err) => toast.error(extractErrorMessage(err)));
    }
  }, [peutModifier]);

  useEffect(() => {
    const terme = parentSearch.trim();
    if (!terme) {
      setParentResults(null);
      setParentSearching(false);
      return;
    }
    let annule = false;
    setParentSearching(true);
    const timer = setTimeout(() => {
      usersApi.list({ role: "parent", search: terme, page_size: 100 })
        .then(({ data }) => {
          if (annule) return;
          const resultats = unwrapList(data);
          setParentResults(resultats);
          // Un seul parent trouvé : on le sélectionne directement.
          if (resultats.length === 1) setForm((f) => ({ ...f, parent: String(resultats[0].id) }));
        })
        .catch((err) => { if (!annule) toast.error(extractErrorMessage(err)); })
        .finally(() => { if (!annule) setParentSearching(false); });
    }, 300);
    return () => { annule = true; clearTimeout(timer); };
  }, [parentSearch]);

  useEffect(() => {
    // Uniquement pour une nouvelle inscription — un élève déjà inscrit n'a pas à réafficher ce
    // montant (déjà facturé ou non, ce n'est plus la question au moment d'une simple modification).
    if (!form.classe || editing) {
      setTarifInscription(null);
      return;
    }
    const usage = form.statut_inscription === "reinscription" ? "reinscription" : "inscription";
    typesFraisApi.tarifParUsage(usage, Number(form.classe))
      .then(({ data }) => setTarifInscription(data))
      .catch(() => setTarifInscription(null));
  }, [form.classe, form.statut_inscription, editing]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setCycleForm("");
    setPhotoFile(null);
    setPhotoPreview(null);
    setError("");
    setParentSearch("");
    setModalOpen(true);
  };

  const openEdit = (eleve: EleveProfile) => {
    setEditing(eleve);
    setCycleForm("");
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
    setParentSearch("");
    setModalOpen(true);
  };

  // Revenu depuis la fiche détail d'un élève avec l'intention de le modifier (StudentDetailPage → "✏️ Modifier").
  useEffect(() => {
    const editEleveId = (location.state as { editEleveId?: number } | null)?.editEleveId;
    if (!editEleveId || !peutModifier) return;
    elevesApi.get(editEleveId).then(({ data }) => openEdit(data));
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, peutModifier]);

  const handlePhotoChange = (file: File | null) => {
    if (file && photoTropLourde(file)) file = null;
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
        // Pas de téléchargement automatique du reçu d'inscription : il reste disponible à la
        // demande (bouton « 🧾 Reçu » de la liste).
        await elevesApi.create(payload);
      }
      if (form.parentMode === "nouveau") {
        // Le parent tout juste créé doit apparaître dans le sélecteur "parent existant" dès la
        // prochaine ouverture du formulaire (ex: un autre enfant de la même famille).
        usersApi.list({ role: "parent", page_size: 500 }).then(({ data }) => setParents(unwrapList(data)));
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
    if (!(await confirmer(`Supprimer définitivement ${eleve.user.first_name} ${eleve.user.last_name} ?`, { danger: true }))) return;
    await elevesApi.remove(eleve.id);
    reload();
  };

  // Sélection par cases à cocher pour la suppression groupée (admin) — limitée à la page
  // affichée et vidée dès que la liste change (page, filtre, recherche), pour ne jamais
  // supprimer un élève coché qui n'est plus visible à l'écran.
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  useEffect(() => setSelection(new Set()), [items]);
  const toutCoche = items.length > 0 && items.every((e) => selection.has(e.id));
  const basculerSelection = (id: number) => {
    setSelection((prev) => {
      const suivante = new Set(prev);
      if (suivante.has(id)) suivante.delete(id); else suivante.add(id);
      return suivante;
    });
  };
  const basculerTout = () => setSelection(toutCoche ? new Set() : new Set(items.map((e) => e.id)));

  const handleDeleteSelection = async () => {
    const n = selection.size;
    if (!n) return;
    if (!(await confirmer(`Supprimer définitivement ${n} élève${n > 1 ? "s" : ""} sélectionné${n > 1 ? "s" : ""} ? Leurs comptes, notes, paiements et historiques seront supprimés.`, { danger: true }))) return;
    setSuppressionEnCours(true);
    try {
      const { data } = await elevesApi.removeMany([...selection]);
      toast.success(`${data.supprimes} élève${data.supprimes > 1 ? "s" : ""} supprimé${data.supprimes > 1 ? "s" : ""}.`);
      reload();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSuppressionEnCours(false);
    }
  };

  const handleToggleActif = async (eleve: EleveProfile) => {
    if (eleve.actif) {
      const motif = await demander(`Vous pouvez préciser le motif du départ de ${eleve.user.first_name} ${eleve.user.last_name}.`, {
        title: "Rendre l'élève inactif", label: "Motif (optionnel)", confirmLabel: "Confirmer",
      });
      if (motif === null) return; // annulé
      await elevesApi.marquerNonReinscrit(eleve.id, motif);
    } else {
      if (!(await confirmer(`Réactiver ${eleve.user.first_name} ${eleve.user.last_name} ?`))) return;
      await elevesApi.reactiver(eleve.id);
    }
    reload();
  };

  const handleRecu = async (eleve: EleveProfile) => {
    try {
      await elevesApi.recuInscription(eleve.id, `recu_inscription_${eleve.matricule}.pdf`);
    } catch (err) {
      // Sans ce catch, un échec restait invisible (bouton "mort") — voir le même correctif
      // sur les fiches de paiement/badges.
      toast.error(await extractBlobErrorMessage(err));
    }
  };

  const handleCertificat = async (eleve: EleveProfile) => {
    try {
      await elevesApi.certificatScolarite(eleve.id, `certificat_scolarite_${eleve.matricule}.pdf`);
    } catch (err) {
      toast.error(await extractBlobErrorMessage(err));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await elevesApi.exportCsv({ search: search || undefined, classe: classeFilter || undefined });
    } catch (err) {
      toast.error(await extractBlobErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await elevesApi.exportPdf({ search: search || undefined, classe: classeFilter || undefined });
    } catch (err) {
      // Sans ce catch, un échec restait invisible (bouton "mort") — voir le même correctif
      // sur les fiches de paiement/badges.
      toast.error(await extractBlobErrorMessage(err));
    } finally {
      setExportingPdf(false);
    }
  };

  // 1re étape : analyse du fichier (rien n'est créé). Sans doublon, l'import démarre aussitôt ;
  // sinon l'admin voit la liste des élèves déjà inscrits et choisit de les ignorer pour
  // importer les autres.
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    setImporting(true);
    setImportRapport(null);
    setImportError("");
    setImportEnAttente(null);
    try {
      const { data } = await elevesApi.analyserImportExcel(fichier);
      if (data.doublons.length > 0) {
        setImportEnAttente({ fichier, a_importer: data.a_importer, doublons: data.doublons });
        setImporting(false);
        return;
      }
    } catch (err) {
      setImportError(extractErrorMessage(err));
      setImporting(false);
      return;
    }
    await lancerImport(fichier);
  };

  const lancerImport = async (fichier: File) => {
    setImportEnAttente(null);
    setImporting(true);
    setImportRapport(null);
    setImportError("");
    setImportProgression(null);
    // Le serveur traite le fichier par lots d'environ 15 s (au-delà, nginx/gunicorn coupent la
    // requête) et renvoie `suivant` tant qu'il reste des lignes : on relance avec le même
    // fichier jusqu'à la fin, en cumulant le rapport. En cas d'échec en cours de route, le
    // rapport partiel reste affiché — les élèves déjà créés le sont bel et bien.
    const rapport = { crees: 0, total_lignes: 0, erreurs: [] as { ligne: number; message: string }[], ignores: [] as DoublonImportEleve[] };
    let debut: number | null = 0;
    try {
      while (debut !== null) {
        const { data } = await elevesApi.importExcel(fichier, debut);
        rapport.crees += data.crees;
        rapport.total_lignes = data.total_lignes;
        rapport.erreurs.push(...data.erreurs);
        rapport.ignores.push(...(data.ignores ?? []));
        debut = data.suivant;
        setImportProgression({ traitees: debut ?? data.total_lignes, total: data.total_lignes });
        setImportRapport({ ...rapport, erreurs: [...rapport.erreurs], ignores: [...rapport.ignores] });
      }
    } catch (err) {
      setImportError(extractErrorMessage(err));
    } finally {
      setImporting(false);
      setImportProgression(null);
      if (rapport.crees > 0) reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Élèves"
        description="Gestion des inscriptions et des profils élèves."
        actions={peutModifier ? (
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <>
                <Button variant="secondary" onClick={handleExport} disabled={exporting}>{exporting ? "Export…" : "📤 Exporter CSV"}</Button>
                <Button variant="secondary" onClick={handleExportPdf} disabled={exportingPdf}>{exportingPdf ? "Export…" : "🖨️ Exporter PDF"}</Button>
                <Button variant="secondary" onClick={() => { setImportRapport(null); setImportError(""); setImportEnAttente(null); setImportModalOpen(true); }}>📥 Importer Excel</Button>
              </>
            )}
            <Button onClick={openCreate}>+ Nouvel élève</Button>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <button className="text-left" onClick={() => setStatutFilter("")}>
          <StatCard label="Élèves" value={count !== null ? String(count) : "…"} icon="🎓" accent="brand" />
        </button>
        <button className="text-left" onClick={() => setStatutFilter("")}>
          <StatCard label="Actifs" value={stats ? String(stats.actifs) : "…"} icon="✅" accent="green" />
        </button>
        <button className="text-left" onClick={() => setStatutFilter("reinscription")}>
          <StatCard label="Réinscrits" value={stats ? String(stats.reinscrits) : "…"} icon="🔁" accent="teal" />
        </button>
        <button className="text-left" onClick={() => setStatutFilter("inactif")}>
          <StatCard label="Partis / transférés" value={stats ? String(stats.inactifs) : "…"} icon="🚪" accent="rose" />
        </button>
      </div>

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
        <Select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value as typeof statutFilter)} className="max-w-xs">
          <option value="">Tous les statuts</option>
          <option value="inactif">Partis / transférés (inactifs)</option>
          <option value="reinscription">Réinscrits</option>
          <option value="transfert">Arrivés par transfert</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun élève trouvé" />
      ) : (
        <>
          {isAdmin && selection.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5">
              <span className="text-sm font-semibold text-rose-700">
                {selection.size} élève{selection.size > 1 ? "s" : ""} sélectionné{selection.size > 1 ? "s" : ""}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setSelection(new Set())}>Désélectionner</Button>
                <Button variant="danger" onClick={handleDeleteSelection} disabled={suppressionEnCours}>
                  {suppressionEnCours ? "Suppression…" : "🗑️ Supprimer la sélection"}
                </Button>
              </div>
            </div>
          )}
          <Table headers={[
            ...(isAdmin ? [
              <input
                type="checkbox" checked={toutCoche} onChange={basculerTout} aria-label="Tout sélectionner"
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              />,
            ] : []),
            ...(statutFilter === "inactif"
              ? ["Matricule", "Nom complet", "Classe", "Statut", "Motif / Date de départ", "Contact", "Actions"]
              : ["Matricule", "Nom complet", "Classe", "Statut", "Parent", "Contact", "Actions"]),
          ]}>
            {items.map((eleve) => (
              <tr key={eleve.id} className={`${eleve.actif ? "" : "opacity-60"} ${selection.has(eleve.id) ? "bg-rose-50/60" : ""}`}>
                {isAdmin && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox" checked={selection.has(eleve.id)} onChange={() => basculerSelection(eleve.id)}
                      aria-label={`Sélectionner ${eleve.user.first_name} ${eleve.user.last_name}`}
                      className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                    />
                  </td>
                )}
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
                    <span className="flex flex-col items-start">
                      <span>
                        {eleve.user.first_name} {eleve.user.last_name}
                        {eleve.user.sexe && <span className="ml-1.5 text-xs text-slate-400">{eleve.user.sexe === "F" ? "♀" : "♂"}</span>}
                      </span>
                      <StatutMensualiteBadge categorie={eleve.categorie_paiement} exonereFratrie={eleve.exonere_fratrie} />
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3">{eleve.classe_nom || <span className="text-slate-400">Non assignée</span>}</td>
                <td className="px-4 py-3">
                  {!eleve.actif ? (
                    <Badge color="rose">Inactif</Badge>
                  ) : eleve.statut_inscription === "reinscription" ? (
                    <Badge color="teal">Réinscrit</Badge>
                  ) : eleve.statut_inscription === "transfert" ? (
                    <Badge color="amber">Transfert</Badge>
                  ) : (
                    <Badge color="brand">Nouveau</Badge>
                  )}
                </td>
                {statutFilter === "inactif" ? (
                  <td className="px-4 py-3 text-slate-500">
                    {eleve.motif_sortie || <span className="text-slate-400">—</span>}
                    {eleve.date_sortie && <span className="block text-xs text-slate-400">{new Date(eleve.date_sortie).toLocaleDateString("fr-FR")}</span>}
                  </td>
                ) : (
                  <td className="px-4 py-3">{eleve.parent_nom || <span className="text-slate-400">—</span>}</td>
                )}
                <td className="px-4 py-3 text-slate-500">{eleve.user.email || eleve.user.phone || "—"}</td>
                <td className="px-4 py-3">
                  <RowActions>
                    <Link to={`/eleves/${eleve.id}`} className="text-xs font-semibold text-brand-700 hover:underline">
                      👁️ Fiche
                    </Link>
                    <button
                      className="text-xs font-semibold text-brand-700 hover:underline"
                      onClick={() => handleRecu(eleve)}
                    >
                      🧾 Reçu
                    </button>
                    <button
                      className="text-xs font-semibold text-brand-700 hover:underline"
                      onClick={() => handleCertificat(eleve)}
                    >
                      🎓 Attestation
                    </button>
                    {peutGererStatut && (
                      <button
                        className={`text-xs font-semibold hover:underline ${eleve.actif ? "text-rose-600" : "text-emerald-600"}`}
                        onClick={() => handleToggleActif(eleve)}
                      >
                        {eleve.actif ? "🚪 Rendre inactif" : "✅ Réactiver"}
                      </button>
                    )}
                    {peutModifier && <EditButton onClick={() => openEdit(eleve)} />}
                    {isAdmin && <DeleteButton onClick={() => handleDelete(eleve)} />}
                  </RowActions>
                </td>
              </tr>
            ))}
          </Table>
          <div className="flex justify-between items-center mt-4 text-sm text-slate-500">
            <span>Total : {count ?? items.length}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!hasPrevious} onClick={goPrevious}>← Précédent</Button>
              <Button variant="secondary" disabled={!hasNext} onClick={goNext}>Suivant →</Button>
            </div>
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier l'élève" : "Nouvel élève"} wide>
        <form noValidate onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 flex items-center gap-4">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-brand-100 shrink-0" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg shrink-0">
                {(form.first_name[0] || "?").toUpperCase()}
              </div>
            )}
            <label className="block">
              <span className="block text-sm font-semibold text-slate-600 mb-1.5">Photo (optionnel, {TAILLE_MAX_PHOTO_MO} Mo max)</span>
              <input
                type="file" accept="image/*"
                onChange={(e) => {
                  const fichier = e.target.files?.[0] || null;
                  // Photo refusée (trop lourde) : on vide le champ pour qu'il n'affiche pas son nom.
                  if (fichier && fichier.size > TAILLE_MAX_PHOTO_MO * 1024 * 1024) e.target.value = "";
                  handlePhotoChange(fichier);
                }}
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
            <div className="mb-3">
            <CycleSelect
              label="Cycle"
              value={cycleForm}
              onChange={(cycle) => {
                setCycleForm(cycle);
                // La classe déjà choisie est retirée si elle n'appartient pas au nouveau cycle.
                const classe = classes.find((c) => String(c.id) === String(form.classe));
                if (cycle && classe && classe.cycle !== cycle) setForm({ ...form, classe: "" });
              }}
            />
            </div>
            <Select label="Classe" value={form.classe} onChange={(e) => setForm({ ...form, classe: e.target.value })}>
              <option value="">— Aucune —</option>
              <ClasseOptions classes={classes.filter((c) => !cycleForm || c.cycle === cycleForm)} avecPlacesDisponibles />
            </Select>
            {tarifInscription?.type_frais_nom && tarifInscription.montant !== null && (
              <p className="text-xs text-slate-500 mt-1.5">
                {tarifInscription.type_frais_nom} pour cette classe : <span className="font-semibold text-ink-900">{money(tarifInscription.montant)}</span>
                {" "}— initié automatiquement dans ses paiements à l'enregistrement.
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
            <>
              <Input
                label="Rechercher un parent"
                className="sm:col-span-2"
                placeholder="Nom, identifiant, téléphone…"
                value={parentSearch}
                onChange={(e) => setParentSearch(e.target.value)}
              />
              <Select
                label="Parent"
                className="sm:col-span-2"
                value={form.parent}
                onChange={(e) => setForm({ ...form, parent: e.target.value })}
              >
                <option value="">
                  {parentSearching ? "Recherche en cours…"
                    : parentResults?.length === 0 ? "— Aucun parent trouvé —"
                    : parentResults ? `— ${parentResults.length} parent(s) trouvé(s) —`
                    : "— Choisir un parent —"}
                </option>
                {(() => {
                  const liste = parentResults ?? parents;
                  // Le parent déjà choisi reste affiché même s'il ne correspond plus à la recherche,
                  // sinon le <select> paraîtrait vide alors qu'un parent est bien associé.
                  const choisi = form.parent && !liste.some((p) => String(p.id) === form.parent)
                    ? [...parents, ...(parentResults ?? [])].find((p) => String(p.id) === form.parent)
                    : undefined;
                  return (choisi ? [choisi, ...liste] : liste)
                    .map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username}{p.phone ? ` — ${p.phone}` : ""}</option>);
                })()}
              </Select>
            </>
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
            email/SMS), les lignes en erreur sont listées ci-dessous pour correction. Un élève déjà inscrit avec les mêmes
            nom, prénom, filiation (père et mère) et contact (téléphone et e-mail) est signalé comme doublon et n'est pas réimporté.
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

          {importing && (
            <div className="space-y-2 py-2">
              <div className="flex justify-center"><Spinner /></div>
              {importProgression && (
                <>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-brand-500 transition-all"
                      style={{ width: `${Math.round((importProgression.traitees / Math.max(importProgression.total, 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-center text-slate-500">
                    {importProgression.traitees} / {importProgression.total} lignes traitées — gardez cette fenêtre ouverte jusqu'à la fin.
                  </p>
                </>
              )}
            </div>
          )}

          {importError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{importError}</p>}

          {importEnAttente && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <p className="text-sm font-semibold text-amber-800">
                {importEnAttente.doublons.length} élève{importEnAttente.doublons.length > 1 ? "s" : ""} de ce fichier {importEnAttente.doublons.length > 1 ? "sont" : "est"} déjà inscrit{importEnAttente.doublons.length > 1 ? "s" : ""} (même nom, prénom, filiation et contact).
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-amber-100 bg-white divide-y divide-amber-50">
                {importEnAttente.doublons.map((d) => (
                  <p key={d.ligne} className="px-3 py-1.5 text-xs text-slate-600">
                    <strong>Ligne {d.ligne}</strong> — {d.nom} <span className="text-slate-400">({d.matricule})</span>
                  </p>
                ))}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setImportEnAttente(null)}>Annuler</Button>
                <Button onClick={() => lancerImport(importEnAttente.fichier)} disabled={importEnAttente.a_importer === 0}>
                  {importEnAttente.a_importer === 0
                    ? "Aucun nouvel élève à importer"
                    : `Ignorer les déjà inscrits et importer les ${importEnAttente.a_importer} autre${importEnAttente.a_importer > 1 ? "s" : ""}`}
                </Button>
              </div>
            </div>
          )}

          {importRapport && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink-900">
                {importRapport.crees} élève{importRapport.crees > 1 ? "s" : ""} importé{importRapport.crees > 1 ? "s" : ""} sur {importRapport.total_lignes} ligne{importRapport.total_lignes > 1 ? "s" : ""}
                {importRapport.ignores.length > 0 && <> — {importRapport.ignores.length} déjà inscrit{importRapport.ignores.length > 1 ? "s" : ""} ignoré{importRapport.ignores.length > 1 ? "s" : ""}</>}.
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
