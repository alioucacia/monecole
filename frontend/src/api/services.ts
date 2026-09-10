import { api } from "./client";
import type {
  AffectationTransport, AgentCantineInfo, Annonce, AnneeScolaire, Bulletin, CaisseRapport, CategorieDepense, CategoriePaiement, Classe, Creneau, Depense, Ecole, EcoleStatsDetail,
  EcoleStatsGlobales, EcoleUtilisateur, EleveProfile,
  Emprunt, Enseignement, EnseignantProfile, Fonctionnalite, Formule, Frais, InscriptionCantine, JournalActiviteEntry, JournalUtilisateurEntry, Livre, Matiere, Message, ModeleMessage, Note, Paginated,
  AlerteParent, AnalysePerformance, ChauffeurInfo, EleveBadge, EnseignantBadge, GroupeRevision, JustificatifAbsence, MessageIA, PaiementEcole, Paiement, PaieEnseignant, ParametresPlateforme, Periode, PlanAbonnement, PlateformeBranding,
  PointageEnseignant, Presence, RechercheGlobaleResult, Reunion, Participant, Resultats, SauvegardeLog, SuiviMensuelClasse, SuiviMensuelEleve, SupervisionData, TarifClasse, Ticket, TicketBus, TicketCantine, MessageTicket, Trajet, TypeFrais, User,
} from "../types";

// ---- Plateforme (Super Admin) ----
export const ecolesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Ecole> | Ecole[]>("/tenants/ecoles/", { params }),
  get: (id: number) => api.get<Ecole>(`/tenants/ecoles/${id}/`),
  create: (data: Record<string, unknown>) => api.post<Ecole>("/tenants/ecoles/", toFormData(data), multipartHeaders),
  update: (id: number, data: Record<string, unknown>) => api.patch<Ecole>(`/tenants/ecoles/${id}/`, toFormData(data), multipartHeaders),
  remove: (id: number) => api.delete(`/tenants/ecoles/${id}/`),
  stats: () => api.get<EcoleStatsGlobales>("/tenants/ecoles/stats/"),
  statsDetail: (id: number) => api.get<EcoleStatsDetail>(`/tenants/ecoles/${id}/stats-detail/`),
  utilisateurs: (id: number) => api.get<EcoleUtilisateur[]>(`/tenants/ecoles/${id}/utilisateurs/`),
  export: (params?: Record<string, unknown>) => downloadFile("/tenants/ecoles/export/", params || {}, "ecoles.csv"),
  relancerRetard: () => api.post<{ relances: number }>("/tenants/ecoles/relancer-retard/"),
  seConnecterCommeAdmin: (id: number) => api.post<{ access: string; refresh: string; user: User }>(`/tenants/ecoles/${id}/se-connecter-comme-admin/`),
};

export const rechercheGlobaleApi = {
  chercher: (q: string) => api.get<RechercheGlobaleResult[]>("/tenants/recherche-globale/", { params: { q } }),
};

export const plansAbonnementApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<PlanAbonnement> | PlanAbonnement[]>("/tenants/plans-abonnement/", { params: { page_size: 100, ...params } }),
  create: (data: Partial<PlanAbonnement>) => api.post<PlanAbonnement>("/tenants/plans-abonnement/", data),
  update: (id: number, data: Partial<PlanAbonnement>) => api.patch<PlanAbonnement>(`/tenants/plans-abonnement/${id}/`, data),
  remove: (id: number) => api.delete(`/tenants/plans-abonnement/${id}/`),
};

export const comptesSuperAdminApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<User> | User[]>("/auth/comptes-superadmin/", { params }),
  create: (data: Record<string, unknown>) => api.post<User>("/auth/comptes-superadmin/", data),
  update: (id: number, data: Partial<User>) => api.patch<User>(`/auth/comptes-superadmin/${id}/`, data),
  remove: (id: number) => api.delete(`/auth/comptes-superadmin/${id}/`),
};

export const journalActiviteApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<JournalActiviteEntry> | JournalActiviteEntry[]>("/tenants/journal-activite/", { params }),
};

export const paiementsEcolesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<PaiementEcole> | PaiementEcole[]>("/tenants/paiements-ecoles/", { params }),
  create: (data: { ecole: number; mois: string; montant: string; mode_paiement: string; reference?: string }) =>
    api.post<PaiementEcole>("/tenants/paiements-ecoles/", data),
  export: (params?: Record<string, unknown>) => downloadFile("/tenants/paiements-ecoles/export/", params || {}, "transactions_ecoles.csv"),
  facture: (id: number, filename: string) => downloadFile(`/tenants/paiements-ecoles/${id}/facture/`, {}, filename),
};

// ---- Mon école (paramétrage par l'admin de l'établissement) ----
export const parametresEcoleApi = {
  get: () => api.get<Ecole>("/tenants/mon-ecole/"),
  update: (data: Record<string, unknown>) => api.patch<Ecole>("/tenants/mon-ecole/", data),
};

// ---- Paramètres plateforme (Super Admin) ----
export const parametresPlateformeApi = {
  get: () => api.get<ParametresPlateforme>("/tenants/parametres-plateforme/"),
  update: (data: Record<string, unknown>) => api.patch<ParametresPlateforme>("/tenants/parametres-plateforme/", data),
};

/** Nom + logo de la plateforme — publics, utilisés pour l'affichage (page de connexion,
 * barre latérale) par tous les rôles, contrairement au reste de `parametresPlateformeApi`. */
export const plateformeBrandingApi = {
  get: () => api.get<PlateformeBranding>("/tenants/plateforme-branding/"),
};

/** Registre des fonctionnalités optionnelles activables/désactivables par école (voir
 * `Ecole.fonctionnalites_desactivees`) — lu par EcoleDetailPage pour construire ses cases
 * à cocher sans dupliquer la liste des clés/labels côté frontend. */
export const fonctionnalitesApi = {
  list: () => api.get<Fonctionnalite[]>("/tenants/fonctionnalites-disponibles/"),
};

// ---- Annuaire global des utilisateurs (Super Admin) ----
export const annuaireUtilisateursApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<User> | User[]>("/tenants/annuaire-utilisateurs/", { params }),
  reinitialiserMotDePasse: (id: number) =>
    api.post<{ nouveau_mot_de_passe: string; email_envoye: boolean }>(`/tenants/annuaire-utilisateurs/${id}/reinitialiser-mot-de-passe/`),
};

// ---- Sauvegardes (Super Admin) ----
export const sauvegardesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<SauvegardeLog> | SauvegardeLog[]>("/dashboard/sauvegardes/", { params }),
  lancer: () => api.post<SauvegardeLog>("/dashboard/sauvegardes/lancer/"),
  telecharger: (id: number, filename: string) => downloadFile(`/dashboard/sauvegardes/${id}/telecharger/`, {}, filename),
};

// ---- Supervision technique (Super Admin) ----
export const supervisionApi = {
  get: () => api.get<SupervisionData>("/dashboard/supervision/"),
};

// ---- Auth ----
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ access: string; refresh: string; user: User }>("/auth/login/", { username, password }),
  me: () => api.get<User>("/auth/me/"),
  updateMe: (data: Partial<User>) => api.patch<User>("/auth/me/", data),
  changePassword: (old_password: string, new_password: string) =>
    api.post("/auth/change-password/", { old_password, new_password }),
  requestPasswordReset: (email: string) =>
    api.post<{ detail: string }>("/auth/password-reset/", { email }),
  confirmPasswordReset: (uid: string, token: string, new_password: string) =>
    api.post<{ detail: string }>("/auth/password-reset-confirm/", { uid, token, new_password }),
  /** Upload de la photo de profil (multipart) — utilisée ensuite sur les badges. */
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return api.patch<User>("/auth/me/", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
};

// ---- Dashboard ----
export const dashboardApi = {
  get: () => api.get<Record<string, any>>("/dashboard/"),
};

// ---- Users (admin) ----
export const usersApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<User> | User[]>("/auth/users/", { params }),
  create: (data: Record<string, unknown>) => api.post<User>("/auth/users/", data),
  update: (id: number, data: Partial<User>) => api.patch<User>(`/auth/users/${id}/`, data),
  remove: (id: number) => api.delete(`/auth/users/${id}/`),
  reinitialiserMotDePasse: (id: number) =>
    api.post<{ nouveau_mot_de_passe: string; email_envoye: boolean }>(`/auth/users/${id}/reinitialiser-mot-de-passe/`),
  journal: (id: number, params?: Record<string, unknown>) =>
    api.get<Paginated<JournalUtilisateurEntry>>(`/auth/users/${id}/journal/`, { params }),
};

/** Suit un lien "next"/"previous" absolu renvoyé par la pagination DRF. */
export const fetchUrl = <T,>(url: string) => api.get<T>(url);

/** Convertit un objet simple en FormData (nécessaire dès qu'un champ peut être un fichier,
 * ex: la photo d'un élève/enseignant) — `null` devient une chaîne vide (DRF la traite comme
 * `None` pour les champs `allow_null` sur une requête multipart). */
function toFormData(data: Record<string, unknown>): FormData {
  const form = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null) {
      form.append(key, "");
      return;
    }
    if (value instanceof File) {
      form.append(key, value);
      return;
    }
    // DRF désérialise un JSONField multipart avec `json.loads(...)` : un tableau/objet doit
    // donc être envoyé en JSON, pas en `String(...)` (qui donnerait "a,b" pour un tableau).
    if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
      form.append(key, JSON.stringify(value));
      return;
    }
    form.append(key, String(value));
  });
  return form;
}
const multipartHeaders = { headers: { "Content-Type": "multipart/form-data" } };

/**
 * Télécharge un fichier depuis un endpoint protégé par JWT (le header Authorization
 * n'étant pas envoyé par un simple lien, on récupère le blob via axios puis on
 * déclenche l'enregistrement navigateur).
 */
/** Récupère un fichier (PDF, CSV…) en `Blob` sans déclencher de téléchargement — utilisé pour
 * l'aperçu (ex: `PdfPreviewModal`) autant que par `downloadFile` ci-dessous. */
export async function fetchBlob(url: string, params: Record<string, unknown>, fallbackFilename: string) {
  const response = await api.get(url, { params, responseType: "blob" });
  const disposition = response.headers["content-disposition"] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || fallbackFilename;
  return { blob: response.data as Blob, filename };
}

export async function downloadFile(url: string, params: Record<string, unknown>, fallbackFilename: string) {
  const { blob, filename } = await fetchBlob(url, params, fallbackFilename);
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

// ---- Academics ----
export const anneesApi = {
  list: () => api.get<Paginated<AnneeScolaire> | AnneeScolaire[]>("/academics/annees-scolaires/", { params: { page_size: 100 } }),
  create: (data: Partial<AnneeScolaire>) => api.post<AnneeScolaire>("/academics/annees-scolaires/", data),
  update: (id: number, data: Partial<AnneeScolaire>) => api.patch<AnneeScolaire>(`/academics/annees-scolaires/${id}/`, data),
  remove: (id: number) => api.delete(`/academics/annees-scolaires/${id}/`),
};

export const matieresApi = {
  list: () => api.get<Paginated<Matiere> | Matiere[]>("/academics/matieres/", { params: { page_size: 100 } }),
  create: (data: Partial<Matiere>) => api.post<Matiere>("/academics/matieres/", data),
  update: (id: number, data: Partial<Matiere>) => api.patch<Matiere>(`/academics/matieres/${id}/`, data),
  remove: (id: number) => api.delete(`/academics/matieres/${id}/`),
};

export const classesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Classe> | Classe[]>("/academics/classes/", { params }),
  get: (id: number) => api.get<Classe>(`/academics/classes/${id}/`),
  create: (data: Partial<Classe>) => api.post<Classe>("/academics/classes/", data),
  update: (id: number, data: Partial<Classe>) => api.patch<Classe>(`/academics/classes/${id}/`, data),
  remove: (id: number) => api.delete(`/academics/classes/${id}/`),
  devinerCycles: (forcer = false) =>
    api.post<{ classes_affectees: number }>("/academics/classes/deviner-cycles/", null, { params: forcer ? { forcer: "true" } : undefined }),
};

export const enseignementsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Enseignement> | Enseignement[]>("/academics/enseignements/", { params }),
  create: (data: Partial<Enseignement>) => api.post<Enseignement>("/academics/enseignements/", data),
  remove: (id: number) => api.delete(`/academics/enseignements/${id}/`),
};

export const creneauxApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Creneau> | Creneau[]>("/academics/creneaux/", { params }),
  create: (data: Partial<Creneau>) => api.post<Creneau>("/academics/creneaux/", data),
  update: (id: number, data: Partial<Creneau>) => api.patch<Creneau>(`/academics/creneaux/${id}/`, data),
  remove: (id: number) => api.delete(`/academics/creneaux/${id}/`),
};

// ---- People ----
export const elevesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<EleveProfile> | EleveProfile[]>("/people/eleves/", { params }),
  get: (id: number) => api.get<EleveProfile>(`/people/eleves/${id}/`),
  create: (data: Record<string, unknown>) => api.post<EleveProfile>("/people/eleves/", toFormData(data), multipartHeaders),
  update: (id: number, data: Record<string, unknown>) => api.patch<EleveProfile>(`/people/eleves/${id}/`, toFormData(data), multipartHeaders),
  remove: (id: number) => api.delete(`/people/eleves/${id}/`),
  exportCsv: (params?: Record<string, unknown>) => downloadFile("/people/eleves/export/", params || {}, "eleves.csv"),
  exportPdf: (params?: Record<string, unknown>) => downloadFile("/people/eleves/export-pdf/", params || {}, "eleves.pdf"),
  reinscription: (data: {
    eleves: number[]; classe_destination: number; type_frais?: number | null;
    montant_frais?: string | null; date_echeance_frais?: string | null;
  }) => api.post<{ reinscrits: number; frais_crees: number; classe_destination: string }>("/people/eleves/reinscription/", data),
  marquerNonReinscrit: (id: number, motif?: string) =>
    api.post<EleveProfile>(`/people/eleves/${id}/marquer-non-reinscrit/`, { motif: motif || "" }),
  reactiver: (id: number) => api.post<EleveProfile>(`/people/eleves/${id}/reactiver/`),
  recuInscription: (id: number, filename: string) => downloadFile(`/people/eleves/${id}/recu-inscription/`, {}, filename),
  certificatScolarite: (id: number, filename: string) => downloadFile(`/people/eleves/${id}/certificat-scolarite/`, {}, filename),
  /** Catégorie de prise en charge de la mensualité (Fondation 50%/gratuit/inscription seulement)
   * et réduction fidélité — accessible à la comptabilité sans droit d'édition du reste de la fiche. */
  setCategoriePaiement: (id: number, data: { categorie_paiement: CategoriePaiement; reduction_fidelite_mensualite: boolean }) =>
    api.patch<EleveProfile>(`/people/eleves/${id}/categorie-paiement/`, data),
  /** Modèle Excel (.xlsx) à remplir pour l'import en masse — voir importExcel. */
  importExcelModele: (filename: string) => downloadFile("/people/eleves/import-excel-modele/", {}, filename),
  /** Import en masse d'élèves depuis un fichier Excel (.xlsx) — chaque ligne est traitée
   * indépendamment, la réponse liste les lignes créées et celles en échec avec leur motif. */
  importExcel: (fichier: File) => {
    const form = new FormData();
    form.append("fichier", fichier);
    return api.post<{ crees: number; total_lignes: number; erreurs: { ligne: number; message: string }[] }>(
      "/people/eleves/import-excel/", form, { headers: { "Content-Type": "multipart/form-data" } }
    );
  },
};

export const enseignantsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<EnseignantProfile> | EnseignantProfile[]>("/people/enseignants/", { params }),
  create: (data: Record<string, unknown>) => api.post<EnseignantProfile>("/people/enseignants/", toFormData(data), multipartHeaders),
  update: (id: number, data: Record<string, unknown>) => api.patch<EnseignantProfile>(`/people/enseignants/${id}/`, toFormData(data), multipartHeaders),
  remove: (id: number) => api.delete(`/people/enseignants/${id}/`),
};

export const badgesApi = {
  list: () => api.get<Paginated<EleveBadge> | EleveBadge[]>("/people/badges/", { params: { page_size: 100 } }),
  create: (eleve: number) => api.post<EleveBadge>("/people/badges/", { eleve }),
  qr: (id: number) => api.get<Blob>(`/people/badges/${id}/qr/`, { responseType: "blob" }),
  pdf: (id: number, filename: string) => downloadFile(`/people/badges/${id}/pdf/`, {}, filename),
  /** Même badge, mais au format carte plastique PVC standard CR80 (85,6×54mm) — page à la
   * taille exacte de la carte, prête à imprimer directement sur une imprimante à cartes. */
  pdfPvc: (id: number, filename: string) => downloadFile(`/people/badges/${id}/pdf-pvc/`, {}, filename),
  /** Émet (si besoin) puis télécharge en un seul PDF (une carte par page) les badges de
   * tous les élèves actifs d'une classe. */
  pdfClasse: (classeId: number, filename: string) =>
    downloadFile("/people/badges/pdf-classe/", { classe: classeId }, filename),
  /** Réservé aux élèves du préscolaire/maternelle — l'API renvoie une erreur sinon. */
  autorisationRecuperation: (id: number, filename: string) =>
    downloadFile(`/people/badges/${id}/autorisation-recuperation/`, {}, filename),
};

export const enseignantBadgesApi = {
  list: () => api.get<Paginated<EnseignantBadge> | EnseignantBadge[]>("/people/badges-enseignants/", { params: { page_size: 100 } }),
  create: (enseignant: number) => api.post<EnseignantBadge>("/people/badges-enseignants/", { enseignant }),
  qr: (id: number) => api.get<Blob>(`/people/badges-enseignants/${id}/qr/`, { responseType: "blob" }),
  pdf: (id: number, filename: string) => downloadFile(`/people/badges-enseignants/${id}/pdf/`, {}, filename),
};

/** Vérification publique d'un badge scanné — aucune authentification requise. */
export const badgeVerifyApi = {
  verify: (token: string) =>
    api.get<{ valide: boolean; type?: string; role_label?: string; nom_complet?: string; matricule?: string; detail?: string; emis_le?: string }>(
      `/people/badges/verify/${token}/`
    ),
};

export const groupesRevisionApi = {
  list: () => api.get<Paginated<GroupeRevision> | GroupeRevision[]>("/people/groupes-revision/", { params: { page_size: 100 } }),
  create: (data: Partial<GroupeRevision>) => api.post<GroupeRevision>("/people/groupes-revision/", data),
  update: (id: number, data: Partial<GroupeRevision>) => api.patch<GroupeRevision>(`/people/groupes-revision/${id}/`, data),
  remove: (id: number) => api.delete(`/people/groupes-revision/${id}/`),
};

export const pointagesEnseignantsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<PointageEnseignant> | PointageEnseignant[]>("/people/pointages-enseignants/", { params: { page_size: 200, ...params } }),
  create: (data: Partial<PointageEnseignant>) => api.post<PointageEnseignant>("/people/pointages-enseignants/", data),
  update: (id: number, data: Partial<PointageEnseignant>) => api.patch<PointageEnseignant>(`/people/pointages-enseignants/${id}/`, data),
  today: () => api.get<PointageEnseignant | null>("/people/pointages-enseignants/today/"),
  checkIn: () => api.post<PointageEnseignant>("/people/pointages-enseignants/check-in/"),
  checkOut: () => api.post<PointageEnseignant>("/people/pointages-enseignants/check-out/"),
};

export const paiesEnseignantsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<PaieEnseignant> | PaieEnseignant[]>("/people/paies-enseignants/", { params: { page_size: 200, ...params } }),
  create: (data: Partial<PaieEnseignant>) => api.post<PaieEnseignant>("/people/paies-enseignants/", data),
  update: (id: number, data: Partial<PaieEnseignant>) => api.patch<PaieEnseignant>(`/people/paies-enseignants/${id}/`, data),
  pdf: (id: number, filename: string) => downloadFile(`/people/paies-enseignants/${id}/pdf/`, {}, filename),
  previewPdf: (id: number, filename: string) => fetchBlob(`/people/paies-enseignants/${id}/pdf/`, {}, filename),
  /** Heures réellement pointées (arrivée/départ) par un enseignant sur un mois — sert à
   * pré-remplir « Heures enseignées » en mode taux horaire à partir des pointages réels. */
  heuresPointees: (enseignantId: number, mois: string) =>
    api.get<{ heures: string; jours_pointes: number }>("/people/paies-enseignants/heures-pointees/", { params: { enseignant: enseignantId, mois } }),
};

export const alertesParentsApi = {
  list: () => api.get<Paginated<AlerteParent> | AlerteParent[]>("/people/alertes-parents/", { params: { page_size: 100 } }),
};

// ---- Grades ----
export const periodesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Periode> | Periode[]>("/grades/periodes/", { params: { page_size: 100, ...params } }),
  create: (data: { nom: string; annee_scolaire: number; date_debut: string; date_fin: string }) =>
    api.post<Periode>("/grades/periodes/", data),
  update: (id: number, data: Partial<{ nom: string; date_debut: string; date_fin: string }>) =>
    api.patch<Periode>(`/grades/periodes/${id}/`, data),
  remove: (id: number) => api.delete(`/grades/periodes/${id}/`),
};

export const notesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Note> | Note[]>("/grades/notes/", { params }),
  create: (data: Partial<Note>) => api.post<Note>("/grades/notes/", data),
  update: (id: number, data: Partial<Note>) => api.patch<Note>(`/grades/notes/${id}/`, data),
  remove: (id: number) => api.delete(`/grades/notes/${id}/`),
};

/** Sélecteur de période : soit une période précise, soit l'année entière (bulletin/résultats annuels). */
export type PeriodeSelection = { periode: number } | { annee_scolaire: number };

export const bulletinApi = {
  get: (eleve: number, selection: PeriodeSelection) =>
    api.get<Bulletin>("/grades/bulletin/", { params: { eleve, ...selection } }),
  downloadPdf: (eleve: number, selection: PeriodeSelection, filename: string) =>
    downloadFile("/grades/bulletin/pdf/", { eleve, ...selection }, filename),
  previewPdf: (eleve: number, selection: PeriodeSelection, filename: string) =>
    fetchBlob("/grades/bulletin/pdf/", { eleve, ...selection }, filename),
  sendEmail: (eleve: number, selection: PeriodeSelection) =>
    api.post<{ detail: string }>("/grades/bulletin/send-email/", { eleve, ...selection }),
  sendSms: (eleve: number, selection: PeriodeSelection) =>
    api.post<{ detail: string }>("/grades/bulletin/send-sms/", { eleve, ...selection }),
  sendWhatsApp: (eleve: number, selection: PeriodeSelection) =>
    api.post<{ detail: string }>("/grades/bulletin/send-whatsapp/", { eleve, ...selection }),
};

export const resultatsApi = {
  get: (classe: number, selection: PeriodeSelection) =>
    api.get<Resultats>("/grades/resultats/", { params: { classe, ...selection } }),
  exportCsv: (classe: number, selection: PeriodeSelection, filename: string) =>
    downloadFile("/grades/resultats/export/", { classe, ...selection }, filename),
  exportPdf: (classe: number, selection: PeriodeSelection, filename: string) =>
    downloadFile("/grades/resultats/pdf/", { classe, ...selection }, filename),
  attestations: (classe: number, selection: PeriodeSelection, rangMax: number, filename: string) =>
    downloadFile("/grades/resultats/attestations/", { classe, ...selection, rang_max: rangMax }, filename),
};

export const analysePerformanceApi = {
  get: (selection: PeriodeSelection, eleve?: number) =>
    api.get<AnalysePerformance>("/grades/analyse-performance/", { params: { ...selection, eleve } }),
};

export const assistantIaApi = {
  historique: () => api.get<MessageIA[]>("/people/assistant-ia/"),
  envoyer: (message: string) => api.post<{ message: MessageIA; reponse: MessageIA }>("/people/assistant-ia/", { message }),
};

// ---- Attendance ----
export const presencesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Presence> | Presence[]>("/attendance/presences/", { params }),
  bulk: (data: { date: string; creneau?: number | null; entries: { eleve: number; statut: string; justifie: boolean; motif?: string }[] }) =>
    api.post("/attendance/presences/bulk/", data),
  stats: (params?: Record<string, unknown>) => api.get<Record<string, unknown>>("/attendance/presences/stats/", { params }),
};

export const justificatifsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<JustificatifAbsence> | JustificatifAbsence[]>("/attendance/justificatifs/", { params }),
  create: (data: { eleve: number; date_absence: string; motif: string; description?: string; piece_jointe?: File | null }) => {
    const form = new FormData();
    form.append("eleve", String(data.eleve));
    form.append("date_absence", data.date_absence);
    form.append("motif", data.motif);
    if (data.description) form.append("description", data.description);
    if (data.piece_jointe) form.append("piece_jointe", data.piece_jointe);
    return api.post<JustificatifAbsence>("/attendance/justificatifs/", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
  approuver: (id: number, commentaire?: string) => api.post<JustificatifAbsence>(`/attendance/justificatifs/${id}/approuver/`, { commentaire }),
  rejeter: (id: number, commentaire?: string) => api.post<JustificatifAbsence>(`/attendance/justificatifs/${id}/rejeter/`, { commentaire }),
};

// ---- Payments ----
export const typesFraisApi = {
  list: () => api.get<Paginated<TypeFrais> | TypeFrais[]>("/payments/types-frais/", { params: { page_size: 100 } }),
  create: (data: Partial<TypeFrais>) => api.post<TypeFrais>("/payments/types-frais/", data),
  update: (id: number, data: Partial<TypeFrais>) => api.patch<TypeFrais>(`/payments/types-frais/${id}/`, data),
  remove: (id: number) => api.delete(`/payments/types-frais/${id}/`),
};

/** Paramétrage du montant de chaque type de frais par classe/année scolaire. */
export const tarifsClasseApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<TarifClasse> | TarifClasse[]>("/payments/tarifs-classe/", { params: { page_size: 500, ...params } }),
  definir: (data: { type_frais: number; classe: number; annee_scolaire: number; montant: string }) =>
    api.post<TarifClasse>("/payments/tarifs-classe/definir/", data),
  remove: (id: number) => api.delete(`/payments/tarifs-classe/${id}/`),
};

export const fraisApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Frais> | Frais[]>("/payments/frais/", { params }),
  create: (data: Partial<Frais>) => api.post<Frais>("/payments/frais/", data),
  // Réservé aux frais encore impayés côté backend (voir FraisViewSet.perform_destroy) : un frais
  // déjà payé, même partiellement, ne peut pas être supprimé (perte de l'historique de paiements).
  remove: (id: number) => api.delete(`/payments/frais/${id}/`),
  genererPourClasse: (data: { classe: number; annee_scolaire: number; date_echeance: string; types_frais?: number[] }) =>
    api.post<{ crees: number; classe: string; eleves: number }>("/payments/frais/generer-pour-classe/", data),
  summary: (params?: Record<string, unknown>) => api.get<Record<string, unknown>>("/payments/frais/summary/", { params }),
  exportCsv: (params?: Record<string, unknown>) => downloadFile("/payments/frais/export/", params || {}, "frais_paiements.csv"),
  /** Fiche de paiement (PDF) d'un élève pour un frais donné — nécessite qu'un paiement ait déjà été enregistré. */
  fichePaiementPdf: (id: number, filename: string) => downloadFile(`/payments/frais/${id}/fiche-paiement/`, {}, filename),
  /** Toutes les fiches de paiement des élèves ayant payé, en un seul PDF (respecte les filtres passés). */
  fichesPaiementPdf: (params: Record<string, unknown> | undefined, filename: string) =>
    downloadFile("/payments/frais/fiches-paiement/", params || {}, filename),
  suiviMensuel: (eleveId: number, anneeScolaireId?: number) =>
    api.get<SuiviMensuelEleve>("/payments/frais/suivi-mensuel/", { params: { eleve: eleveId, annee_scolaire: anneeScolaireId } }),
  suiviMensuelClasse: (classeId: number) =>
    api.get<SuiviMensuelClasse>("/payments/frais/suivi-mensuel-classe/", { params: { classe: classeId } }),
  /** Facture proforma (PDF) : récapitule tous les frais dus par un élève sur une année scolaire
   * (montant/payé/solde), sans historique de transactions — un document d'estimation à
   * présenter avant paiement, distinct de la fiche de paiement. */
  proformaPdf: (eleveId: number, filename: string, anneeScolaireId?: number) =>
    downloadFile("/payments/frais/proforma/", { eleve: eleveId, annee_scolaire: anneeScolaireId }, filename),
  previewProformaPdf: (eleveId: number, filename: string, anneeScolaireId?: number) =>
    fetchBlob("/payments/frais/proforma/", { eleve: eleveId, annee_scolaire: anneeScolaireId }, filename),
  impayesParClasse: (params?: Record<string, unknown>) =>
    api.get<{ classe_id: number | null; classe_nom: string; nb_impayes: number; total_solde: string; eleves: { eleve_id: number; matricule: string; nom_complet: string; du: string; paye: string; solde: string }[] }[]>(
      "/payments/frais/impayes-par-classe/", { params }
    ),
  notifierImpayes: () => api.post<{ notifies: number }>("/payments/frais/notifier-impayes/"),
  /** Rapport de suivi des paiements de scolarité (PDF), mois par mois — un élève à la fois. */
  suiviMensuelPdf: (eleveId: number, filename: string, anneeScolaireId?: number) =>
    downloadFile("/payments/frais/suivi-mensuel-pdf/", { eleve: eleveId, annee_scolaire: anneeScolaireId }, filename),
};

export const paiementsApi = {
  create: (data: { frais: number; montant: string; mode_paiement: string; reference?: string; mois?: string | null }) =>
    api.post<Paiement>("/payments/paiements/", data),
  // Réservé à l'administrateur côté backend (voir PaiementViewSet.get_permissions) : un paiement
  // supprimé par erreur fausserait l'historique et le suivi mensuel de l'élève.
  remove: (id: number) => api.delete(`/payments/paiements/${id}/`),
};

export const depensesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Depense> | Depense[]>("/payments/depenses/", { params }),
  create: (data: Partial<Depense>) => api.post<Depense>("/payments/depenses/", toFormData(data), multipartHeaders),
  update: (id: number, data: Partial<Depense>) => api.patch<Depense>(`/payments/depenses/${id}/`, toFormData(data), multipartHeaders),
  remove: (id: number) => api.delete(`/payments/depenses/${id}/`),
  summary: (params?: Record<string, unknown>) => api.get<{ total: string; nombre: number }>("/payments/depenses/summary/", { params }),
  exportCsv: (params?: Record<string, unknown>) => downloadFile("/payments/depenses/export/", params || {}, "depenses.csv"),
};

/** Catégories de dépense de l'établissement — librement gérées par son administrateur. */
export const categoriesDepenseApi = {
  list: () => api.get<Paginated<CategorieDepense> | CategorieDepense[]>("/payments/categories-depense/", { params: { page_size: 200 } }),
  create: (nom: string) => api.post<CategorieDepense>("/payments/categories-depense/", { nom }),
  update: (id: number, nom: string) => api.patch<CategorieDepense>(`/payments/categories-depense/${id}/`, { nom }),
  remove: (id: number) => api.delete(`/payments/categories-depense/${id}/`),
};

/** Tableau de bord Caisse : rentrées (paiements élèves) + sorties (dépenses) sur une période —
 * sans dates, la période par défaut côté backend est « aujourd'hui » (rapport journalier). */
export const caisseApi = {
  get: (params?: { date_debut?: string; date_fin?: string }) => api.get<CaisseRapport>("/payments/caisse/", { params }),
  pdf: (params: { date_debut?: string; date_fin?: string } | undefined, filename: string) =>
    downloadFile("/payments/caisse/pdf/", params || {}, filename),
};

// ---- Visioconférence (Jitsi Meet embarqué — voir visio/models.py) ----
export const reunionsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Reunion> | Reunion[]>("/visio/reunions/", { params }),
  get: (id: number) => api.get<Reunion>(`/visio/reunions/${id}/`),
  create: (data: { titre: string; description?: string; date_debut: string; duree_minutes?: number; participants: number[] }) =>
    api.post<Reunion>("/visio/reunions/", data),
  update: (id: number, data: Partial<{ titre: string; description: string; date_debut: string; duree_minutes: number; participants: number[]; statut: string }>) =>
    api.patch<Reunion>(`/visio/reunions/${id}/`, data),
  remove: (id: number) => api.delete(`/visio/reunions/${id}/`),
  appelInstantane: (destinataireId: number, type: "audio" | "video" = "video") =>
    api.post<Reunion>("/visio/reunions/appel-instantane/", { destinataire: destinataireId, type }),
  participantsPossibles: () => api.get<Participant[]>("/visio/reunions/participants-possibles/"),
};

// ---- Announcements ----
export const annoncesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Annonce> | Annonce[]>("/announcements/annonces/", { params }),
  create: (data: Partial<Annonce>) =>
    api.post<Annonce & { resultat_envoi?: { emails_envoyes: number; sms_envoyes: number } }>("/announcements/annonces/", data),
  remove: (id: number) => api.delete(`/announcements/annonces/${id}/`),
};

// ---- Modèles de messages (personnalisation des notifications automatiques) ----
export const modelesMessageApi = {
  list: () => api.get<Paginated<ModeleMessage> | ModeleMessage[]>("/tenants/modeles-message/"),
  update: (cle: string, data: { sujet: string; contenu: string }) =>
    api.patch<ModeleMessage>(`/tenants/modeles-message/${cle}/`, data),
};

/** Annonces diffusées par le Super Admin à toutes les écoles de la plateforme. */
export const annoncesPlateformeApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Annonce> | Annonce[]>("/announcements/plateforme/", { params }),
  create: (data: Partial<Annonce>) => api.post<Annonce>("/announcements/plateforme/", data),
  remove: (id: number) => api.delete(`/announcements/plateforme/${id}/`),
};

// ---- Bibliothèque ----
export const livresApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Livre> | Livre[]>("/library/livres/", { params }),
  create: (data: Record<string, unknown>) => api.post<Livre>("/library/livres/", toFormData(data), multipartHeaders),
  update: (id: number, data: Record<string, unknown>) => api.patch<Livre>(`/library/livres/${id}/`, toFormData(data), multipartHeaders),
  remove: (id: number) => api.delete(`/library/livres/${id}/`),
};

export const empruntsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Emprunt> | Emprunt[]>("/library/emprunts/", { params }),
  create: (data: { livre: number; eleve: number; date_retour_prevue: string }) =>
    api.post<Emprunt>("/library/emprunts/", data),
  retourner: (id: number) => api.post<Emprunt>(`/library/emprunts/${id}/retourner/`),
};

// ---- Transport ----
export const trajetsApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Trajet> | Trajet[]>("/transport/trajets/", { params }),
  create: (data: Partial<Trajet>) => api.post<Trajet>("/transport/trajets/", data),
  update: (id: number, data: Partial<Trajet>) => api.patch<Trajet>(`/transport/trajets/${id}/`, data),
  remove: (id: number) => api.delete(`/transport/trajets/${id}/`),
  regenererLienChauffeur: (id: number) => api.post<Trajet>(`/transport/trajets/${id}/regenerer-lien-chauffeur/`),
};

export const affectationsTransportApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<AffectationTransport> | AffectationTransport[]>("/transport/affectations/", { params }),
  create: (data: { eleve: number; trajet: number; point_montee?: string }) =>
    api.post<AffectationTransport>("/transport/affectations/", data),
  remove: (id: number) => api.delete(`/transport/affectations/${id}/`),
};

export const ticketsBusApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<TicketBus> | TicketBus[]>("/transport/tickets/", { params }),
  create: (data: { affectation: number; mois: string; montant: string }) => api.post<TicketBus>("/transport/tickets/", data),
  marquerPaye: (id: number) => api.post<TicketBus>(`/transport/tickets/${id}/marquer-paye/`),
};

// ---- Portail chauffeur (accès public par lien secret, pas d'authentification) ----
export const chauffeurApi = {
  info: (token: string) => api.get<ChauffeurInfo>(`/transport/chauffeur/${token}/`),
  pointer: (token: string, data: { eleve: number; type_evenement: "montee" | "descente"; latitude?: number; longitude?: number }) =>
    api.post(`/transport/chauffeur/${token}/pointage/`, data),
  signalerPosition: (token: string, latitude: number, longitude: number) =>
    api.post(`/transport/chauffeur/${token}/position/`, { latitude, longitude }),
};

// ---- Cantine ----
export const formulesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Formule> | Formule[]>("/cantine/formules/", { params }),
  create: (data: Partial<Formule>) => api.post<Formule>("/cantine/formules/", data),
  update: (id: number, data: Partial<Formule>) => api.patch<Formule>(`/cantine/formules/${id}/`, data),
  remove: (id: number) => api.delete(`/cantine/formules/${id}/`),
  regenererLienAgent: (id: number) => api.post<Formule>(`/cantine/formules/${id}/regenerer-lien-agent/`),
};

export const inscriptionsCantineApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<InscriptionCantine> | InscriptionCantine[]>("/cantine/inscriptions/", { params }),
  create: (data: { eleve: number; formule: number }) =>
    api.post<InscriptionCantine>("/cantine/inscriptions/", data),
  remove: (id: number) => api.delete(`/cantine/inscriptions/${id}/`),
};

export const ticketsCantineApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<TicketCantine> | TicketCantine[]>("/cantine/tickets/", { params }),
  create: (data: { inscription: number; mois: string; montant: string }) => api.post<TicketCantine>("/cantine/tickets/", data),
  marquerPaye: (id: number) => api.post<TicketCantine>(`/cantine/tickets/${id}/marquer-paye/`),
};

// ---- Portail agent de cantine (accès public par lien secret, pas d'authentification) ----
export const agentCantineApi = {
  info: (token: string) => api.get<AgentCantineInfo>(`/cantine/agent/${token}/`),
  pointer: (token: string, data: { eleve: number }) =>
    api.post(`/cantine/agent/${token}/pointage/`, data),
};

// ---- Messagerie ----
export const messagesApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Message> | Message[]>("/messaging/messages/", { params }),
  create: (data: { destinataire: number; contenu: string }) => api.post<Message>("/messaging/messages/", data),
  /** Envoie un message vocal ou une pièce jointe (multipart/form-data). */
  sendAttachment: (destinataire: number, fichier: Blob, type: "vocal" | "fichier", filename: string, contenu = "") => {
    const form = new FormData();
    form.append("destinataire", String(destinataire));
    form.append("type_message", type);
    form.append("fichier", fichier, filename);
    if (contenu) form.append("contenu", contenu);
    return api.post<Message>("/messaging/messages/", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
  marquerLu: (id: number) => api.post<Message>(`/messaging/messages/${id}/marquer-lu/`),
  nonLus: () => api.get<{ non_lus: number }>("/messaging/messages/non-lus/"),
  contacts: () => api.get<User[]>("/messaging/contacts/"),
};

export const supportApi = {
  list: (params?: Record<string, unknown>) => api.get<Paginated<Ticket> | Ticket[]>("/support/tickets/", { params }),
  create: (data: { sujet: string; priorite: string; message: string }) => api.post<Ticket>("/support/tickets/", data),
  changerStatut: (id: number, data: { statut: string; assigne_a?: number | null }) =>
    api.post<Ticket>(`/support/tickets/${id}/changer-statut/`, data),
  compteur: () => api.get<{ actifs: number }>("/support/tickets/compteur/"),
  messages: (ticketId: number) => api.get<Paginated<MessageTicket> | MessageTicket[]>("/support/messages/", { params: { ticket: ticketId, page_size: 200 } }),
  envoyerMessage: (ticketId: number, contenu: string) => api.post<MessageTicket>("/support/messages/", { ticket: ticketId, contenu }),
  envoyerPieceJointe: (ticketId: number, fichier: File) => {
    const form = new FormData();
    form.append("ticket", String(ticketId));
    form.append("fichier", fichier);
    return api.post<MessageTicket>("/support/messages/", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
};

/** Les endpoints paginés DRF renvoient soit un tableau, soit { results: [...] } selon la config — cet utilitaire uniformise. */
export function unwrapList<T>(data: Paginated<T> | T[]): T[] {
  return Array.isArray(data) ? data : data.results;
}
