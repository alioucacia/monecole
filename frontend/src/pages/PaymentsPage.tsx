import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { anneesApi, classesApi, elevesApi, fraisApi, paiementsApi, periodesApi, tarifsClasseApi, typesFraisApi, unwrapList } from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner, StatCard, Table } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { StatutMensualiteBadge } from "../components/StatutMensualite";
import { useAnnee } from "../context/AnneeContext";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { usePaginated } from "../hooks/usePaginated";
import type { AnneeScolaire, Classe, Cycle, EleveProfile, Frais, Periode, PeriodiciteFrais, TypeFrais, UsageFrais } from "../types";

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

const emptyFraisForm = {
  eleve: "", type_frais: "", annee_scolaire: "", montant: "", date_echeance: "", mois_echeance: "", trimestre_echeance: "",
  // Remise de fidélité de 5% — proposée uniquement pour un type de frais "Annuel" (voir son
  // affichage conditionnel dans le formulaire ci-dessous), appliquée en réduisant directement
  // le montant saisi au moment de la création plutôt que via un mécanisme de réduction récurrent
  // (contrairement à la mensualité/inscription, un frais annuel n'a qu'une seule échéance : pas
  // besoin d'un facteur recalculé à chaque mois).
  remise5: false,
};

// Mois de mensualité, dans l'ordre de l'année scolaire : Octobre à Juin (9 mois) — ni Septembre
// (inscription/réinscription), ni Juillet/Août (hors année scolaire). Même liste que
// payments.models.MOIS_MENSUALITE côté backend, qui refuse aussi les autres mois.
const MOIS_MENSUALITE = ["10", "11", "12", "01", "02", "03", "04", "05", "06"];

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
/** Date du jour ("AAAA-MM-JJ") en heure locale — échéance d'un nouveau frais mensuel. */
function aujourdhuiISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const emptyPaiementForm ={ montant: "", mode_paiement: "especes", reference: "", mois: "", periode: "" };
const emptyTypeForm = { nom: "", montant_standard: "", periodicite: "autre" as PeriodiciteFrais, usage: "standard" as UsageFrais };

const USAGE_LABELS: Record<UsageFrais, string> = {
  standard: "Standard",
  inscription: "Frais d'inscription (nouvel élève)",
  reinscription: "Frais de réinscription",
};

const PERIODICITE_LABELS: Record<PeriodiciteFrais, string> = {
  mensuel: "Mensuel", trimestriel: "Tranche", annuel: "Annuel", autre: "Autre / ponctuel",
};

const ORDINAUX = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];

/** Valeur de « Tranche d'échéance » pour un type propre à une tranche (« 2ème Tranche ») quand
 * l'année n'a pas de période correspondante — la tranche vient alors du type lui-même. */
const TRANCHE_DU_TYPE = "type";
/** Premier mois de chaque tranche (1ère : Octobre, 2ème : Janvier, 3ème : Avril — voir
 * payments.views.MOIS_PAR_TRANCHE) : échéance par défaut d'un type « N-ième Tranche ». */
const DEBUT_TRANCHE = ["10", "01", "04"];

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
  return mois.filter((m) => MOIS_MENSUALITE.includes(m.slice(5)));
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

/** Ce qu'il reste réellement à payer pour CE versement précis — le mois/la tranche choisi·e s'il
 * y en a un·e (un élève ne peut pas verser plus que ce qu'il reste pour ce mois/cette tranche
 * précis·e), sinon le solde global du frais. Même règle que `PaiementSerializer.validate` côté
 * backend (voir payments/serializers.py) — dupliquée ici pour un retour immédiat à la saisie,
 * mais le backend reste la source de vérité en cas d'écart (ex: un autre paiement encaissé
 * entre-temps par quelqu'un d'autre). */
function restantAVerser(frais: Frais, mois: string, periode: string): number {
  const montantDu = Number(frais.montant_du);
  if (mois && frais.type_frais_est_mensuel) {
    const deja = frais.paiements.filter((p) => p.mois && p.mois.startsWith(mois)).reduce((sum, p) => sum + Number(p.montant), 0);
    return Math.max(0, montantDu - deja);
  }
  if (periode && frais.type_frais_periodicite === "trimestriel") {
    const periodeId = Number(periode);
    const deja = frais.paiements.filter((p) => p.periode === periodeId).reduce((sum, p) => sum + Number(p.montant), 0);
    return Math.max(0, montantDu - deja);
  }
  return Math.max(0, Number(frais.solde));
}

export default function PaymentsPage() {
  const toast = useToast();
  const confirmer = useConfirm();
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
  // Liste et totaux : année affichée dans toute l'application (sélecteur du haut, appliqué
  // côté serveur) — voir context/AnneeContext.tsx.
  const { anneeId: anneeVueId } = useAnnee();
  // Frais « Payé » masqués par défaut : la liste ne montre que ce qui reste à encaisser.
  const [afficherPayes, setAfficherPayes] = useState(false);
  const classesDuCycle = cycleFiltre ? classes.filter((c) => c.cycle === cycleFiltre) : classes;

  const [fraisModalOpen, setFraisModalOpen] = useState(false);
  const [fraisForm, setFraisForm] = useState(emptyFraisForm);
  const [fraisError, setFraisError] = useState("");
  const [fraisSaving, setFraisSaving] = useState(false);
  // Cycle/Classe : filtrent uniquement la liste déroulante "Élève" ci-dessous (pas envoyés à
  // l'API) — un grand établissement peut avoir des centaines d'élèves, difficiles à retrouver
  // dans une seule liste à plat sans pouvoir d'abord restreindre par classe.
  const [fraisEleveCycle, setFraisEleveCycle] = useState<Cycle | "">("");
  const [fraisEleveClasse, setFraisEleveClasse] = useState("");
  const classesDuCycleFrais = fraisEleveCycle ? classes.filter((c) => c.cycle === fraisEleveCycle) : classes;
  // Les « Élèves Bonus » (ne paient pas la scolarité — voir StatutMensualite) n'apparaissent pas
  // dans « Nouveau frais » ; le serveur refuse de toute façon de leur créer une scolarité.
  const elevesFiltres = eleves.filter((el) =>
    !el.exonere_fratrie
    && (!fraisEleveCycle || el.classe_cycle === fraisEleveCycle) && (!fraisEleveClasse || String(el.classe) === fraisEleveClasse)
  );
  // Trimestres (Periode) de l'année scolaire choisie dans "Nouveau frais" — ne sert que pour la
  // liste déroulante "Trimestre d'échéance" d'un type de frais Trimestriel (voir périodicité).
  const [periodesAnnee, setPeriodesAnnee] = useState<Periode[]>([]);

  // Tranches proposées dans la modale "Encaisser" pour un frais de périodicité Tranche —
  // rechargées à l'ouverture (voir openPaiementModal), distinctes de `periodesAnnee` ci-dessus
  // (celle-ci suit l'année scolaire du frais encaissé, pas celle du formulaire "Nouveau frais").
  const [periodesPaiement, setPeriodesPaiement] = useState<Periode[]>([]);
  // Reste à payer en mensualités sur l'année pour l'élève de la modale "Encaisser" (frais
  // mensuel uniquement) — voir openPaiementModal.
  const [resteAnnuel, setResteAnnuel] = useState<number | null>(null);
  // Mois ("2025-10"...) déjà couverts par une tranche que l'élève a commencé à payer — une
  // mensualité ne peut plus les régler (voir verifier_mois_hors_tranche côté serveur).
  const [moisCouvertsTranche, setMoisCouvertsTranche] = useState<Record<string, string>>({});
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
      masquer_payes: peutGerer && !afficherPayes ? 1 : undefined,
    }),
    [searchDebounced, cycleFiltre, classeFiltre, afficherPayes]
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
      toast.error(await extractBlobErrorMessage(err));
    } finally {
      setExportingFiches(false);
    }
  };

  const handleDownloadFiche = async (frais: Frais) => {
    setFichePendingId(frais.id);
    try {
      await fraisApi.fichePaiementPdf(frais.id, `fiche_paiement_${frais.eleve_nom.replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      toast.error(await extractBlobErrorMessage(err));
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
      toast.error(await extractBlobErrorMessage(err));
    } finally {
      setProformaPendingId(null);
    }
  };

  const loadSummary = () => fraisApi.summary().then(({ data }) => setSummary(data));
  // Totaux du haut actualisés toutes les 5 s, comme la liste (voir usePaginated).
  useAutoRefresh(() => { loadSummary().catch(() => {}); }, peutGerer);
  const loadTypes = () => typesFraisApi.list().then(({ data }) => setTypes(unwrapList(data)));

  const handleNotifierImpayes = async () => {
    setNotifying(true);
    try {
      const { data } = await fraisApi.notifierImpayes();
      if (data.familles_en_retard === 0) {
        toast.info("Aucun élève en retard de paiement : aucune relance à envoyer.");
        return;
      }
      if (data.notifies > 0) {
        toast.success(
          `${data.notifies} famille(s) relancée(s) sur ${data.familles_en_retard} en retard — ` +
          `${data.sms_envoyes} SMS, ${data.emails_envoyes} e-mail(s).`
        );
      }
      if (data.sms_echecs > 0) {
        toast.error(`${data.sms_echecs} SMS n'ont pas pu partir (numéro invalide ou crédit SMS épuisé).`);
      }
      if (data.sms_desactives) {
        toast.warning("Les SMS aux parents sont désactivés pour votre établissement : seuls les e-mails sont partis.");
      }
      if (data.sans_contact > 0) {
        toast.warning(
          `${data.sans_contact} famille(s) sans téléphone ni e-mail : ${data.sans_contact_noms.join(", ")}` +
          `${data.sans_contact > data.sans_contact_noms.length ? "…" : ""}. Ajoutez un numéro au parent.`
        );
      }
      if (data.notifies === 0 && data.sms_echecs === 0 && data.sans_contact === 0 && !data.sms_desactives) {
        toast.error("Aucun message n'a pu être envoyé. Vérifiez les numéros et e-mails des parents.");
      }
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
      loadSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peutGerer]);

  // Classes de l'année affichée (filtres Cycle/Classe de la liste et de « Nouveau frais »).
  // Rechargées quand l'année est connue/change : au premier rendu `anneeVueId` est encore null
  // (AnneeContext charge les années en asynchrone) et la liste mélangeait alors les classes de
  // toutes les années — choisir une classe d'une année passée ne donnait aucun élève.
  useEffect(() => {
    if (!peutGerer || !anneeVueId) return;
    classesApi.list({ page_size: 200, annee_scolaire: anneeVueId }).then(({ data }) => setClasses(unwrapList(data)));
  }, [peutGerer, anneeVueId]);

  // Élèves de « Nouveau frais » : filtrés côté serveur par Cycle/Classe — la liste complète est
  // plafonnée à 500 élèves (triés par date d'inscription), les derniers inscrits n'y figuraient
  // donc pas et le filtre côté client ne les trouvait jamais.
  useEffect(() => {
    if (!peutGerer || !fraisModalOpen) return;
    let annule = false;
    elevesApi.list({
      page_size: 500,
      classe: fraisEleveClasse || undefined,
      cycle: fraisEleveClasse ? undefined : fraisEleveCycle || undefined,
    }).then(({ data }) => { if (!annule) setEleves(unwrapList(data)); });
    return () => { annule = true; };
  }, [peutGerer, fraisModalOpen, fraisEleveCycle, fraisEleveClasse]);

  // Si le cycle change, la classe sélectionnée peut ne plus lui appartenir — on la réinitialise
  // plutôt que de garder un filtre incohérent (ex: "4ème A" sélectionnée alors qu'on filtre "Lycée").
  useEffect(() => {
    if (classeFiltre && !classesDuCycle.some((c) => c.id === Number(classeFiltre))) {
      setClasseFiltre("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleFiltre]);

  const openFraisModal = () => {
    setFraisForm({
      ...emptyFraisForm, date_echeance: aujourdhuiISO(),
      annee_scolaire: anneeVueId?.toString() || annees.find((a) => a.active)?.id.toString() || "",
    });
    setFraisError("");
    setFraisEleveCycle("");
    setFraisEleveClasse("");
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

  // Type propre à une tranche (« 2ème Tranche ») : sa tranche d'échéance est imposée et
  // présélectionnée — sans dépendre des périodes de l'année (Paramètres → Périodes) : la tranche
  // est donnée par le type lui-même. Échéance : fin de la N-ième période si elle existe, sinon
  // début de la tranche (voir DEBUT_TRANCHE).
  const numeroTrancheType = typeFraisSelectionne?.periodicite === "trimestriel" ? typeFraisSelectionne.numero_tranche : null;
  const periodeTrancheType = numeroTrancheType ? periodesAnnee[numeroTrancheType - 1] : undefined;
  useEffect(() => {
    if (!numeroTrancheType) return;
    const annee = annees.find((a) => a.id === Number(fraisForm.annee_scolaire));
    const debut = DEBUT_TRANCHE[numeroTrancheType - 1];
    setFraisForm((f) => ({
      ...f, trimestre_echeance: periodeTrancheType ? String(periodeTrancheType.id) : TRANCHE_DU_TYPE,
      date_echeance: periodeTrancheType ? periodeTrancheType.date_fin : annee && debut ? echeanceDuMois(annee, debut) : f.date_echeance,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroTrancheType, periodeTrancheType, fraisForm.annee_scolaire]);

  // Montant proposé pour "Nouveau frais" : reprend le tarif spécifique à la classe de l'élève
  // choisi (voir Paiements → 💰 Tarifs par classe / TarifClasse) s'il y en a un pour ce type de
  // frais + cette année scolaire, sinon le montant standard du type de frais. AVANT ce correctif,
  // le montant proposé ici ignorait toujours les tarifs par classe (voir l'onChange de "Type de
  // frais" ci-dessous, qui ne fait que reprendre `type.montant_standard` en attendant que cet
  // effet le corrige) — un même type de frais paraissait donc coûter pareil dans toutes les
  // classes, alors que le tarif par classe existait déjà bel et bien en base.
  useEffect(() => {
    if (!typeFraisSelectionne) return;
    const eleve = eleves.find((e) => e.id === Number(fraisForm.eleve));
    if (!eleve?.classe || !fraisForm.annee_scolaire) return;
    tarifsClasseApi.list({
      classe: eleve.classe, type_frais: typeFraisSelectionne.id, annee_scolaire: Number(fraisForm.annee_scolaire),
    }).then(({ data }) => {
      const tarif = unwrapList(data)[0];
      const montant = tarif ? tarif.montant : typeFraisSelectionne.montant_standard;
      setFraisForm((f) => (Number(f.type_frais) === typeFraisSelectionne.id ? { ...f, montant } : f));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fraisForm.type_frais, fraisForm.eleve, fraisForm.annee_scolaire]);

  const handleFraisSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFraisSaving(true);
    setFraisError("");
    try {
      // La remise n'est appliquée qu'au moment de la création — `montant` stocké reflète alors
      // directement le tarif déjà réduit (comme une saisie manuelle), sans champ dédié à ajouter
      // ni recalcul ultérieur.
      const montantSaisi = Number(fraisForm.montant);
      const montantFinal = fraisForm.remise5 && typeFraisSelectionne?.periodicite === "annuel"
        ? Math.round(montantSaisi * 0.95)
        : montantSaisi;
      // Mensuel : le mois choisi est envoyé à part (`mois`) — l'échéance reste la date du jour.
      const annee = annees.find((a) => a.id === Number(fraisForm.annee_scolaire));
      const mois = typeFraisSelectionne?.periodicite === "mensuel" && annee && fraisForm.mois_echeance
        ? echeanceDuMois(annee, fraisForm.mois_echeance) : null;
      await fraisApi.create({
        eleve: Number(fraisForm.eleve), type_frais: Number(fraisForm.type_frais),
        annee_scolaire: Number(fraisForm.annee_scolaire), montant: String(montantFinal), date_echeance: aujourdhuiISO(),
        mois,
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
    if (!(await confirmer(`Supprimer le frais « ${frais.type_frais_nom} » de ${frais.eleve_nom} ? Cette action est irréversible.`, { danger: true }))) return;
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
    setResteAnnuel(null);
    setMoisCouvertsTranche({});
    // Mensualité : reste à payer sur toute l'année (somme des 9 mois du suivi mensuel) —
    // plafond annuel également imposé côté serveur (PaiementSerializer).
    if (frais.type_frais_est_mensuel) {
      fraisApi.suiviMensuel(frais.eleve, frais.annee_scolaire)
        .then(({ data }) => {
          setResteAnnuel(data.mois.reduce((sum, m) => sum + Number(m.reste), 0));
          setMoisCouvertsTranche(Object.fromEntries(
            data.mois.filter((m) => m.couvert_par.includes("Tranche")).map((m) => [m.mois, m.couvert_par]),
          ));
        })
        .catch(() => {});
    }
    if (frais.type_frais_periodicite === "trimestriel") {
      periodesApi.list({ annee_scolaire: frais.annee_scolaire }).then(({ data }) => {
        const periodes = unwrapList(data);
        setPeriodesPaiement(periodes);
        // Frais propre à une tranche (« 2ème Tranche ») : sa tranche, présélectionnée.
        const sienne = frais.type_frais_numero_tranche ? periodes[frais.type_frais_numero_tranche - 1] : undefined;
        if (sienne) setPaiementForm((f) => ({ ...f, periode: String(sienne.id) }));
      });
    }
  };

  // Plafond d'un versement : reste du mois / de la tranche (ou solde du frais), et pour une
  // mensualité, jamais plus que le reste à payer sur l'année.
  const plafondVersement = (frais: Frais) => {
    const restant = restantAVerser(frais, paiementForm.mois, paiementForm.periode);
    return resteAnnuel !== null && frais.type_frais_est_mensuel ? Math.min(restant, resteAnnuel) : restant;
  };

  const handlePaiementSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!paiementTarget) return;
    // Sans tranche précisée, le versement ne pourrait être rattaché à aucun mois dans le suivi
    // mensuel (voir payments.views.MOIS_PAR_TRANCHE).
    // (Un frais propre à une tranche sans période configurée est accepté : le serveur l'impute
    // à sa tranche.)
    if (paiementTarget.type_frais_periodicite === "trimestriel" && !paiementForm.periode && !paiementTarget.type_frais_numero_tranche) {
      setPaiementError("Choisissez la tranche payée.");
      return;
    }
    const montantMax = plafondVersement(paiementTarget);
    if (Number(paiementForm.montant) > montantMax) {
      setPaiementError(`Le montant dépasse ce qu'il reste à payer (${money(montantMax)}).`);
      return;
    }
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
    if (!(await confirmer(`Supprimer ce paiement de ${money(paiement.montant)} ? Cette action est irréversible.`, { danger: true }))) return;
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
    setTypeForm({ nom: type.nom, montant_standard: type.montant_standard, periodicite: type.periodicite, usage: type.usage });
    setTypeError("");
  };

  const handleTypeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTypeSaving(true);
    setTypeError("");
    try {
      const payload = { nom: typeForm.nom, montant_standard: typeForm.montant_standard, periodicite: typeForm.periodicite, usage: typeForm.usage };
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
    if (!(await confirmer(`Supprimer le type de frais « ${type.nom} » ?`, { danger: true }))) return;
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
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer mb-2.5">
            <input
              type="checkbox" checked={afficherPayes} className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              onChange={(e) => setAfficherPayes(e.target.checked)}
            />
            Afficher les frais payés
          </label>
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
                <td className="px-4 py-3 font-medium text-slate-700">
                  <span className="flex flex-col items-start">
                    {f.eleve_nom}
                    <StatutMensualiteBadge categorie={f.eleve_categorie_paiement} exonereFratrie={f.eleve_exonere_fratrie} />
                  </span>
                </td>
                <td className="px-4 py-3">
                  {f.type_frais_nom}
                  {/* Mois couvert, distinct de l'échéance (date du jour de création). */}
                  {f.mois && <span className="block text-[11px] text-slate-400 capitalize">{moisLabelLong(f.mois.slice(0, 7))}</span>}
                </td>
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
        <form noValidate onSubmit={handleFraisSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <CycleSelect
              label="Cycle"
              value={fraisEleveCycle}
              onChange={(c) => { setFraisEleveCycle(c); setFraisEleveClasse(""); setFraisForm((f) => ({ ...f, eleve: "" })); }}
            />
            <Select label="Classe" value={fraisEleveClasse} onChange={(e) => { setFraisEleveClasse(e.target.value); setFraisForm((f) => ({ ...f, eleve: "" })); }}>
              <option value="">— Toutes les classes —</option>
              {classesDuCycleFrais.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </Select>
          </div>
          <Select label="Élève" required value={fraisForm.eleve} onChange={(e) => setFraisForm({ ...fraisForm, eleve: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {elevesFiltres.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name} ({el.matricule})</option>)}
          </Select>
          <Select label="Type de frais" required value={fraisForm.type_frais} onChange={(e) => {
            const type = types.find((t) => t.id === Number(e.target.value));
            const annee = annees.find((a) => a.id === Number(fraisForm.annee_scolaire));
            setFraisForm({
              ...fraisForm, type_frais: e.target.value, montant: type ? type.montant_standard : fraisForm.montant,
              mois_echeance: "", trimestre_echeance: "",
              // Annuel : une seule échéance possible (fin d'année scolaire) — pas de liste à choisir.
              // Mensuel : date du jour, quel que soit le mois choisi.
              date_echeance: type?.periodicite === "annuel" && annee ? annee.date_fin
                : type?.periodicite === "mensuel" ? aujourdhuiISO()
                : fraisForm.date_echeance,
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
                annee && typeFraisSelectionne?.periodicite === "annuel" ? annee.date_fin
                : fraisForm.date_echeance,
            });
          }}>
            <option value="">— Sélectionner —</option>
            {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </Select>
          {/* Montant non modifiable : repris du paramétrage (tarif de la classe, sinon montant
              standard du type de frais) — également imposé côté serveur (FraisSerializer). */}
          <div>
            <Input
              label="Montant (GNF)" type="number" required readOnly value={fraisForm.montant}
              className="bg-slate-50 text-slate-600 cursor-not-allowed"
              title="Montant fixé par le paramétrage du type de frais / tarif de la classe"
            />
            <p className="text-xs text-slate-400 mt-1">Fixé par le paramétrage (Types de frais / Tarifs par classe).</p>
          </div>

          {/* Remise de fidélité de 5% — un type de frais Annuel n'a qu'une seule échéance dans
              l'année, donc rien à cocher/recalculer plus tard : la remise réduit directement le
              montant du frais créé. */}
          {typeFraisSelectionne?.periodicite === "annuel" && (
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer sm:col-span-2 -mt-2">
              <input
                type="checkbox" checked={fraisForm.remise5} className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                onChange={(e) => setFraisForm({ ...fraisForm, remise5: e.target.checked })}
              />
              Appliquer une remise de fidélité de 5% pour cet élève
              {fraisForm.remise5 && fraisForm.montant && (
                <span className="text-xs text-slate-400">
                  ({money(Number(fraisForm.montant))} → {money(Math.round(Number(fraisForm.montant) * 0.95))})
                </span>
              )}
            </label>
          )}

          {/* Échéance : la liste déroulante proposée dépend de la périodicité du type de frais
              choisi ci-dessus — mois de l'année scolaire (Mensuel), trimestres configurés
              (Trimestriel), fin d'année scolaire déjà réglée automatiquement (Annuel), ou
              directement la date libre ci-dessous (Autre / aucun type choisi). */}
          {typeFraisSelectionne?.periodicite === "mensuel" && (
            <Select label="Mois d'échéance" required value={fraisForm.mois_echeance} onChange={(e) => {
              // Le mois choisi ne change pas la date d'échéance : elle reste la date du jour.
              setFraisForm({ ...fraisForm, mois_echeance: e.target.value, date_echeance: aujourdhuiISO() });
            }}>
              <option value="">— Choisir un mois —</option>
              {/* Octobre → Juin seulement (voir MOIS_MENSUALITE). */}
              {MOIS_MENSUALITE.map((valeur) => <option key={valeur} value={valeur}>{MOIS_NOMS[Number(valeur) - 1]}</option>)}
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
              {numeroTrancheType ? (
                <option value={periodeTrancheType ? String(periodeTrancheType.id) : TRANCHE_DU_TYPE}>
                  {ORDINAUX[numeroTrancheType - 1] || `${numeroTrancheType}ème`} Tranche{fraisForm.montant ? ` — ${Number(fraisForm.montant).toLocaleString("fr-FR")} GNF` : ""}
                </option>
              ) : (
                <>
                  <option value="">
                    {periodesAnnee.length === 0 ? "— Aucune tranche configurée pour cette année —" : "— Choisir une tranche —"}
                  </option>
                  {periodesAnnee.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      {ORDINAUX[i] || `${i + 1}ème`} Tranche{fraisForm.montant ? ` — ${Number(fraisForm.montant).toLocaleString("fr-FR")} GNF` : ""}
                    </option>
                  ))}
                </>
              )}
            </Select>
          )}
          {/* Date d'échéance : toujours la date du jour, quel que soit le type de frais — non
              modifiable (également imposée côté serveur, voir FraisSerializer). */}
          <Input
            label="Date d'échéance"
            type="date"
            required
            value={aujourdhuiISO()}
            readOnly
            className="bg-slate-50 text-slate-600 cursor-not-allowed"
            title="Date du jour, quel que soit le type de frais"
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
          <form noValidate onSubmit={handlePaiementSubmit} className="space-y-4">
            <p className="text-sm text-slate-500">Solde restant : <span className="font-semibold text-slate-700">{money(paiementTarget.solde)}</span></p>
            <div>
              <Input
                label="Montant reçu" type="number" min={0}
                max={plafondVersement(paiementTarget)}
                step="0.01" required
                value={paiementForm.montant}
                onChange={(e) => setPaiementForm({ ...paiementForm, montant: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Maximum pour {paiementForm.mois || paiementForm.periode ? "cette échéance" : "ce frais"} :{" "}
                {money(plafondVersement(paiementTarget))}
              </p>
              {resteAnnuel !== null && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Reste à payer en mensualités sur l'année : <span className="font-semibold">{money(resteAnnuel)}</span>
                </p>
              )}
            </div>
            <Select label="Mode de paiement" value={paiementForm.mode_paiement} onChange={(e) => setPaiementForm({ ...paiementForm, mode_paiement: e.target.value })}>
              <option value="especes">Espèces</option>
              <option value="cheque">Chèque</option>
              <option value="virement">Virement</option>
              <option value="mobile_money">Mobile Money</option>
            </Select>
            {paiementTarget.type_frais_est_mensuel && (
              <div>
                <Select
                  label="Mois de scolarité payé"
                  required
                  value={paiementForm.mois}
                  onChange={(e) => setPaiementForm({ ...paiementForm, mois: e.target.value })}
                >
                  <option value="">— Choisir un mois —</option>
                  {(() => {
                    const annee = annees.find((a) => a.id === paiementTarget.annee_scolaire);
                    if (!annee) return null;
                    return moisDeLAnnee(annee).map((mois) => {
                      const statut = statutMoisPourFrais(paiementTarget, mois);
                      const tranche = moisCouvertsTranche[mois];
                      return (
                        <option key={mois} value={mois} disabled={statut === "paye" || !!tranche}>
                          {moisLabelLong(mois)}
                          {tranche ? ` — couvert par la ${tranche.toLowerCase()}`
                            : statut === "paye" ? " — déjà payé" : statut === "partiel" ? " — partiellement payé" : ""}
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
            {paiementTarget.type_frais_periodicite === "trimestriel" && paiementTarget.type_frais_numero_tranche && (
              // Frais propre à une tranche : rien à choisir, le versement lui est imputé (le
              // serveur le rattache à la N-ième période si elle existe).
              <p className="text-sm text-slate-600">
                Tranche payée :{" "}
                <span className="font-semibold">
                  {ORDINAUX[paiementTarget.type_frais_numero_tranche - 1] || `${paiementTarget.type_frais_numero_tranche}ème`} Tranche
                </span>
              </p>
            )}
            {paiementTarget.type_frais_periodicite === "trimestriel" && !paiementTarget.type_frais_numero_tranche && (
              <div>
                <Select
                  label="Tranche payée"
                  required
                  value={paiementForm.periode}
                  onChange={(e) => setPaiementForm({ ...paiementForm, periode: e.target.value })}
                >
                  <option value="">— Choisir la tranche —</option>
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
                <p className="text-xs text-slate-400 mt-1">
                  Ce frais est facturé par tranche — dans le suivi mensuel, la 1ère tranche couvre Octobre, Novembre,
                  Décembre et Juin, la 2ème Janvier à Mars, la 3ème Avril et Mai.
                </p>
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
            <>
              {historiqueTarget.type_frais_periodicite === "annuel" && (() => {
                // Un frais Annuel se règle en un seul versement (pas de mois/tranche associé à
                // chaque paiement, contrairement au Mensuel/Tranche) — pour donner malgré tout un
                // repère mensuel à l'admin/comptable, le total encaissé est réparti à parts égales
                // sur les 9 mois de l'année scolaire, un pur calcul d'affichage (aucun `mois` n'est
                // écrit sur les paiements eux-mêmes, qui restent un seul versement annuel).
                const annee = annees.find((a) => a.id === historiqueTarget.annee_scolaire);
                if (!annee) return null;
                const mois9 = moisDeLAnnee(annee).slice(0, 9);
                const montantParMois = Number(historiqueTarget.montant_paye) / 9;
                return (
                  <div className="mb-5">
                    <p className="text-sm font-bold text-ink-900 mb-1">Équivalent mensuel (total payé ÷ 9 mois)</p>
                    <p className="text-xs text-slate-400 mb-3">
                      Ce frais est Annuel — versé en une fois, sans mois associé. Répartition indicative du total
                      payé ({money(historiqueTarget.montant_paye)}) sur les 9 mois de l'année scolaire.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {mois9.map((m) => (
                        <div key={m} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                          <p className="text-xs text-slate-400 capitalize">{moisLabelLong(m)}</p>
                          <p className="text-sm font-bold text-ink-900">{money(montantParMois.toFixed(2))}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
            </>
          )
        )}
      </Modal>

      <Modal open={typesModalOpen} onClose={() => setTypesModalOpen(false)} title="Types de frais">
        <div className="space-y-4">
          {types.length > 0 && (
            <Table headers={["Nom", "Montant standard", "Périodicité", "Usage", ""]}>
              {types.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5">{t.nom}</td>
                  <td className="px-4 py-2.5">{money(t.montant_standard)}</td>
                  <td className="px-4 py-2.5">
                    {t.periodicite === "autre" ? <span className="text-slate-400">Autre / ponctuel</span> : <Badge color="brand">{t.periodicite_display}</Badge>}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.usage === "standard" ? <span className="text-slate-400">—</span> : <Badge color="teal">{t.usage_display}</Badge>}
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

          <form noValidate onSubmit={handleTypeSubmit} className="space-y-4 border-t border-slate-100 pt-4">
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

            <Select
              label="Usage"
              value={typeForm.usage}
              onChange={(e) => setTypeForm({ ...typeForm, usage: e.target.value as UsageFrais })}
            >
              {(Object.keys(USAGE_LABELS) as UsageFrais[]).map((u) => <option key={u} value={u}>{USAGE_LABELS[u]}</option>)}
            </Select>
            <p className="text-xs text-slate-400 -mt-2">
              Marquez ici LE type de frais d'inscription ou de réinscription de l'établissement (un seul de chaque) : son
              montant, réglé par classe dans « 💰 Tarifs par classe », est alors proposé/appliqué automatiquement à
              l'inscription d'un nouvel élève et à la réinscription — sans plus rien à ressaisir à chaque fois.
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
