export type Role = "superadmin" | "admin" | "teacher" | "student" | "parent" | "comptabilite" | "surveillance";

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: Role;
  role_display: string;
  ecole: number | null;
  ecole_nom: string | null;
  phone: string;
  address: string;
  photo: string | null;
  sexe: "M" | "F" | "";
  date_of_birth: string | null;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
  doit_changer_mot_de_passe: boolean;
  // Personnalisation et fonctionnalités désactivées de l'école de ce compte (voir
  // Ecole.couleur_principale/couleur_secondaire/fonctionnalites_desactivees) — portées
  // directement par /me/ pour que la navigation puisse se masquer, quel que soit le rôle.
  ecole_couleur_principale: string | null;
  ecole_couleur_secondaire: string | null;
  ecole_fonctionnalites_desactivees: string[];
  // Logo + adresse de l'école de ce compte — affichés en haut du tableau de bord.
  ecole_logo: string | null;
  ecole_adresse: string | null;
  // Activité dans les DELAI_EN_LIGNE_MINUTES dernières minutes (voir User.en_ligne côté backend).
  en_ligne: boolean;
}

export type StatutAbonnement = "suspendu" | "paye" | "en_attente" | "en_retard" | "bloque";

export interface ParametresEcole {
  devise: string;
  bareme_notation: number;
  moyenne_admission: string;
  heure_limite_ponctualite: string;
  message_bienvenue: string;
  reglement_interieur: string;
}

export type TypeEtablissement = "primaire" | "college" | "lycee" | "universite" | "prive" | "public" | "";

export interface Ecole {
  id: number;
  nom: string;
  slug: string;
  adresse: string;
  ville: string;
  pays: string;
  telephone: string;
  email: string;
  logo: string | null;
  directeur_nom: string;
  type_etablissement: TypeEtablissement;
  type_etablissement_display: string;
  // Hiérarchie administrative (Éducation nationale guinéenne), modifiable par l'admin de
  // l'école — utilisée par le bulletin au modèle « Officiel » (voir MODELES_DOCUMENT).
  ire: string;
  dpe: string;
  dsee: string;
  // Libellés institutionnels (ministère(s), pays, devise) de l'en-tête du bulletin — modifiables
  // par l'admin de l'école, préremplis avec les intitulés guinéens usuels (voir Ecole.entete_*
  // côté backend). entete_ministere_2 vide masque la seconde ligne sur le bulletin.
  entete_ministere_1: string;
  entete_ministere_2: string;
  entete_republique: string;
  entete_devise: string;
  plan: number | null;
  plan_nom: string | null;
  plan_limite_eleves: number | null;
  plan_limite_enseignants: number | null;
  plan_limite_administrateurs: number | null;
  abonnement_mensuel: string;
  jour_echeance: number;
  jours_grace: number;
  actif: boolean;
  date_creation: string;
  statut_abonnement: StatutAbonnement;
  jours_avant_echeance: number | null;
  jours_avant_blocage: number | null;
  nombre_utilisateurs: number;
  dernier_paiement: PaiementEcole | null;
  parametres: ParametresEcole | null;
  // Personnalisation (documents PDF) et fonctionnalités désactivées, réglées par le Super
  // Admin pour cette école (voir EcoleDetailPage, onglet Personnalisation).
  couleur_principale: string;
  couleur_secondaire: string;
  fonctionnalites_desactivees: string[];
  // Modèle de mise en page (1-4, voir MODELES_DOCUMENT côté frontend / Ecole.ModeleDocument
  // côté backend), réglable indépendamment pour chacun de ces 4 documents.
  modele_recu: number;
  modele_recu_display: string;
  modele_badge: number;
  modele_badge_display: string;
  modele_bulletin: number;
  modele_bulletin_display: string;
  modele_fiche_inscription: number;
  modele_fiche_inscription_display: string;
  modele_certificat: number;
  modele_certificat_display: string;
}

/** Les 4 modèles de mise en page disponibles pour chaque document personnalisable (voir
 * `Ecole.ModeleDocument` côté backend — les valeurs et l'ordre doivent rester synchronisés). */
export const MODELES_DOCUMENT: { value: number; label: string }[] = [
  { value: 1, label: "Classique" },
  { value: 2, label: "Moderne" },
  { value: 3, label: "Élégant" },
  { value: 4, label: "Compact" },
  // Réservé au bulletin (voir Ecole.ModeleDocument.OFFICIEL côté backend) — techniquement
  // sélectionnable pour les 3 autres documents, qui retombent alors sur leur rendu Classique
  // faute de branche dédiée pour cette valeur.
  { value: 5, label: "Officiel (IRE/DPE)" },
];

/** Une fonctionnalité optionnelle qu'un Super Admin peut désactiver par école (voir
 * `Ecole.fonctionnalites_desactivees`) — registre lu depuis l'API pour rester synchronisé
 * avec `tenants/features.py` côté backend. */
export interface Fonctionnalite {
  cle: string;
  label: string;
}

export interface PlanAbonnement {
  id: number;
  nom: string;
  montant: string;
  periodicite: "mensuel" | "trimestriel" | "annuel";
  periodicite_display: string;
  description: string;
  limite_eleves: number | null;
  limite_enseignants: number | null;
  limite_administrateurs: number | null;
  actif: boolean;
  nombre_ecoles: number;
}

export interface ParametresPlateforme {
  nom_plateforme: string;
  logo: string | null;
  email_expediteur_nom: string;
  support_email: string;
  support_telephone: string;
  sms_actif: boolean;
  maintenance_active: boolean;
  maintenance_message: string;
}

/** Sous-ensemble public de `ParametresPlateforme` (nom + logo) — lisible sans authentification,
 * affiché partout dans l'app (page de connexion, barre latérale...). */
export type PlateformeBranding = Pick<ParametresPlateforme, "nom_plateforme" | "logo" | "maintenance_active" | "maintenance_message">;

export interface SupervisionData {
  taille_base_donnees_octets: number;
  taille_media_octets: number;
  nombre_ecoles: number;
  nombre_ecoles_actives: number;
  nombre_utilisateurs_total: number;
  version_django: string;
  version_python: string;
  dernieres_sauvegardes: SauvegardeLog[];
  debug_actif: boolean;
  moteur_base_donnees: string;
  plateforme_serveur: string;
  interpreteur_python: string;
  disque: { total_octets: number; utilise_octets: number; libre_octets: number } | null;
  utilisateurs_actifs_24h: number;
  utilisateurs_actifs_7j: number;
  utilisateurs_jamais_connectes: number;
  jours_depuis_derniere_sauvegarde_reussie: number | null;
  top_ecoles: { id: number; nom: string; nb_utilisateurs: number }[];
}

export interface EcoleStatsGlobales {
  total_ecoles: number;
  ecoles_actives: number;
  ecoles_a_jour: number;
  ecoles_en_retard: number;
  ecoles_bloquees: number;
  revenu_mensuel_attendu: string;
  revenu_total_encaisse: string;
  historique_revenu: { mois: string; total: string }[];
  historique_croissance: { mois: string; total: number }[];
  ecoles_a_surveiller: { id: number; nom: string; jours_avant_blocage: number }[];
}

export interface RechercheGlobaleResult {
  id: number;
  full_name: string;
  username: string;
  email: string;
  role: Role;
  role_display: string;
  ecole_id: number | null;
  ecole_nom: string | null;
  is_active: boolean;
  last_login: string | null;
}

export interface EcoleStatsDetail {
  total_eleves: number;
  total_enseignants: number;
  total_classes: number;
  total_frais_attendu: string;
  total_frais_encaisse: string;
}

export interface EcoleUtilisateur {
  id: number;
  full_name: string;
  username: string;
  role: Role;
  role_display: string;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
  en_ligne: boolean;
}

/** Une entrée de l'historique d'activité d'un compte (voir `usersApi.journal`) — connexions et
 * actions clés de CE compte, consultable par l'Admin de son école. Distinct de
 * `JournalActiviteEntry` ci-dessous, réservé aux actions du Super Admin sur la plateforme. */
export interface JournalUtilisateurEntry {
  id: number;
  horodatage: string;
  categorie: "connexion" | "compte" | "eleve" | "enseignant" | "note" | "paiement";
  categorie_display: string;
  description: string;
  adresse_ip: string | null;
  /** Résumé lisible du navigateur/appareil (ex: "Chrome sur Windows"), vide si non détecté. */
  appareil: string;
}

export interface JournalActiviteEntry {
  id: number;
  horodatage: string;
  acteur: number | null;
  acteur_nom: string | null;
  action: string;
  action_display: string;
  ecole: number | null;
  ecole_nom: string | null;
  details: string;
}

export interface SauvegardeLog {
  id: number;
  date_lancement: string;
  fichier: string;
  taille_octets: number;
  duree_secondes: number;
  statut: "succes" | "echec";
  message: string;
}

export type ModePaiementEcole =
  | "especes" | "virement" | "mobile_money" | "orange_money" | "mtn_money" | "moov_money"
  | "carte_bancaire" | "cheque";

export interface PaiementEcole {
  id: number;
  ecole: number;
  mois: string;
  montant: string;
  date_paiement: string;
  mode_paiement: ModePaiementEcole;
  reference: string;
  numero_facture: string;
  enregistre_par: number | null;
  enregistre_par_nom: string | null;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface AnneeScolaire {
  id: number;
  libelle: string;
  date_debut: string;
  date_fin: string;
  active: boolean;
}

export interface Matiere {
  id: number;
  nom: string;
  code: string;
  coefficient: number;
  couleur: string;
}

export type Cycle = "prescolaire" | "primaire" | "college" | "lycee" | "";

/** Libellés + ordre d'affichage des 4 cycles (voir `Classe.Cycle` côté backend) — source
 * commune pour tout sélecteur "Cycle" de la plateforme (filtre une liste de classes, un
 * formulaire...). Repris ici plutôt que dupliqué page par page. */
export const CYCLE_LABELS: Record<Exclude<Cycle, "">, string> = {
  prescolaire: "Préscolaire", primaire: "Primaire", college: "Collège", lycee: "Lycée",
};
export const ORDRE_CYCLES: Cycle[] = ["prescolaire", "primaire", "college", "lycee"];

export interface Classe {
  id: number;
  nom: string;
  niveau: string;
  cycle: Cycle;
  cycle_display: string;
  annee_scolaire: number;
  annee_scolaire_libelle: string;
  professeur_principal: number | null;
  professeur_principal_nom: string | null;
  capacite: number;
  effectif: number;
  /** capacite - effectif, jamais négatif — 0 signifie complet (voir ClasseOptions/CycleSelect
   * pour l'affichage, et EleveProfileWriteSerializer.validate_classe côté backend qui bloque
   * l'inscription dans ce cas). */
  places_disponibles: number;
}

export interface Enseignement {
  id: number;
  enseignant: number;
  enseignant_nom: string;
  matiere: number;
  matiere_nom: string;
  classe: number;
  classe_nom: string;
}

export interface Creneau {
  id: number;
  classe: number;
  classe_nom: string;
  enseignement: number;
  matiere_nom: string;
  matiere_couleur: string;
  enseignant_nom: string;
  jour: string;
  heure_debut: string;
  heure_fin: string;
  salle: string;
}

export interface MiniUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  photo: string | null;
  date_of_birth: string | null;
  address: string;
  sexe: "M" | "F" | "";
}

export interface EleveProfile {
  id: number;
  user: MiniUser;
  matricule: string;
  classe: number | null;
  classe_nom: string | null;
  classe_cycle: Cycle | null;
  classe_cycle_display: string | null;
  parent: number | null;
  parent_nom: string | null;
  parent_telephone: string | null;
  parent_email: string | null;
  parent_username: string | null;
  date_inscription: string;
  lieu_naissance: string;
  nom_pere: string;
  nom_mere: string;
  nom_tuteur: string;
  regime: "externe" | "demi_pension" | "interne";
  statut_inscription: "nouveau" | "reinscription" | "transfert";
  actif: boolean;
  date_sortie: string | null;
  motif_sortie: string;
  categorie_paiement: CategoriePaiement;
  categorie_paiement_display: string;
  reduction_fidelite_mensualite: boolean;
  facteur_mensualite: string;
}

/** Prise en charge de la mensualité (scolarité) d'un élève — n'affecte que les frais mensuels
 * (cantine/transport/inscription restent facturés normalement quelle que soit la catégorie). */
export type CategoriePaiement = "standard" | "fondation_50" | "fondation_gratuit" | "inscription_seulement";

export interface EnseignantProfile {
  id: number;
  user: MiniUser;
  matricule: string;
  specialite: string;
  date_embauche: string | null;
  diplome: string;
}

export interface EleveBadge {
  id: number;
  eleve: number;
  eleve_nom: string;
  photo: string | null;
  qr_token: string;
  actif: boolean;
  emis_le: string;
}

export interface EnseignantBadge {
  id: number;
  enseignant: number;
  enseignant_nom: string;
  photo: string | null;
  qr_token: string;
  actif: boolean;
  emis_le: string;
}

export interface GroupeRevision {
  id: number;
  enseignant: number;
  enseignant_nom: string;
  nom: string;
  description: string;
  matiere: number | null;
  classe: number | null;
  eleves: number[];
  eleves_noms: string[];
  lien: string;
  actif: boolean;
  cree_le: string;
}

export interface AlerteParent {
  id: number;
  parent: number;
  eleve: number;
  eleve_nom: string;
  type: string;
  message: string;
  sms_envoye: boolean;
  cree_le: string;
}

export interface PointageEnseignant {
  id: number;
  enseignant: number;
  enseignant_nom: string;
  date: string;
  heure_arrivee: string | null;
  heure_depart: string | null;
  statut: "present" | "absent" | "retard";
  commentaire: string;
}

export interface PaieEnseignant {
  id: number;
  enseignant: number;
  enseignant_nom: string;
  mois: string;
  mode_calcul: "fixe" | "horaire";
  salaire_base: string;
  nombre_heures: string | null;
  taux_horaire: string | null;
  salaire_calcule: string;
  primes: string;
  retenues: string;
  net_a_payer: string;
  payee: boolean;
  date_paiement: string | null;
  commentaire: string;
}

export interface Periode {
  id: number;
  nom: string;
  annee_scolaire: number;
  annee_scolaire_libelle: string;
  date_debut: string;
  date_fin: string;
}

export interface Note {
  id: number;
  eleve: number;
  eleve_nom: string;
  matiere: number;
  matiere_nom: string;
  enseignant: number | null;
  enseignant_nom: string | null;
  periode: number;
  periode_nom: string;
  type_evaluation: "devoir" | "composition" | "interrogation" | "projet";
  valeur: string;
  coefficient: number;
  date: string;
  commentaire: string;
}

export interface BulletinMatiere {
  matiere_id: number;
  matiere_nom: string;
  matiere_couleur: string;
  coefficient: number;
  moyenne: number | null;
  moyenne_classe: number | null;
  appreciation: string | null;
  notes: { id: number; type_evaluation: string; valeur: string; coefficient: number; date: string }[];
}

export interface PeriodeLabel {
  id: number;
  nom: string;
  annee_scolaire: string;
  type: "periode" | "annuel";
}

export interface AnalyseMatiere {
  matiere_id: number;
  matiere_nom: string;
  matiere_couleur: string;
  moyenne: number | null;
  moyenne_classe: number | null;
  niveau: "faible" | "moyen" | "bon" | "aucune_note";
  conseil: string;
}

export interface AnalysePerformance {
  eleve: { id: number; nom_complet: string };
  periode: PeriodeLabel;
  matieres: AnalyseMatiere[];
  points_faibles: AnalyseMatiere[];
  points_forts: AnalyseMatiere[];
}

export interface MessageIA {
  id: number;
  role: "user" | "assistant";
  contenu: string;
  cree_le: string;
}

export interface Bulletin {
  eleve: { id: number; nom_complet: string; matricule: string; classe: string | null };
  periode: PeriodeLabel;
  matieres: BulletinMatiere[];
  moyenne_generale: number | null;
  mention: string | null;
  rang: number | null;
  effectif_classe: number | null;
}

export interface ResultatEleve {
  eleve_id: number;
  matricule: string;
  nom_complet: string;
  moyenne_generale: number | null;
  rang: number | null;
  mention: string | null;
}

export interface Resultats {
  classe: { id: number; nom: string };
  periode: PeriodeLabel;
  effectif: number;
  resultats: ResultatEleve[];
}

export interface Presence {
  id: number;
  eleve: number;
  eleve_nom: string;
  classe_nom: string | null;
  date: string;
  creneau: number | null;
  statut: "present" | "absent" | "retard";
  justifie: boolean;
  motif: string;
  enregistre_par: number | null;
}

export interface JustificatifAbsence {
  id: number;
  eleve: number;
  eleve_nom: string;
  classe_nom: string | null;
  date_absence: string;
  motif: "maladie" | "autre";
  description: string;
  piece_jointe: string | null;
  statut: "en_attente" | "approuve" | "rejete";
  soumis_par: number | null;
  soumis_par_nom: string | null;
  traite_par: number | null;
  traite_par_nom: string | null;
  commentaire_traitement: string;
  cree_le: string;
}

export type PeriodiciteFrais = "mensuel" | "trimestriel" | "annuel" | "autre";

/** Marque ce type de frais comme LE frais d'inscription/réinscription de l'école (au plus un de
 * chaque) — permet de retrouver son montant par classe (voir TarifClasse) sans le resaisir à la
 * création d'un élève ou à la réinscription. */
export type UsageFrais = "standard" | "inscription" | "reinscription";

export interface TypeFrais {
  id: number;
  nom: string;
  montant_standard: string;
  periodicite: PeriodiciteFrais;
  periodicite_display: string;
  /** Dérivé de `periodicite` côté backend (== "mensuel") — lecture seule. */
  est_mensuel: boolean;
  usage: UsageFrais;
  usage_display: string;
}

/** Montant paramétré d'un type de frais pour une classe donnée, sur une année scolaire — sert de
 * valeur par défaut à la place de `TypeFrais.montant_standard` lors de la génération des frais. */
export interface TarifClasse {
  id: number;
  type_frais: number;
  type_frais_nom: string;
  classe: number;
  classe_nom: string;
  classe_niveau: string;
  annee_scolaire: number;
  annee_scolaire_libelle: string;
  montant: string;
}

export interface Paiement {
  id: number;
  frais: number;
  montant: string;
  date_paiement: string;
  mode_paiement: "especes" | "cheque" | "virement" | "mobile_money";
  reference: string;
  mois: string | null;
  /** Tranche couverte (frais de périodicité Tranche uniquement) — pendant de `mois`. */
  periode: number | null;
  periode_nom: string | null;
  enregistre_par: number | null;
  enregistre_par_nom: string | null;
}

/** Catégorie de dépense propre à chaque école, librement gérée par son administrateur — voir
 * categoriesDepenseApi (CRUD). Un jeu de départ est créé automatiquement pour chaque école. */
export interface CategorieDepense {
  id: number;
  nom: string;
}

export interface Depense {
  id: number;
  date: string;
  categorie: number;
  categorie_nom: string;
  motif: string;
  montant: string;
  mode_paiement: "especes" | "cheque" | "virement" | "mobile_money";
  mode_paiement_display: string;
  reference: string;
  responsable: string;
  enregistre_par: number | null;
  enregistre_par_nom: string | null;
  justificatif: string | null;
  commentaire: string;
}

/** Une ligne (rentrée ou sortie) du tableau de bord Caisse — voir CaisseRapport. */
export interface CaisseRentree {
  id: number;
  date: string;
  eleve_nom: string;
  type_frais_nom: string;
  montant: string;
  mode_paiement: string;
  mode_paiement_display: string;
  reference: string;
  enregistre_par_nom: string | null;
}

export interface CaisseSortie {
  id: number;
  date: string;
  categorie: number;
  categorie_nom: string;
  motif: string;
  montant: string;
  mode_paiement: string;
  mode_paiement_display: string;
  reference: string;
  responsable: string;
  enregistre_par_nom: string | null;
}

export interface CaisseRapport {
  date_debut: string;
  date_fin: string;
  total_rentrees: string;
  total_sorties: string;
  solde: string;
  rentrees: CaisseRentree[];
  sorties: CaisseSortie[];
}

export interface SuiviMensuelMois {
  mois: string;
  montant_du: string;
  montant_paye: string;
  statut: "paye" | "partiel" | "non_paye";
}

export interface SuiviMensuelEleve {
  eleve_id: number;
  eleve_nom: string;
  categorie_paiement: CategoriePaiement;
  categorie_paiement_display: string;
  annee_scolaire: string;
  mois: SuiviMensuelMois[];
}

export interface SuiviMensuelClasseEleve {
  eleve_id: number;
  eleve_nom: string;
  matricule: string;
  categorie_paiement: CategoriePaiement;
  categorie_paiement_display: string;
  mois: SuiviMensuelMois[];
}

export interface SuiviMensuelClasse {
  classe: string;
  annee_scolaire: string;
  eleves: SuiviMensuelClasseEleve[];
}

export interface Frais {
  id: number;
  eleve: number;
  eleve_nom: string;
  type_frais: number;
  type_frais_nom: string;
  type_frais_est_mensuel: boolean;
  type_frais_periodicite: PeriodiciteFrais;
  annee_scolaire: number;
  montant: string;
  // Montant réellement dû après application de la catégorie de paiement/réduction fidélité de
  // l'élève (voir EleveProfile.facteur_mensualite côté backend) — distinct de `montant`, qui
  // reste le tarif standard. Identique à `montant` pour un frais non mensuel ou un élève standard.
  montant_du: string;
  date_echeance: string;
  montant_paye: string;
  solde: string;
  statut: "impaye" | "partiel" | "paye";
  paiements: Paiement[];
}

export interface Livre {
  id: number;
  titre: string;
  auteur: string;
  isbn: string;
  categorie: string;
  couverture: string | null;
  exemplaires_total: number;
  duree_emprunt_jours: number;
  exemplaires_disponibles: number;
  exemplaires_empruntes: number;
  date_ajout: string;
}

export interface Emprunt {
  id: number;
  livre: number;
  livre_titre: string;
  eleve: number;
  eleve_nom: string;
  date_emprunt: string;
  date_retour_prevue: string;
  date_retour_effective: string | null;
  statut: "en_cours" | "en_retard" | "rendu";
  enregistre_par: number | null;
}

export interface Trajet {
  id: number;
  nom: string;
  chauffeur_nom: string;
  chauffeur_telephone: string;
  vehicule_immatriculation: string;
  capacite: number;
  heure_depart: string | null;
  heure_retour: string | null;
  description: string;
  effectif: number;
  /** null pour tout le monde sauf l'Administrateur (lien secret sans authentification). */
  lien_chauffeur: string | null;
  derniere_latitude: string | null;
  derniere_longitude: string | null;
  position_maj_le: string | null;
}

export interface AffectationTransport {
  id: number;
  eleve: number;
  eleve_nom: string;
  classe_nom: string | null;
  trajet: number;
  trajet_nom: string;
  point_montee: string;
  date_debut: string;
}

export interface TicketBus {
  id: number;
  affectation: number;
  eleve_nom: string;
  trajet_nom: string;
  mois: string;
  montant: string;
  paye: boolean;
  date_paiement: string | null;
  qr_token: string;
  cree_le: string;
}

export interface ChauffeurEleveInfo {
  affectation_id: number;
  eleve_id: number;
  nom_complet: string;
  classe_nom: string | null;
  point_montee: string;
  statut_jour: "montee" | "descente" | null;
  ticket_paye: boolean | null;
}

export interface ChauffeurInfo {
  trajet: {
    id: number; nom: string; chauffeur_nom: string; vehicule_immatriculation: string;
    derniere_latitude: string | null; derniere_longitude: string | null; position_maj_le: string | null;
  };
  eleves: ChauffeurEleveInfo[];
}

export interface Formule {
  id: number;
  nom: string;
  responsable_nom: string;
  responsable_telephone: string;
  prix: string;
  capacite: number;
  heure_service: string | null;
  description: string;
  effectif: number;
  /** null pour tout le monde sauf l'Administrateur (lien secret sans authentification). */
  lien_agent: string | null;
}

export interface InscriptionCantine {
  id: number;
  eleve: number;
  eleve_nom: string;
  classe_nom: string | null;
  formule: number;
  formule_nom: string;
  date_debut: string;
}

export interface TicketCantine {
  id: number;
  inscription: number;
  eleve_nom: string;
  formule_nom: string;
  mois: string;
  montant: string;
  paye: boolean;
  date_paiement: string | null;
  qr_token: string;
  cree_le: string;
}

export interface AgentCantineEleveInfo {
  inscription_id: number;
  eleve_id: number;
  nom_complet: string;
  classe_nom: string | null;
  repas_pris: boolean;
  ticket_paye: boolean | null;
}

export interface AgentCantineInfo {
  formule: { id: number; nom: string; responsable_nom: string; heure_service: string | null };
  eleves: AgentCantineEleveInfo[];
}

export interface Message {
  id: number;
  expediteur: number;
  expediteur_nom: string;
  destinataire: number;
  destinataire_nom: string;
  contenu: string;
  type_message: "texte" | "vocal" | "fichier";
  fichier_nom: string | null;
  fichier_url: string | null;
  date_envoi: string;
  lu: boolean;
}

export type StatutTicket = "ouvert" | "en_cours" | "resolu" | "ferme";
export type PrioriteTicket = "basse" | "normale" | "haute" | "urgente";

export interface Ticket {
  id: number;
  ecole: number | null;
  ecole_nom: string | null;
  auteur: number;
  auteur_nom: string;
  auteur_role: string;
  sujet: string;
  statut: StatutTicket;
  statut_display: string;
  priorite: PrioriteTicket;
  priorite_display: string;
  cree_le: string;
  maj_le: string;
  assigne_a: number | null;
  assigne_a_nom: string | null;
  nombre_messages: number;
}

export interface MessageTicket {
  id: number;
  ticket: number;
  auteur: number;
  auteur_nom: string;
  auteur_role: string;
  contenu: string;
  fichier_nom: string | null;
  fichier_url: string | null;
  cree_le: string;
}

export interface Participant {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  role_display: string;
}

export interface Reunion {
  id: number;
  titre: string;
  description: string;
  organisateur: number;
  organisateur_nom: string;
  participants: number[];
  participants_detail: Participant[];
  /** Nom de la salle Jitsi Meet (meet.jit.si/<salle>) — la visioconférence elle-même n'est
   * pas hébergée par cette plateforme, voir VisioPage.tsx. */
  salle: string;
  date_debut: string;
  duree_minutes: number;
  statut: "planifiee" | "en_cours" | "terminee" | "annulee";
  statut_display: string;
  instantanee: boolean;
  /** false = appel audio (caméra coupée à l'entrée dans la salle, réactivable ensuite). */
  avec_video: boolean;
  date_creation: string;
  est_organisateur: boolean;
}

/** Un des 5 modèles de message personnalisables par école (création de compte, mensualité
 * impayée, absence, réunion des parents, résultats disponibles) — `sujet`/`contenu` vides
 * signifient "texte par défaut non personnalisé" côté backend (voir tenants/messages_templates.py). */
export interface ModeleMessage {
  cle: string;
  sujet: string;
  contenu: string;
  label: string;
  description: string;
  jetons: string[];
}

export interface Annonce {
  id: number;
  titre: string;
  contenu: string;
  auteur: number | null;
  auteur_nom: string | null;
  cible_role: "all" | Role;
  classe: number | null;
  classe_nom: string | null;
  ecole: number | null;
  ecole_nom: string | null;
  date_publication: string;
  epingle: boolean;
  envoyer_email: boolean;
  envoyer_sms: boolean;
  notifications_envoyees: boolean;
}
