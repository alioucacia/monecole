import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  affectationsTransportApi, anneesApi, bulletinApi, elevesApi, empruntsApi, fraisApi,
  justificatifsApi, notesApi, periodesApi, presencesApi, unwrapList,
} from "../api/services";
import { extractErrorMessage } from "../api/client";
import { PdfPreviewModal } from "../components/PdfPreviewModal";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, StatCard, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type {
  AffectationTransport, AnneeScolaire, Bulletin, CategoriePaiement, EleveProfile, Emprunt, Frais, JustificatifAbsence, Note, Periode, Presence, SuiviMensuelMois,
} from "../types";

const CATEGORIE_LABELS: Record<CategoriePaiement, string> = {
  standard: "Standard",
  fondation_50: "Fondation — 50%",
  fondation_gratuit: "Fondation — Gratuit",
  inscription_seulement: "Inscription/réinscription uniquement",
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

const REGIME_LABELS: Record<string, string> = { externe: "Externe", demi_pension: "Demi-pension", interne: "Interne" };
const STATUT_INSCRIPTION_LABELS: Record<string, string> = { nouveau: "Nouvelle inscription", reinscription: "Réinscription", transfert: "Transfert" };

const PRESENCE_LABELS: Record<string, { label: string; color: "green" | "rose" | "amber" }> = {
  present: { label: "Présent", color: "green" },
  absent: { label: "Absent", color: "rose" },
  retard: { label: "Retard", color: "amber" },
};

const FRAIS_LABELS: Record<string, { label: string; color: "green" | "amber" | "rose" }> = {
  paye: { label: "Payé", color: "green" },
  partiel: { label: "Partiel", color: "amber" },
  impaye: { label: "Impayé", color: "rose" },
};

const EMPRUNT_LABELS: Record<string, { label: string; color: "green" | "amber" | "rose" }> = {
  rendu: { label: "Rendu", color: "green" },
  en_cours: { label: "En cours", color: "amber" },
  en_retard: { label: "En retard", color: "rose" },
};

const MOTIF_JUSTIFICATIF_LABELS: Record<string, string> = { maladie: "Maladie", autre: "Autre motif" };

const JUSTIFICATIF_LABELS: Record<string, { label: string; color: "green" | "amber" | "rose" }> = {
  approuve: { label: "Approuvé", color: "green" },
  en_attente: { label: "En attente", color: "amber" },
  rejete: { label: "Rejeté", color: "rose" },
};

function initials(first: string, last: string) {
  return `${first[0] || "?"}${last[0] || ""}`.toUpperCase();
}

type TabKey = "apercu" | "historique" | "notes" | "presences" | "paiements" | "transport" | "bibliotheque" | "justificatifs";
const TAB_KEYS: TabKey[] = ["apercu", "historique", "notes", "presences", "paiements", "transport", "bibliotheque", "justificatifs"];

const MODE_PAIEMENT_LABELS: Record<string, string> = {
  especes: "Espèces", cheque: "Chèque", virement: "Virement", mobile_money: "Mobile Money",
};

interface EvenementHistorique {
  date: string;
  icone: string;
  titre: string;
  detail?: string;
  badge?: { label: string; color: "green" | "amber" | "rose" | "slate" | "brand" | "teal" };
}

export default function StudentDetailPage() {
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const eleveId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const peutVoirPaiements = user?.role === "admin" || user?.role === "comptabilite";

  const [searchParams] = useSearchParams();
  const [eleve, setEleve] = useState<EleveProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // `?tab=paiements` permet d'arriver directement sur l'onglet Paiements depuis un lien externe
  // (ex: la recherche par matricule pour la comptabilité) sans repasser par Aperçu d'abord.
  const tabInitial = searchParams.get("tab");
  const [tab, setTab] = useState<TabKey>(
    TAB_KEYS.includes(tabInitial as TabKey) ? (tabInitial as TabKey) : "apercu"
  );

  const [notes, setNotes] = useState<Note[]>([]);
  const [presences, setPresences] = useState<Presence[]>([]);
  const [presenceStats, setPresenceStats] = useState<Record<string, any> | null>(null);
  const [frais, setFrais] = useState<Frais[]>([]);
  const [suiviMensuel, setSuiviMensuel] = useState<SuiviMensuelMois[]>([]);
  const [suiviMensuelLoading, setSuiviMensuelLoading] = useState(false);
  const [suiviMensuelError, setSuiviMensuelError] = useState("");
  const [suiviMensuelCharge, setSuiviMensuelCharge] = useState(false);
  const [affectations, setAffectations] = useState<AffectationTransport[]>([]);
  const [emprunts, setEmprunts] = useState<Emprunt[]>([]);
  const [justificatifs, setJustificatifs] = useState<JustificatifAbsence[]>([]);
  const [bulletin, setBulletin] = useState<Bulletin | null>(null);
  const [anneeActiveId, setAnneeActiveId] = useState<number | null>(null);
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  // Filtres de l'onglet Notes : année scolaire + trimestre choisis (par défaut, l'année active).
  const [anneeNotesFilter, setAnneeNotesFilter] = useState<number | "">("");
  const [periodeNotesFilter, setPeriodeNotesFilter] = useState<number | "">("");

  const [recuLoading, setRecuLoading] = useState(false);
  const [certificatLoading, setCertificatLoading] = useState(false);
  const [bulletinPreviewOpen, setBulletinPreviewOpen] = useState(false);
  const [proformaPreviewOpen, setProformaPreviewOpen] = useState(false);
  const [categorieSaving, setCategorieSaving] = useState(false);

  useEffect(() => {
    if (!eleveId) return;
    setLoading(true);
    setNotFound(false);
    elevesApi.get(eleveId)
      .then(({ data }) => setEleve(data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [eleveId]);

  useEffect(() => {
    if (!eleve) return;
    notesApi.list({ eleve: eleve.id, page_size: 200 }).then(({ data }) => setNotes(unwrapList(data))).catch(() => {});
    presencesApi.list({ eleve: eleve.id, page_size: 200 }).then(({ data }) => setPresences(unwrapList(data))).catch(() => {});
    presencesApi.stats({ eleve: eleve.id }).then(({ data }) => setPresenceStats(data)).catch(() => {});
    empruntsApi.list({ eleve: eleve.id, page_size: 100 }).then(({ data }) => setEmprunts(unwrapList(data))).catch(() => {});
    affectationsTransportApi.list({ eleve: eleve.id, page_size: 50 }).then(({ data }) => setAffectations(unwrapList(data))).catch(() => {});
    justificatifsApi.list({ eleve: eleve.id, page_size: 100 }).then(({ data }) => setJustificatifs(unwrapList(data))).catch(() => {});
    if (peutVoirPaiements) {
      fraisApi.list({ eleve: eleve.id, page_size: 200 }).then(({ data }) => setFrais(unwrapList(data))).catch(() => {});
    }
    periodesApi.list().then(({ data }) => setPeriodes(unwrapList(data))).catch(() => {});
    anneesApi.list().then(({ data }) => {
      const liste = unwrapList(data);
      setAnnees(liste);
      const active = liste.find((a) => a.active);
      if (!active) return;
      setAnneeActiveId(active.id);
      setAnneeNotesFilter((prev) => (prev === "" ? active.id : prev));
      bulletinApi.get(eleve.id, { annee_scolaire: active.id }).then(({ data }) => setBulletin(data)).catch(() => {});
      if (peutVoirPaiements) {
        setSuiviMensuelLoading(true);
        setSuiviMensuelError("");
        fraisApi.suiviMensuel(eleve.id, active.id)
          .then(({ data }) => setSuiviMensuel(data.mois))
          // Erreur silencieuse jusqu'ici (`.catch(() => {})`) : la carte disparaissait sans
          // aucune indication, ce qui pouvait donner l'impression que les mois impayés
          // n'existaient pas alors qu'il s'agissait d'une erreur de chargement (ex: aucune année
          // scolaire active, accès refusé...). Affichée maintenant sous la carte (voir plus bas).
          .catch((err) => setSuiviMensuelError(extractErrorMessage(err)))
          .finally(() => { setSuiviMensuelLoading(false); setSuiviMensuelCharge(true); });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eleve, peutVoirPaiements]);

  const handleRecu = async () => {
    if (!eleve) return;
    setRecuLoading(true);
    try {
      await elevesApi.recuInscription(eleve.id, `recu_inscription_${eleve.matricule}.pdf`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setRecuLoading(false);
    }
  };

  const handleCertificat = async () => {
    if (!eleve) return;
    setCertificatLoading(true);
    try {
      await elevesApi.certificatScolarite(eleve.id, `certificat_scolarite_${eleve.matricule}.pdf`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setCertificatLoading(false);
    }
  };

  const handleBulletinPdf = () => setBulletinPreviewOpen(true);
  const handleProformaPdf = () => setProformaPreviewOpen(true);

  const handleCategorieChange = async (categorie: CategoriePaiement, fidelite: boolean) => {
    if (!eleve) return;
    setCategorieSaving(true);
    try {
      const { data } = await elevesApi.setCategoriePaiement(eleve.id, {
        categorie_paiement: categorie, reduction_fidelite_mensualite: fidelite,
      });
      setEleve(data);
      // Le facteur applicable a pu changer (ex: passage en Fondation gratuite) — le suivi mensuel
      // affiché doit refléter la nouvelle situation sans attendre un rechargement de page.
      if (anneeActiveId) {
        fraisApi.suiviMensuel(eleve.id, anneeActiveId).then(({ data }) => setSuiviMensuel(data.mois)).catch(() => {});
      }
      toast.success("Statut de paiement mis à jour.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setCategorieSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (notFound || !eleve) {
    return (
      <div>
        <EmptyState title="Élève introuvable" description="Il n'existe pas ou vous n'y avez pas accès." />
        <div className="text-center mt-4">
          <Link to="/eleves" className="text-sm text-brand-600 font-medium hover:underline">← Retour à la liste des élèves</Link>
        </div>
      </div>
    );
  }

  // f.montant_du (pas f.montant, qui reste le tarif standard non réduit) — sinon cette page
  // continuait d'afficher le montant plein même pour un élève Fondation 50%/réduction fidélité,
  // sans refléter la catégorie de paiement choisie ci-dessous.
  const totalDu = frais.reduce((sum, f) => sum + Number(f.montant_du), 0);
  const totalPaye = frais.reduce((sum, f) => sum + Number(f.montant_paye), 0);
  const totalSolde = frais.reduce((sum, f) => sum + Number(f.solde), 0);
  // Pour ces deux catégories, la mensualité due est déjà à 0% (voir EleveProfile.facteur_mensualite
  // côté backend) : cocher la réduction fidélité (×0,95) ne change rien (0 × 0,95 = 0). Sans ce
  // garde-fou, la case restait cliquable mais semblait « ne rien faire » — confusion signalée.
  const fideliteSansEffet = eleve.categorie_paiement === "fondation_gratuit" || eleve.categorie_paiement === "inscription_seulement";

  // Onglet Notes : périodes de l'année scolaire choisie, et notes filtrées en conséquence
  // (par année, puis par trimestre si un trimestre précis est sélectionné).
  const periodeById = new Map(periodes.map((p) => [p.id, p]));
  const periodesDeLAnnee = periodes.filter((p) => !anneeNotesFilter || p.annee_scolaire === anneeNotesFilter);
  const notesFiltrees = notes.filter((n) => {
    if (periodeNotesFilter) return n.periode === periodeNotesFilter;
    if (anneeNotesFilter) return periodeById.get(n.periode)?.annee_scolaire === anneeNotesFilter;
    return true;
  });

  // Onglet Historique : parcours de l'élève depuis son inscription, reconstitué à partir des
  // évènements déjà datés dont on dispose (inscription, paiements, justificatifs soumis,
  // emprunts, affectation transport, sortie) — plutôt que les notes/présences, trop nombreuses
  // pour une vue « grandes étapes ». Trié du plus ancien au plus récent pour se lire comme un
  // vrai parcours.
  const historique: EvenementHistorique[] = [];
  if (eleve.date_inscription) {
    historique.push({
      date: eleve.date_inscription,
      icone: "🎓",
      titre: STATUT_INSCRIPTION_LABELS[eleve.statut_inscription] || "Inscription à l'établissement",
      detail: eleve.classe_nom ? `Classe : ${eleve.classe_nom}` : undefined,
    });
  }
  frais.forEach((f) => {
    f.paiements.forEach((p) => {
      historique.push({
        date: p.date_paiement,
        icone: "💳",
        titre: `Paiement — ${f.type_frais_nom}`,
        detail: `${money(p.montant)} · ${MODE_PAIEMENT_LABELS[p.mode_paiement] || p.mode_paiement}${p.reference ? ` · Réf. ${p.reference}` : ""}`,
      });
    });
  });
  justificatifs.forEach((j) => {
    historique.push({
      date: j.cree_le,
      icone: "📋",
      titre: `Justificatif d'absence soumis (${MOTIF_JUSTIFICATIF_LABELS[j.motif] || j.motif})`,
      detail: `Absence du ${new Date(j.date_absence).toLocaleDateString("fr-FR")}`,
      badge: JUSTIFICATIF_LABELS[j.statut] ? { label: JUSTIFICATIF_LABELS[j.statut].label, color: JUSTIFICATIF_LABELS[j.statut].color } : undefined,
    });
  });
  emprunts.forEach((e) => {
    historique.push({ date: e.date_emprunt, icone: "📖", titre: `Emprunt — ${e.livre_titre}` });
    if (e.date_retour_effective) {
      historique.push({ date: e.date_retour_effective, icone: "📗", titre: `Retour de livre — ${e.livre_titre}` });
    }
  });
  affectations.forEach((a) => {
    historique.push({
      date: a.date_debut, icone: "🚌",
      titre: `Affecté(e) au transport — ${a.trajet_nom}`,
      detail: a.point_montee ? `Point de montée : ${a.point_montee}` : undefined,
    });
  });
  if (eleve.date_sortie) {
    historique.push({ date: eleve.date_sortie, icone: "🚪", titre: "Sortie de l'établissement", detail: eleve.motif_sortie || undefined });
  }
  historique.sort((a, b) => a.date.localeCompare(b.date));

  const TABS: { key: TabKey; label: string }[] = [
    { key: "apercu", label: "Aperçu" },
    { key: "historique", label: `Historique (${historique.length})` },
    { key: "notes", label: `Notes (${notes.length})` },
    { key: "presences", label: `Présences (${presences.length})` },
    ...(peutVoirPaiements ? [{ key: "paiements" as TabKey, label: `Paiements (${frais.length})` }] : []),
    { key: "transport", label: `Transport (${affectations.length})` },
    { key: "bibliotheque", label: `Bibliothèque (${emprunts.length})` },
    { key: "justificatifs", label: `Justificatifs (${justificatifs.length})` },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        {eleve.user.photo ? (
          <img src={eleve.user.photo} alt="" className="h-14 w-14 rounded-2xl object-cover shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-bold shrink-0">
            {initials(eleve.user.first_name, eleve.user.last_name)}
          </div>
        )}
        <PageHeader
          title={`${eleve.user.first_name} ${eleve.user.last_name}`}
          description={`${eleve.matricule} · ${eleve.classe_nom || "Classe non assignée"}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/eleves" className="text-sm text-brand-600 font-medium hover:underline mr-2">← Retour</Link>
              {isAdmin && (
                <Button variant="secondary" onClick={() => navigate("/eleves", { state: { editEleveId: eleve.id } })}>
                  ✏️ Modifier
                </Button>
              )}
              <Button variant="secondary" onClick={handleRecu} disabled={recuLoading}>
                {recuLoading ? "…" : "🧾 Reçu d'inscription"}
              </Button>
              <Button variant="secondary" onClick={handleCertificat} disabled={certificatLoading}>
                {certificatLoading ? "…" : "🎓 Certificat de scolarité"}
              </Button>
              {bulletin && (
                <Button onClick={handleBulletinPdf}>👁️ Aperçu du bulletin</Button>
              )}
            </div>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Badge color={eleve.actif ? "green" : "rose"}>{eleve.actif ? "Actif" : "Inactif"}</Badge>
        <Badge color="brand">{REGIME_LABELS[eleve.regime]}</Badge>
        <Badge color="slate">{STATUT_INSCRIPTION_LABELS[eleve.statut_inscription]}</Badge>
        <span className="text-sm text-slate-500">{eleve.user.email || eleve.user.phone || "—"}</span>
        <span className="text-sm text-slate-400">Inscrit le {new Date(eleve.date_inscription).toLocaleDateString("fr-FR")}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Moyenne générale (année en cours)"
          value={bulletin?.moyenne_generale !== null && bulletin?.moyenne_generale !== undefined ? `${bulletin.moyenne_generale}/20` : "—"}
          icon="📊" accent="brand"
        />
        <StatCard
          label="Taux de présence"
          value={presenceStats?.taux_presence !== null && presenceStats?.taux_presence !== undefined ? `${presenceStats.taux_presence}%` : "—"}
          icon="✅" accent="green"
        />
        {peutVoirPaiements ? (
          <StatCard label="Solde à payer" value={money(totalSolde)} icon="💳" accent={totalSolde > 0 ? "rose" : "green"} />
        ) : (
          <StatCard label="Emprunts en cours" value={emprunts.filter((e) => e.statut !== "rendu").length} icon="📚" accent="teal" />
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.key ? "bg-brand-600 text-white shadow-soft" : "bg-white text-slate-600 border border-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "apercu" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Informations personnelles</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Sexe</span><span className="font-semibold">{eleve.user.sexe === "M" ? "Masculin" : eleve.user.sexe === "F" ? "Féminin" : "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Date de naissance</span><span className="font-semibold">{eleve.user.date_of_birth ? new Date(eleve.user.date_of_birth).toLocaleDateString("fr-FR") : "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Lieu de naissance</span><span className="font-semibold">{eleve.lieu_naissance || "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Adresse</span><span className="font-semibold text-right">{eleve.user.address || "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Téléphone</span><span className="font-semibold">{eleve.user.phone || "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Email</span><span className="font-semibold">{eleve.user.email || "—"}</span></div>
            </div>
          </Card>
          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Filiation & responsable</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Nom du père</span><span className="font-semibold">{eleve.nom_pere || "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nom de la mère</span><span className="font-semibold">{eleve.nom_mere || "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Tuteur(rice)</span><span className="font-semibold">{eleve.nom_tuteur || "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Parent lié au compte</span><span className="font-semibold">{eleve.parent_nom || "—"}</span></div>
              {eleve.parent_nom && (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Identifiant du parent</span><span className="font-mono text-xs font-semibold">{eleve.parent_username || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Téléphone du parent</span><span className="font-semibold">{eleve.parent_telephone || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Email du parent</span><span className="font-semibold">{eleve.parent_email || "—"}</span></div>
                </>
              )}
              {eleve.date_sortie && (
                <div className="flex justify-between"><span className="text-slate-500">Date de sortie</span><span className="font-semibold text-rose-600">{new Date(eleve.date_sortie).toLocaleDateString("fr-FR")}{eleve.motif_sortie ? ` — ${eleve.motif_sortie}` : ""}</span></div>
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === "historique" && (
        historique.length === 0 ? (
          <EmptyState title="Aucun évènement enregistré" description="Le parcours de l'élève apparaîtra ici au fil du temps." />
        ) : (
          <div className="relative pl-6 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
            <div className="space-y-5">
              {historique.map((ev, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full bg-brand-500 ring-4 ring-brand-100" />
                  <p className="text-xs font-semibold text-slate-400 mb-1">
                    {new Date(ev.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
                  </p>
                  <div className="bg-white rounded-xl border border-slate-100 shadow-soft px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-700">
                        <span className="mr-1.5">{ev.icone}</span>{ev.titre}
                      </p>
                      {ev.badge && <Badge color={ev.badge.color}>{ev.badge.label}</Badge>}
                    </div>
                    {ev.detail && <p className="text-xs text-slate-500 mt-1">{ev.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {tab === "notes" && (
        <div>
          <div className="flex flex-wrap gap-3 mb-4">
            <Select
              label="Année scolaire"
              value={anneeNotesFilter}
              onChange={(e) => {
                setAnneeNotesFilter(e.target.value ? Number(e.target.value) : "");
                setPeriodeNotesFilter("");
              }}
              className="max-w-xs"
            >
              <option value="">Toutes les années</option>
              {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
            </Select>
            <Select
              label="Trimestre"
              value={periodeNotesFilter}
              onChange={(e) => setPeriodeNotesFilter(e.target.value ? Number(e.target.value) : "")}
              className="max-w-xs"
            >
              <option value="">Tous les trimestres</option>
              {periodesDeLAnnee.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </Select>
          </div>
          {notesFiltrees.length === 0 ? (
            <EmptyState title="Aucune note enregistrée" description="Aucune note pour cette période." />
          ) : (
            <Table headers={["Matière", "Période", "Type", "Note", "Coeff.", "Date"]}>
              {notesFiltrees.map((n) => (
                <tr key={n.id}>
                  <td className="px-4 py-3 font-medium text-slate-700">{n.matiere_nom}</td>
                  <td className="px-4 py-3 text-slate-500">{n.periode_nom}</td>
                  <td className="px-4 py-3 text-slate-500 capitalize">{n.type_evaluation}</td>
                  <td className="px-4 py-3 font-semibold">{n.valeur}/20</td>
                  <td className="px-4 py-3 text-slate-500">{n.coefficient}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{new Date(n.date).toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}

      {tab === "presences" && (
        <div>
          {presenceStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <StatCard label="Présences" value={presenceStats.presents ?? 0} icon="✅" accent="green" />
              <StatCard label="Absences" value={presenceStats.absents ?? 0} icon="🚫" accent="rose" />
              <StatCard label="Retards" value={presenceStats.retards ?? 0} icon="⏰" accent="amber" />
              <StatCard label="Absences injustifiées" value={presenceStats.absences_injustifiees ?? 0} icon="⚠️" accent="rose" />
            </div>
          )}
          {presences.length === 0 ? <EmptyState title="Aucune présence enregistrée" /> : (
            <Table headers={["Date", "Statut", "Justifié", "Motif"]}>
              {presences.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-slate-500">{new Date(p.date).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3"><Badge color={PRESENCE_LABELS[p.statut]?.color || "slate"}>{PRESENCE_LABELS[p.statut]?.label || p.statut}</Badge></td>
                  <td className="px-4 py-3">{p.justifie ? "Oui" : "Non"}</td>
                  <td className="px-4 py-3 text-slate-500">{p.motif || "—"}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}

      {tab === "paiements" && peutVoirPaiements && (
        <div>
          <div className="flex justify-end mb-3">
            <Button variant="secondary" onClick={handleProformaPdf} disabled={frais.length === 0}>
              📄 Facture proforma
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <StatCard label="Total dû" value={money(totalDu)} icon="🏦" accent="brand" />
            <StatCard label="Total payé" value={money(totalPaye)} icon="💰" accent="green" />
            <StatCard label="Solde restant" value={money(totalSolde)} icon="📉" accent={totalSolde > 0 ? "rose" : "green"} />
          </div>

          <Card className="mb-4">
            <h3 className="font-bold text-ink-900 mb-1">Statut de paiement (mensualité)</h3>
            <p className="text-xs text-slate-400 mb-3">
              N'affecte que les frais mensuels (scolarité) — cantine, transport et inscription restent facturés normalement.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="Catégorie"
                value={eleve.categorie_paiement}
                disabled={categorieSaving}
                onChange={(e) => handleCategorieChange(e.target.value as CategoriePaiement, eleve.reduction_fidelite_mensualite)}
                className="max-w-xs"
              >
                {Object.entries(CATEGORIE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
              <label
                className={`flex items-center gap-2 text-sm ${fideliteSansEffet ? "text-slate-400 cursor-not-allowed" : "text-slate-600"}`}
                title={fideliteSansEffet ? "Sans effet pour cette catégorie : la mensualité est déjà à 0%." : undefined}
              >
                <input
                  type="checkbox"
                  checked={eleve.reduction_fidelite_mensualite}
                  disabled={categorieSaving || fideliteSansEffet}
                  onChange={(e) => handleCategorieChange(eleve.categorie_paiement, e.target.checked)}
                  className="rounded border-slate-300"
                />
                Réduction fidélité (5%, paie tous les mois)
              </label>
            </div>
            {fideliteSansEffet && (
              <p className="text-xs text-amber-600 mt-2">
                ⓘ Sans effet pour « {CATEGORIE_LABELS[eleve.categorie_paiement]} » : la mensualité due est déjà à 0%, une réduction supplémentaire ne change rien.
              </p>
            )}
            <p className="text-xs text-slate-400 mt-3">
              Montant effectivement dû sur la mensualité : <span className="font-semibold text-slate-600">{Math.round(Number(eleve.facteur_mensualite) * 100)}%</span> du tarif standard.
            </p>
          </Card>

          {frais.length === 0 ? <EmptyState title="Aucun frais enregistré" /> : (
            <Table headers={["Type", "Montant", "Payé", "Solde", "Échéance", "Statut"]}>
              {frais.map((f) => (
                <tr key={f.id}>
                  <td className="px-4 py-3 font-medium text-slate-700">{f.type_frais_nom}</td>
                  <td className="px-4 py-3">{money(f.montant)}</td>
                  <td className="px-4 py-3 text-green-600">{money(f.montant_paye)}</td>
                  <td className="px-4 py-3 font-medium">{money(f.solde)}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(f.date_echeance).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-3"><Badge color={FRAIS_LABELS[f.statut]?.color || "slate"}>{FRAIS_LABELS[f.statut]?.label || f.statut}</Badge></td>
                </tr>
              ))}
            </Table>
          )}

          {suiviMensuelCharge && (
            <Card className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-ink-900">Mois payés / non payés (scolarité)</h3>
                {anneeActiveId && suiviMensuel.length > 0 && (
                  <button
                    onClick={() => fraisApi.suiviMensuelPdf(eleve.id, `suivi_mensuel_${eleve.matricule}.pdf`, anneeActiveId)}
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    📄 Rapport de suivi (PDF)
                  </button>
                )}
              </div>
              {suiviMensuelLoading ? (
                <div className="flex justify-center py-6"><Spinner /></div>
              ) : suiviMensuelError ? (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{suiviMensuelError}</p>
              ) : suiviMensuel.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Aucun frais mensuel (scolarité) configuré pour cet élève sur l'année scolaire active — rien à suivre mois par mois.
                </p>
              ) : (
                <>
                  {/* Grille fixe (plusieurs mois par ligne) plutôt qu'une frise chronologique
                      unique qui s'étire horizontalement — tous les mois restent visibles d'un
                      coup, sans avoir à faire défiler la page latéralement. */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {suiviMensuel.map((m) => (
                      <div
                        key={m.mois}
                        title={`${money(m.montant_paye)} sur ${money(m.montant_du)}`}
                        className={
                          "px-3 py-2 rounded-lg border-2 text-xs font-medium text-center " +
                          (m.statut === "paye"
                            ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                            : m.statut === "partiel"
                              ? "bg-amber-100 text-amber-700 border-amber-300"
                              : "bg-rose-100 text-rose-700 border-rose-300")
                        }
                      >
                        {new Date(`${m.mois}-01`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Payé</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Partiellement payé</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Non payé</span>
                  </div>
                </>
              )}
            </Card>
          )}

          <div className="text-right mt-3">
            <Link to="/paiements" className="text-sm text-brand-600 font-medium hover:underline">Gérer les paiements →</Link>
          </div>
        </div>
      )}

      {tab === "transport" && (
        affectations.length === 0 ? <EmptyState title="Aucune affectation de transport" /> : (
          <Table headers={["Trajet", "Point de montée", "Depuis le"]}>
            {affectations.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{a.trajet_nom}</td>
                <td className="px-4 py-3 text-slate-500">{a.point_montee || "—"}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(a.date_debut).toLocaleDateString("fr-FR")}</td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === "bibliotheque" && (
        emprunts.length === 0 ? <EmptyState title="Aucun emprunt enregistré" /> : (
          <Table headers={["Livre", "Emprunté le", "Retour prévu", "Retour effectif", "Statut"]}>
            {emprunts.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{e.livre_titre}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(e.date_emprunt).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(e.date_retour_prevue).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{e.date_retour_effective ? new Date(e.date_retour_effective).toLocaleDateString("fr-FR") : "—"}</td>
                <td className="px-4 py-3"><Badge color={EMPRUNT_LABELS[e.statut]?.color || "slate"}>{EMPRUNT_LABELS[e.statut]?.label || e.statut}</Badge></td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === "justificatifs" && (
        justificatifs.length === 0 ? <EmptyState title="Aucun justificatif d'absence" /> : (
          <Table headers={["Date d'absence", "Motif", "Description", "Statut", "Traité par"]}>
            {justificatifs.map((j) => (
              <tr key={j.id}>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(j.date_absence).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 capitalize">{j.motif}</td>
                <td className="px-4 py-3 text-slate-500">{j.description || "—"}</td>
                <td className="px-4 py-3"><Badge color={JUSTIFICATIF_LABELS[j.statut]?.color || "slate"}>{JUSTIFICATIF_LABELS[j.statut]?.label || j.statut}</Badge></td>
                <td className="px-4 py-3 text-slate-500 text-xs">{j.traite_par_nom || "—"}</td>
              </tr>
            ))}
          </Table>
        )
      )}

      <PdfPreviewModal
        open={bulletinPreviewOpen}
        onClose={() => setBulletinPreviewOpen(false)}
        title={`Bulletin — ${eleve.user.first_name} ${eleve.user.last_name}`}
        load={() => {
          if (!anneeActiveId) return Promise.reject(new Error("Aucune année scolaire active."));
          return bulletinApi.previewPdf(eleve.id, { annee_scolaire: anneeActiveId }, `bulletin_${eleve.matricule}.pdf`);
        }}
      />
      <PdfPreviewModal
        open={proformaPreviewOpen}
        onClose={() => setProformaPreviewOpen(false)}
        title={`Facture proforma — ${eleve.user.first_name} ${eleve.user.last_name}`}
        load={() => fraisApi.previewProformaPdf(eleve.id, `proforma_${eleve.matricule}.pdf`, anneeActiveId ?? undefined)}
      />
    </div>
  );
}
