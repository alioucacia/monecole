import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { anneesApi, classesApi, elevesApi, fraisApi, paiementsApi, periodesApi, typesFraisApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner, StatCard, Table } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import type { AnneeScolaire, Classe, Cycle, EleveProfile, Frais, Periode, PeriodiciteFrais, TypeFrais } from "../types";

const STATUT_LABELS: Record<string, { label: string; color: "green" | "amber" | "rose" }> = {
  paye: { label: "Payé", color: "green" },
  partiel: { label: "Partiel", color: "amber" },
  impaye: { label: "Impayé", color: "rose" },
};

const MODE_PAIEMENT_LABELS: Record<string, string> = {
  especes: "Espèces",
  cheque: "Chèque",
  virement: "Virement",
  mobile_money: "Mobile Money",
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

const emptyFraisForm = { eleve: "", type_frais: "", annee_scolaire: "", montant: "", date_echeance: "", mois_echeance: "", trimestre_echeance: "" };

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/** Calcule la date d'échéance (1er du mois choisi) à partir du mois ("01".."12") et de l'année
 * scolaire sélectionnée — une année scolaire chevauche deux années calendaires (ex: sept. 2025 à
 * juin 2026), donc le mois seul ne suffit pas à déterminer l'année : on la déduit de celle de
 * l'année scolaire (avant le mois de rentrée → année de fin, sinon → année de début). */
function echeanceDuMois(annee: AnneeScolaire, mois: string): string {
  const moisDebut = Number(annee.date_debut.slice(5, 7));
  const anneeDebut = Number(annee.date_debut.slice(0, 4));
  const anneeCalendaire = Number(mois) >= moisDebut ? anneeDebut : anneeDebut + 1;
  return `${anneeCalendaire}-${mois}-01`;
}
const emptyPaiementForm = { montant: "", mode_paiement: "especes", reference: "", mois: "", periode: "" };
const emptyTypeForm = { nom: "", montant_standard: "", periodicite: "autre" as PeriodiciteFrais };

const PERIODICITE_LABELS: Record<PeriodiciteFrais, string> = {
  mensuel: "Mensuel", trimestriel: "Tranche", annuel: "Annuel", autre: "Autre / ponctuel",
};

const ORDINAUX = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];

/** "2026-09" (valeur d'un <input type="month">) → "2026-09-01" attendu par l'API. */
function moisInputVersDate(moisInput: string) {
  return moisInput ? `${moisInput}-01` : "";
}

/** Liste des mois ("2025-09", "2025-10"...) entre le début et la fin d'une année scolaire, pour
 * peupler la liste déroulante de choix du mois payé — au lieu de laisser un <input type="month">
 * libre où l'on pouvait taper n'importe quel mois, y compris hors année scolaire. */
function moisDeLAnnee(annee: AnneeScolaire): string[] {
  const mois: string[] = [];
  let courant = new Date(annee.date_debut);
  courant = new Date(courant.getFullYear(), courant.getMonth(), 1);
  const fin = new Date(annee.date_fin);
  while (courant <= fin) {
    mois.push(`${courant.getFullYear()}-${String(courant.getMonth() + 1).padStart(2, "0")}`);
    courant = new Date(courant.getFullYear(), courant.getMonth() + 1, 1);
  }
  return mois;
}

function moisLabelLong(mois: string) {
  const [annee, m] = mois.split("-");
  return new Date(Number(annee), Number(m) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/** Statut d'un mois donné pour un frais mensuel : déjà intégralement payé (ne peut plus recevoir
 * de paiement — voir PaiementSerializer.validate côté backend), partiellement payé, ou libre. */
function statutMoisPourFrais(frais: Frais, mois: string): "paye" | "partiel" | "libre" {
  const paye = frais.paiements
    .filter((p) => p.mois && p.mois.startsWith(mois))
    .reduce((sum, p) => sum + Number(p.montant), 0);
  if (paye <= 0) return "libre";
  return paye >= Number(frais.montant_du) ? "paye" : "partiel";
}

/** Même logique que `statutMoisPourFrais`, pour une tranche (frais de périodicité Tranche) —
 * `frais.montant_du` représente le montant D'UNE tranche, comme pour un mois. */
function statutPeriodePourFrais(frais: Frais, periodeId: number): "paye" | "partiel" | "libre" {
  const paye = frais.paiements
    .filter((p) => p.periode === periodeId)
    .reduce((sum, p) => sum + Number(p.montant), 0);
  if (paye <= 0) return "libre";
  return paye >= Number(frais.montant_du) ? "paye" : "partiel";
}

export default function PaymentsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const peutGerer = user?.role === "admin" || user?.role === "comptabilite";

  const [types, setTypes] = useState<TypeFrais[]>([]);
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [classes, setClasses] = useState<Classe[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const [search, setSearch] = useState("");
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  const [classeFiltre, setClasseFiltre] = useState("");
  const classesDuCycle = cycleFiltre ? classes.filter((c) => c.cycle === cycleFiltre) : classes;

  const [fraisModalOpen, setFraisModalOpen] = useState(false);
  const [fraisForm, setFraisForm] = useState(emptyFraisForm);
  const [fraisError, setFraisError] = useState("");
  const [fraisSaving, setFraisSaving] = useState(false);
  // Trimestres (Periode) de l'année scolaire choisie dans "Nouveau frais" — ne sert que pour la
  // liste déroulante "Trimestre d'échéance" d'un type de frais Trimestriel (voir périodicité).
  const [periodesAnnee, setPeriodesAnnee] = useState<Periode[]>([]);

  // Tranches proposées dans la modale "Encaisser" pour un frais de périodicité Tranche —
  // rechargées à l'ouverture (voir openPaiementModal), distinctes de `periodesAnnee` ci-dessus
  // (celle-ci suit l'année scolaire du frais encaissé, pas celle du formulaire "Nouveau frais").
  const [periodesPaiement, setPeriodesPaiement] = useState<Periode[]>([]);
  const [paiementTarget, setPaiementTarget] = useState<Frais | null>(null);
  const [paiementForm, setPaiementForm] = useState(emptyPaiementForm);
  const [paiementError, setPaiementError] = useState("");
  const [paiementSaving, setPaiementSaving] = useState(false);

  const [historiqueTarget, setHistoriqueTarget] = useState<Frais | null>(null);
  const [paiementDeletingId, setPaiementDeletingId] = useState<number | null>(null);

  const [typesModalOpen, setTypesModalOpen] = useState(false);
  const [typeEditTarget, setTypeEditTarget] = useState<TypeFrais | null>(null);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [typeError, setTypeError] = useState("");
  const [typeSaving, setTypeSaving] = useState(false);

  const [fraisDeletingId, setFraisDeletingId] = useState<number | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportingFiches, setExportingFiches] = useState(false);
  const [fichePendingId, setFichePendingId] = useState<number | null>(null);
  const [proformaPendingId, setProformaPendingId] = useState<number | null>(null);
  const [notifying, setNotifying] = useState(false);

  const [searchDebounced, setSearchDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { items, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<Frais>(
    () => fraisApi.list({
      search: searchDebounced || undefined,
      eleve__classe: classeFiltre || undefined,
      eleve__classe__cycle: classeFiltre ? undefined : cycleFiltre || undefined,
    }),
    [searchDebounced, cycleFiltre, classeFiltre]
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      await fraisApi.exportCsv();
    } finally {
      setExporting(false);
    }
  };

  const handleExportFiches = async () => {
    setExportingFiches(true);
    try {
      await fraisApi.fichesPaiementPdf(undefined, "fiches_paiement.pdf");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setExportingFiches(false);
    }
  };

  const handleDownloadFiche = async (frais: Frais) => {
    setFichePendingId(frais.id);
    try {
      await fraisApi.fichePaiementPdf(frais.id, `fiche_paiement_${frais.eleve_nom.replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setFichePendingId(null);
    }
  };

  const handleDownloadProforma = async (frais: Frais) => {
    setProformaPendingId(frais.id);
    try {
      await fraisApi.proformaPdf(
        frais.eleve, `proforma_${frais.eleve_nom.replace(/\s+/g, "_")}.pdf`, frais.annee_scolaire
      );
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setProformaPendingId(null);
    }
  };

  const loadSummary = () => fraisApi.summary().then(({ data }) => setSummary(data));
  const loadTypes = () => typesFraisApi.list().then(({ data }) => setTypes(unwrapList(data)));

  const handleNotifierImpayes = async () => {
    setNotifying(true);
    try {
      const { data } = await fraisApi.notifierImpayes();
      toast.success(`${data.notifies} famille(s) notifiée(s) par email/SMS.`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setNotifying(false);
    }
  };

  useEffect(() => {
    loadTypes();
    if (peutGerer) {
      anneesApi.list().then(({ data }) => setAnnees(unwrapList(data)));
      elevesApi.list({ page_size: 500 }).then(({ data }) => setEleves(unwrapList(data)));
      classesApi.list({ page_size: 200 }).then(({ data }) => setClasses(unwrapList(data)));
      loadSummary();
    }
  }, [peutGerer]);

  // Si le cycle change, la classe sélectionnée peut ne plus lui appartenir — on la réinitialise
  // plutôt que de garder un filtre incohérent (ex: "4ème A" sélectionnée alors qu'on filtre "Lycée").
  useEffect(() => {
    if (classeFiltre && !classesDuCycle.some((c) => c.id === Number(classeFiltre))) {
      setClasseFiltre("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleFiltre]);

  const openFraisModal = () => {
    setFraisForm({ ...emptyFraisForm, annee_scolaire: annees.find((a) => a.active)?.id.toString() || "" });
    setFraisError("");
    setFraisModalOpen(true);
  };

  // Trimestres proposés par "Trimestre d'échéance" (type de frais Trimestriel) — dépendent de
  // l'année scolaire choisie dans le formulaire, rechargés à chaque changement.
  useEffect(() => {
    if (!fraisForm.annee_scolaire) { setPeriodesAnnee([]); return; }
    periodesApi.list({ annee_scolaire: fraisForm.annee_scolaire }).then(({ data }) => setPeriodesAnnee(unwrapList(data)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fraisForm.annee_scolaire]);

  const typeFraisSelectionne = types.find((t) => t.id === Number(fraisForm.type_frais));

  const handleFraisSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFraisSaving(true);
    setFraisError("");
    try {
      await fraisApi.create({
        eleve: Number(fraisForm.eleve), type_frais: Number(fraisForm.type_frais),
        annee_scolaire: Number(fraisForm.annee_scolaire), montant: fraisForm.montant, date_echeance: fraisForm.date_echeance,
      });
      setFraisModalOpen(false);
      reload();
      loadSummary();
    } catch (err) {
      setFraisError(extractErrorMessage(err));
    } finally {
      setFraisSaving(false);
    }
  };

  const handleDeleteFrais = async (frais: Frais) => {
    if (!confirm(`Supprimer le frais « ${frais.type_frais_nom} » de ${frais.eleve_nom} ? Cette action est irréversible.`)) return;
    setFraisDeletingId(frais.id);
    try {
      await fraisApi.remove(frais.id);
      reload();
      loadSummary();
      toast.success("Frais supprimé.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setFraisDeletingId(null);
    }
  };

  const openPaiementModal = (frais: Frais) => {
    setPaiementTarget(frais);
    setPaiementForm({ ...emptyPaiementForm, montant: frais.solde });
    setPaiementError("");
    if (frais.type_frais_periodicite === "trimestriel") {
      periodesApi.list({ annee_scolaire: frais.annee_scolaire }).then(({ data }) => setPeriodesPaiement(unwrapList(data)));
    }
  };

  const handlePaiementSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!paiementTarget) return;
    setPaiementSaving(true);
    setPaiementError("");
    try {
      const { mois, periode, ...reste } = paiementForm;
      await paiementsApi.create({
        frais: paiementTarget.id, ...reste,
        mois: paiementTarget.type_frais_est_mensuel ? moisInputVersDate(mois) || null : null,
        periode: paiementTarget.type_frais_periodicite === "trimestriel" ? Number(periode) || null : null,
      });
      setPaiementTarget(null);
      reload();
      loadSummary();
    } catch (err) {
      setPaiementError(extractErrorMessage(err));
    } finally {
      setPaiementSaving(false);
    }
  };

  const handleDeletePaiement = async (paiement: Frais["paiements"][number]) => {
    if (!confirm(`Supprimer ce paiement de ${money(paiement.montant)} ? Cette action est irréversible.`)) return;
    setPaiementDeletingId(paiement.id);
    try {
      await paiementsApi.remove(paiement.id);
      // Mise à jour optimiste de la modale ouverte (montant_paye/solde n'y sont pas recalculés
      // localement — reload()/loadSummary() rafraîchissent la liste et les totaux en arrière-plan).
      setHistoriqueTarget((prev) => prev && { ...prev, paiements: prev.paiements.filter((p) => p.id !== paiement.id) });
      reload();
      loadSummary();
      toast.success("Paiement supprimé.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPaiementDeletingId(null);
    }
  };

  const openTypesModal = () => {
    setTypeEditTarget(null);
    setTypeForm(emptyTypeForm);
    setTypeError("");
    setTypesModalOpen(true);
  };

  const openTypeEdit = (type: TypeFrais) => {
    setTypeEditTarget(type);
    setTypeForm({ nom: type.nom, montant_standard: type.montant_standard, periodicite: type.periodicite });
    setTypeError("");
  };

  const handleTypeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTypeSaving(true);
    setTypeError("");
    try {
      const payload = { nom: typeForm.nom, montant_standard: typeForm.montant_standard, periodicite: typeForm.periodicite };
      if (typeEditTarget) {
        await typesFraisApi.update(typeEditTarget.id, payload);
      } else {
        await typesFraisApi.create(payload);
      }
      setTypeEditTarget(null);
      setTypeForm(emptyTypeForm);
      loadTypes();
    } catch (err) {
      setTypeError(extractErrorMessage(err));
    } finally {
      setTypeSaving(false);
    }
  };

  const handleTypeDelete = async (type: TypeFrais) => {
    if (!confirm(`Supprimer le type de frais « ${type.nom} » ?`)) return;
    try {
      await typesFraisApi.remove(type.id);
      loadTypes();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Paiements"
        description={peutGerer ? "Suivi des frais scolaires et des paiements." : "Vos frais scolaires et paiements."}
        actions={peutGerer ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>{exporting ? "Export…" : "📤 Exporter CSV"}</Button>
            <Button variant="secondary" onClick={handleExportFiches} disabled={exportingFiches}>
              {exportingFiches ? "Génération…" : "🧾 Fiches de paiement"}
            </Button>
            <Button variant="secondary" onClick={handleNotifierImpayes} disabled={notifying}>
              {notifying ? "Envoi…" : "📣 Relancer les impayés"}
            </Button>
            <Link to="/paiements/impayes-par-classe">
              <Button variant="secondary">🏫 Situation par classe</Button>
            </Link>
            <Link to="/paiements/suivi-mensuel">
              <Button variant="secondary">📅 Suivi mensuel</Button>
            </Link>
            <Link to="/paiements/recherche-matricule">
              <Button variant="secondary">🔍 Recherche par matricule</Button>
            </Link>
            <Link to="/paiements/tarifs-classe">
              <Button variant="secondary">💰 Tarifs par classe</Button>
            </Link>
            <Button variant="secondary" onClick={openTypesModal}>⚙️ Types de frais</Button>
            <Button onClick={openFraisModal}>+ Nouveau frais</Button>
          </div>
        ) : undefined}
      />

      {peutGerer && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total attendu" value={money(summary.total_attendu as string)} icon="🏦" accent="brand" />
          <StatCard label="Total encaissé" value={money(summary.total_encaisse as string)} icon="💰" accent="green" />
          <StatCard label="Solde restant" value={money(summary.solde_total as string)} icon="📉" accent="rose" />
          <StatCard label="Taux de recouvrement" value={summary.taux_recouvrement !== null ? `${summary.taux_recouvrement}%` : "—"} icon="📊" accent="amber" />
        </div>
      )}

      {peutGerer && (
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <Input
            label="Rechercher un élève"
            placeholder="Nom, prénom ou matricule…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <CycleSelect
            label="Cycle"
            value={cycleFiltre}
            onChange={(c) => { setCycleFiltre(c); setClasseFiltre(""); }}
            className="max-w-[10rem]"
          />
          <Select label="Classe" value={classeFiltre} onChange={(e) => setClasseFiltre(e.target.value)} className="max-w-[10rem]">
            <option value="">Toutes les classes</option>
            {classesDuCycle.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </Select>
          {(search || cycleFiltre || classeFiltre) && (
            <button
              onClick={() => { setSearch(""); setCycleFiltre(""); setClasseFiltre(""); }}
              className="text-sm text-slate-400 hover:text-slate-600 hover:underline mb-2.5"
            >
              ✕ Réinitialiser
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucun frais trouvé"
          description={search || classeFiltre ? "Aucun résultat pour ces filtres." : "Aucun frais n'a encore été enregistré."}
        />
      ) : (
        <>
          <Table headers={["Élève", "Type", "Montant", "Payé", "Solde", "Échéance", "Statut", "Actions"]}>
            {items.map((f) => (
              <tr key={f.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{f.eleve_nom}</td>
                <td className="px-4 py-3">{f.type_frais_nom}</td>
                <td className="px-4 py-3">
                  {money(f.montant_du)}
                  {Number(f.montant_du) !== Number(f.montant) && (
                    <span className="block text-[10px] text-amber-600" title="Réduction appliquée (catégorie de paiement / fidélité)">
                      tarif {money(f.montant)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-green-600">{money(f.montant_paye)}</td>
                <td className="px-4 py-3 font-medium">{money(f.solde)}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(f.date_echeance).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3"><Badge color={STATUT_LABELS[f.statut].color}>{STATUT_LABELS[f.statut].label}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {peutGerer && Number(f.solde) > 0 && (
                      <button onClick={() => openPaiementModal(f)} className="text-brand-600 hover:underline text-sm">Encaisser</button>
                    )}
                    {peutGerer && f.paiements.length > 0 && (
                      <button onClick={() => setHistoriqueTarget(f)} className="text-brand-600 hover:underline text-sm">📜 Historique</button>
                    )}
                    {Number(f.montant_paye) > 0 && (
                      <button
                        onClick={() => handleDownloadFiche(f)}
                        disabled={fichePendingId === f.id}
                        className="text-brand-600 hover:underline text-sm disabled:opacity-50"
                      >
                        {fichePendingId === f.id ? "…" : "🧾 Fiche"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDownloadProforma(f)}
                      disabled={proformaPendingId === f.id}
                      className="text-brand-600 hover:underline text-sm disabled:opacity-50"
                    >
                      {proformaPendingId === f.id ? "…" : "📄 Proforma"}
                    </button>
                    {peutGerer && f.statut === "impaye" && (
                      <button
                        onClick={() => handleDeleteFrais(f)}
                        disabled={fraisDeletingId === f.id}
                        className="text-rose-600 hover:underline text-sm disabled:opacity-50"
                      >
                        {fraisDeletingId === f.id ? "…" : "Supprimer"}
                      </button>
                    )}
                  </div>
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

      <Modal open={fraisModalOpen} onClose={() => setFraisModalOpen(false)} title="Nouveau frais">
        <form onSubmit={handleFraisSubmit} className="space-y-4">
          <Select label="Élève" required value={fraisForm.eleve} onChange={(e) => setFraisForm({ ...fraisForm, eleve: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {eleves.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name} ({el.matricule})</option>)}
          </Select>
          <Select label="Type de frais" required value={fraisForm.type_frais} onChange={(e) => {
            const type = types.find((t) => t.id === Number(e.target.value));
            const annee = annees.find((a) => a.id === Number(fraisForm.annee_scolaire));
            setFraisForm({
              ...fraisForm, type_frais: e.target.value, montant: type ? type.montant_standard : fraisForm.montant,
              mois_echeance: "", trimestre_echeance: "",
              // Annuel : une seule échéance possible (fin d'année scolaire) — pas de liste à choisir.
              date_echeance: type?.periodicite === "annuel" && annee ? annee.date_fin : fraisForm.date_echeance,
            });
          }}>
            <option value="">— Sélectionner —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.nom} ({t.periodicite_display})</option>)}
          </Select>
          <Select label="Année scolaire" required value={fraisForm.annee_scolaire} onChange={(e) => {
            const annee = annees.find((a) => a.id === Number(e.target.value));
            setFraisForm({
              ...fraisForm, annee_scolaire: e.target.value, trimestre_echeance: "",
              date_echeance:
                annee && fraisForm.mois_echeance ? echeanceDuMois(annee, fraisForm.mois_echeance)
                : annee && typeFraisSelectionne?.periodicite === "annuel" ? annee.date_fin
                : fraisForm.date_echeance,
            });
          }}>
            <option value="">— Sélectionner —</option>
            {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </Select>
          <Input label="Montant (GNF)" type="number" min={0} required value={fraisForm.montant} onChange={(e) => setFraisForm({ ...fraisForm, montant: e.target.value })} />

          {/* Échéance : la liste déroulante proposée dépend de la périodicité du type de frais
              choisi ci-dessus — mois de l'année scolaire (Mensuel), trimestres configurés
              (Trimestriel), fin d'année scolaire déjà réglée automatiquement (Annuel), ou
              directement la date libre ci-dessous (Autre / aucun type choisi). */}
          {typeFraisSelectionne?.periodicite === "mensuel" && (
            <Select label="Mois d'échéance" required value={fraisForm.mois_echeance} onChange={(e) => {
              const annee = annees.find((a) => a.id === Number(fraisForm.annee_scolaire));
              setFraisForm({
                ...fraisForm, mois_echeance: e.target.value,
                date_echeance: annee && e.target.value ? echeanceDuMois(annee, e.target.value) : fraisForm.date_echeance,
              });
            }}>
              <option value="">— Choisir un mois —</option>
              {MOIS_NOMS.map((nom, i) => <option key={nom} value={String(i + 1).padStart(2, "0")}>{nom}</option>)}
            </Select>
          )}
          {typeFraisSelectionne?.periodicite === "trimestriel" && (
            <Select label="Tranche d'échéance" required value={fraisForm.trimestre_echeance} onChange={(e) => {
              const periode = periodesAnnee.find((p) => p.id === Number(e.target.value));
              setFraisForm({
                ...fraisForm, trimestre_echeance: e.target.value,
                date_echeance: periode ? periode.date_fin : fraisForm.date_echeance,
              });
            }}>
              <option value="">
                {periodesAnnee.length === 0 ? "— Aucune tranche configurée pour cette année —" : "— Choisir une tranche —"}
              </option>
              {periodesAnnee.map((p, i) => (
                <option key={p.id} value={p.id}>
                  {ORDINAUX[i] || `${i + 1}ème`} Tranche{fraisForm.montant ? ` — ${Number(fraisForm.montant).toLocaleString("fr-FR")} GNF` : ""}
                </option>
              ))}
            </Select>
          )}
          {typeFraisSelectionne?.periodicite === "annuel" && (
            <p className="text-xs text-slate-400 -mt-2">
              Échéance fixée à la fin de l'année scolaire sélectionnée — modifiable ci-dessous si besoin.
            </p>
          )}
          <Input
            label="Date d'échéance"
            type="date"
            required
            value={fraisForm.date_echeance}
            onChange={(e) => setFraisForm({ ...fraisForm, date_echeance: e.target.value, mois_echeance: "", trimestre_echeance: "" })}
          />

          {fraisError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{fraisError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setFraisModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={fraisSaving}>{fraisSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!paiementTarget} onClose={() => setPaiementTarget(null)} title={`Encaisser — ${paiementTarget?.eleve_nom ?? ""}`}>
        {paiementTarget && (
          <form onSubmit={handlePaiementSubmit} className="space-y-4">
            <p className="text-sm text-slate-500">Solde restant : <span className="font-semibold text-slate-700">{money(paiementTarget.solde)}</span></p>
            <Input label="Montant reçu" type="number" min={0} step="0.01" required value={paiementForm.montant} onChange={(e) => setPaiementForm({ ...paiementForm, montant: e.target.value })} />
            <Select label="Mode de paiement" value={paiementForm.mode_paiement} onChange={(e) => setPaiementForm({ ...paiementForm, mode_paiement: e.target.value })}>
              <option value="especes">Espèces</option>
              <option value="cheque">Chèque</option>
              <option value="virement">Virement</option>
              <option value="mobile_money">Mobile Money</option>
            </Select>
            {paiementTarget.type_frais_est_mensuel && (
              <div>
                <Select
                  label="Mois de scolarité payé (optionnel)"
                  value={paiementForm.mois}
                  onChange={(e) => setPaiementForm({ ...paiementForm, mois: e.target.value })}
                >
                  <option value="">— Aucun mois précis —</option>
                  {(() => {
                    const annee = annees.find((a) => a.id === paiementTarget.annee_scolaire);
                    if (!annee) return null;
                    return moisDeLAnnee(annee).map((mois) => {
                      const statut = statutMoisPourFrais(paiementTarget, mois);
                      return (
                        <option key={mois} value={mois} disabled={statut === "paye"}>
                          {moisLabelLong(mois)}
                          {statut === "paye" ? " — déjà payé" : statut === "partiel" ? " — partiellement payé" : ""}
                        </option>
                      );
                    });
                  })()}
                </Select>
                <p className="text-xs text-slate-400 mt-1">
                  Ce frais est mensuel — choisissez le mois payé pour alimenter le{" "}
                  <Link to="/paiements/suivi-mensuel" className="text-brand-600 hover:underline">suivi mensuel</Link>.
                </p>
              </div>
            )}
            {paiementTarget.type_frais_periodicite === "trimestriel" && (
              <div>
                <Select
                  label="Tranche payée (optionnel)"
                  value={paiementForm.periode}
                  onChange={(e) => setPaiementForm({ ...paiementForm, periode: e.target.value })}
                >
                  <option value="">— Aucune tranche précise —</option>
                  {periodesPaiement.map((p, i) => {
                    const statut = statutPeriodePourFrais(paiementTarget, p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={statut === "paye"}>
                        {ORDINAUX[i] || `${i + 1}ème`} Tranche
                        {statut === "paye" ? " — déjà payée" : statut === "partiel" ? " — partiellement payée" : ""}
                      </option>
                    );
                  })}
                </Select>
                <p className="text-xs text-slate-400 mt-1">Ce frais est facturé par tranche — précisez laquelle ce versement couvre.</p>
              </div>
            )}
            <Input label="Référence (optionnel)" value={paiementForm.reference} onChange={(e) => setPaiementForm({ ...paiementForm, reference: e.target.value })} />

            {paiementError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{paiementError}</p>}

            <div className="flex justify-end gap-2 mt-2">
              <Button type="button" variant="secondary" onClick={() => setPaiementTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={paiementSaving}>{paiementSaving ? "Enregistrement…" : "Confirmer"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!historiqueTarget} onClose={() => setHistoriqueTarget(null)} title={`Historique des paiements — ${historiqueTarget?.eleve_nom ?? ""}`}>
        {historiqueTarget && (
          historiqueTarget.paiements.length === 0 ? (
            <EmptyState title="Aucun paiement sur ce frais" />
          ) : (
            <Table headers={["Date", "Montant", "Mode", "Mois", "Référence", "Enregistré par", ...(user?.role === "admin" ? [""] : [])]}>
              {[...historiqueTarget.paiements]
                .sort((a, b) => b.date_paiement.localeCompare(a.date_paiement))
                .map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 text-slate-500">{new Date(p.date_paiement).toLocaleDateString("fr-FR")}</td>
                    <td className="px-4 py-2.5 font-medium">{money(p.montant)}</td>
                    <td className="px-4 py-2.5">{MODE_PAIEMENT_LABELS[p.mode_paiement] ?? p.mode_paiement}</td>
                    <td className="px-4 py-2.5">{p.mois ? new Date(p.mois).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500">{p.reference || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500">{p.enregistre_par_nom || "—"}</td>
                    {user?.role === "admin" && (
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => handleDeletePaiement(p)}
                          disabled={paiementDeletingId === p.id}
                          className="text-rose-600 hover:underline text-sm disabled:opacity-50"
                        >
                          {paiementDeletingId === p.id ? "…" : "Supprimer"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </Table>
          )
        )}
      </Modal>

      <Modal open={typesModalOpen} onClose={() => setTypesModalOpen(false)} title="Types de frais">
        <div className="space-y-4">
          {types.length > 0 && (
            <Table headers={["Nom", "Montant standard", "Périodicité", ""]}>
              {types.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5">{t.nom}</td>
                  <td className="px-4 py-2.5">{money(t.montant_standard)}</td>
                  <td className="px-4 py-2.5">
                    {t.periodicite === "autre" ? <span className="text-slate-400">Autre / ponctuel</span> : <Badge color="brand">{t.periodicite_display}</Badge>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-3">
                      <button onClick={() => openTypeEdit(t)} className="text-brand-600 hover:underline text-sm">Modifier</button>
                      <button onClick={() => handleTypeDelete(t)} className="text-rose-600 hover:underline text-sm">Supprimer</button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}

          <form onSubmit={handleTypeSubmit} className="space-y-4 border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-700">{typeEditTarget ? `Modifier « ${typeEditTarget.nom} »` : "Nouveau type de frais"}</p>
            <Input label="Nom" required value={typeForm.nom} onChange={(e) => setTypeForm({ ...typeForm, nom: e.target.value })} />
            <Input label="Montant standard (GNF)" type="number" min={0} required value={typeForm.montant_standard} onChange={(e) => setTypeForm({ ...typeForm, montant_standard: e.target.value })} />
            <Select
              label="Périodicité"
              value={typeForm.periodicite}
              onChange={(e) => setTypeForm({ ...typeForm, periodicite: e.target.value as PeriodiciteFrais })}
            >
              {(Object.keys(PERIODICITE_LABELS) as PeriodiciteFrais[]).map((p) => <option key={p} value={p}>{PERIODICITE_LABELS[p]}</option>)}
            </Select>
            <p className="text-xs text-slate-400 -mt-2">
              Détermine l'échéance proposée à la création d'un frais de ce type : un mois de l'année scolaire (Mensuel — active
              aussi le suivi mois par mois), un trimestre (Trimestriel), l'année scolaire elle-même (Annuel), ou une date libre (Autre).
            </p>

            {typeError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{typeError}</p>}

            <div className="flex justify-end gap-2 mt-2">
              {typeEditTarget && (
                <Button type="button" variant="secondary" onClick={() => { setTypeEditTarget(null); setTypeForm(emptyTypeForm); }}>
                  Annuler la modification
                </Button>
              )}
              <Button type="submit" disabled={typeSaving}>{typeSaving ? "Enregistrement…" : typeEditTarget ? "Mettre à jour" : "Ajouter"}</Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
