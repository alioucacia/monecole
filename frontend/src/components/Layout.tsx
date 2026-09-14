import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { anneesApi, justificatifsApi, parametresEcoleApi, plateformeBrandingApi, supportApi, unwrapList } from "../api/services";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useInactivityLogout } from "../hooks/useInactivityLogout";
import type { AnneeScolaire, Ecole, Role } from "../types";
import { Spinner } from "./ui";
import { TopbarActions } from "./TopbarActions";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
  // Clé de `tenants.features.FONCTIONNALITES` : masque l'entrée si le Super Admin a
  // désactivé ce module pour l'école de l'utilisateur connecté (voir EcoleDetailPage).
  feature?: string;
}

interface NavCategory {
  label: string;
  items: NavItem[];
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    label: "Plateforme",
    items: [
      { to: "/ecoles", label: "Établissements", icon: "🏫", roles: ["superadmin"] },
      { to: "/annuaire-utilisateurs", label: "Annuaire utilisateurs", icon: "👥", roles: ["superadmin"] },
      { to: "/transactions", label: "Transactions", icon: "🧾", roles: ["superadmin"] },
      { to: "/journal-activite", label: "Journal d'activité", icon: "🕓", roles: ["superadmin"] },
      { to: "/sauvegardes", label: "Sauvegardes", icon: "🗄️", roles: ["superadmin"] },
      { to: "/comptes-superadmin", label: "Comptes Super Admin", icon: "🛡️", roles: ["superadmin"] },
      { to: "/recherche-globale", label: "Recherche globale", icon: "🔎", roles: ["superadmin"] },
      { to: "/plans-abonnement", label: "Plans d'abonnement", icon: "🏷️", roles: ["superadmin"] },
      { to: "/annonces-plateforme", label: "Annonces plateforme", icon: "📢", roles: ["superadmin"] },
      { to: "/supervision", label: "Supervision technique", icon: "🩺", roles: ["superadmin"] },
      { to: "/parametres-plateforme", label: "Paramètres plateforme", icon: "⚙️", roles: ["superadmin"] },
    ],
  },
  {
    label: "Général",
    items: [
      { to: "/", label: "Tableau de bord", icon: "🏠", roles: ["admin", "teacher", "student", "parent", "comptabilite", "surveillance"] },
    ],
  },
  {
    label: "Pédagogie",
    items: [
      { to: "/eleves", label: "Élèves", icon: "🎓", roles: ["admin", "teacher", "comptabilite", "surveillance"] },
      { to: "/reinscription", label: "Réinscription", icon: "🔄", roles: ["admin"] },
      { to: "/enseignants", label: "Enseignants", icon: "🧑‍🏫", roles: ["admin"] },
      { to: "/classes", label: "Classes", icon: "🏫", roles: ["admin", "teacher"] },
      { to: "/matieres", label: "Matières", icon: "📚", roles: ["admin"] },
      { to: "/notes", label: "Notes", icon: "📝", roles: ["admin", "teacher", "student", "parent"] },
      { to: "/bulletins", label: "Bulletins", icon: "📄", roles: ["admin", "teacher", "student", "parent"] },
      { to: "/resultats", label: "Résultats", icon: "🏆", roles: ["admin", "teacher"] },
      { to: "/analyse-performance", label: "Analyse de performance", icon: "📈", roles: ["student", "parent"] },
      { to: "/assistant-ia", label: "Assistant IA", icon: "🤖", roles: ["student"], feature: "assistant_ia" },
    ],
  },
  {
    label: "Vie scolaire",
    items: [
      { to: "/presences", label: "Présences", icon: "✅", roles: ["admin", "teacher", "student", "parent", "surveillance"] },
      { to: "/justificatifs", label: "Justificatifs d'absence", icon: "📋", roles: ["admin", "student", "parent", "surveillance"], feature: "justificatifs" },
      { to: "/vie-scolaire", label: "Vie scolaire", icon: "🪪", roles: ["admin", "teacher", "student", "parent", "surveillance"] },
      { to: "/emploi-du-temps", label: "Emploi du temps", icon: "🗓️", roles: ["admin", "teacher", "student", "parent"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/paiements", label: "Paiements", icon: "💳", roles: ["admin", "student", "parent", "comptabilite"] },
      { to: "/caisse", label: "Caisse", icon: "🗃️", roles: ["admin", "comptabilite"] },
      { to: "/depenses", label: "Dépenses", icon: "🧮", roles: ["admin", "comptabilite"] },
    ],
  },
  {
    label: "Services",
    items: [
      { to: "/bibliotheque", label: "Bibliothèque", icon: "📖", roles: ["admin", "teacher", "student", "parent"], feature: "bibliotheque" },
      { to: "/transport", label: "Transport", icon: "🚌", roles: ["admin", "student", "parent", "comptabilite"], feature: "transport" },
      { to: "/cantine", label: "Cantine", icon: "🍽️", roles: ["admin", "student", "parent", "comptabilite"], feature: "cantine" },
    ],
  },
  {
    label: "Communication",
    items: [
      { to: "/messagerie", label: "Messagerie", icon: "✉️", roles: ["admin", "teacher", "student", "parent", "comptabilite", "surveillance"], feature: "messagerie" },
      { to: "/visioconference", label: "Visioconférence", icon: "📹", roles: ["admin", "teacher", "student", "parent", "comptabilite", "surveillance"], feature: "visioconference" },
      { to: "/annonces", label: "Annonces", icon: "📢", roles: ["admin", "teacher", "student", "parent", "comptabilite", "surveillance"], feature: "annonces" },
      { to: "/support", label: "Support technique", icon: "🆘", roles: ["superadmin", "admin", "teacher", "student", "parent", "comptabilite", "surveillance"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/personnel", label: "Ressources humaines", icon: "🧑‍💼", roles: ["admin", "teacher", "comptabilite", "surveillance"] },
      { to: "/personnel-admin", label: "Personnel administratif", icon: "🗂️", roles: ["admin"] },
      { to: "/comptes-ecole", label: "Comptes de l'établissement", icon: "🔑", roles: ["admin"] },
      { to: "/parametres-ecole", label: "Paramètres école", icon: "⚙️", roles: ["admin"] },
    ],
  },
];

const TOPBAR_ROLE_BADGE: Record<Role, string> = {
  superadmin: "bg-ink-900 text-white",
  admin: "bg-brand-100 text-brand-700",
  teacher: "bg-accent-100 text-accent-700",
  student: "bg-amber-100 text-amber-700",
  parent: "bg-rose-100 text-rose-700",
  comptabilite: "bg-teal-100 text-teal-700",
  surveillance: "bg-indigo-100 text-indigo-700",
};

/** Interrupteur clair/sombre affiché dans le topbar, à côté du profil. */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const estSombre = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={estSombre ? "Passer au thème clair" : "Passer au thème sombre"}
      aria-label="Changer de thème"
      aria-pressed={estSombre}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300 ${estSombre ? "bg-ink-900" : "bg-slate-200"}`}
    >
      <span
        className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-soft flex items-center justify-center text-xs transition-transform duration-300 ${estSombre ? "translate-x-6" : "translate-x-0"}`}
      >
        {estSombre ? "🌙" : "☀️"}
      </span>
    </button>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const OUVERTES_KEY = "sidebar_categories_ouvertes";

/** Les catégories de la sidebar sont des listes déroulantes : repliées par défaut, sauf celle
 * qui contient la page courante (ouverte automatiquement à la navigation). L'état ouvert/fermé
 * choisi par l'utilisateur est mémorisé d'une session à l'autre. */
function useCategoriesOuvertes(categories: NavCategory[], pathname: string) {
  const [ouvertes, setOuvertes] = useState<Set<string>>(() => {
    try {
      const sauvegarde = localStorage.getItem(OUVERTES_KEY);
      return sauvegarde ? new Set(JSON.parse(sauvegarde)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    const active = categories.find((cat) =>
      cat.items.some((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to)))
    );
    if (active) {
      setOuvertes((prev) => (prev.has(active.label) ? prev : new Set(prev).add(active.label)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(OUVERTES_KEY, JSON.stringify([...ouvertes]));
    } catch {
      // stockage indisponible (navigation privée...) — tant pis, pas bloquant
    }
  }, [ouvertes]);

  const toggle = (label: string) => {
    setOuvertes((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return { ouvertes, toggle };
}

const COLLAPSED_KEY = "sidebar_repliee";

/** La sidebar entière peut être repliée en mode icônes (largeur réduite, libellés masqués).
 * L'état choisi par l'utilisateur est mémorisé d'une session à l'autre, comme pour les
 * catégories déroulantes ci-dessus. */
function useSidebarRepliee() {
  const [repliee, setRepliee] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, repliee ? "1" : "0");
    } catch {
      // stockage indisponible (navigation privée...) — tant pis, pas bloquant
    }
  }, [repliee]);

  return { repliee, toggle: () => setRepliee((r) => !r) };
}

/** Nombre de justificatifs d'absence en attente de validation — affiché en badge sur
 * l'entrée « Justificatifs d'absence » de la sidebar, uniquement pour les rôles qui les
 * traitent (admin, surveillance). Se rafraîchit toutes les 30 secondes. */
function useJustificatifsEnAttente(actif: boolean) {
  const [nombre, setNombre] = useState(0);

  useEffect(() => {
    if (!actif) return;
    const charger = () =>
      justificatifsApi.list({ statut: "en_attente", page_size: 1 }).then(({ data }) => {
        if (!Array.isArray(data)) setNombre(data.count);
      }).catch(() => {});
    charger();
    const id = setInterval(charger, 30000);
    return () => clearInterval(id);
  }, [actif]);

  return nombre;
}

/** Nombre de tickets de support actifs (ouvert/en cours) pertinents pour l'utilisateur connecté
 * — affiché en badge sur l'entrée « Support technique » de la sidebar. Contrairement aux
 * justificatifs, concerne TOUS les rôles (chacun peut ouvrir un ticket), donc toujours actif
 * tant qu'un utilisateur est connecté. Se rafraîchit toutes les 30 secondes. */
function useSupportBadge(actif: boolean) {
  const [nombre, setNombre] = useState(0);

  useEffect(() => {
    if (!actif) return;
    const charger = () => supportApi.compteur().then(({ data }) => setNombre(data.actifs)).catch(() => {});
    charger();
    const id = setInterval(charger, 30000);
    return () => clearInterval(id);
  }, [actif]);

  return nombre;
}

/** Liste des années scolaires de l'établissement, pour la sous-liste déroulante du topbar
 * (non applicable au Super Admin, qui n'est rattaché à aucun établissement). */
function useAnneesScolaires(actif: boolean) {
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [anneeId, setAnneeId] = useState<number | null>(null);

  useEffect(() => {
    if (!actif) return;
    anneesApi.list().then(({ data }) => {
      const liste = unwrapList(data);
      setAnnees(liste);
      const active = liste.find((a) => a.active);
      setAnneeId(active?.id ?? liste[0]?.id ?? null);
    }).catch(() => {});
  }, [actif]);

  return { annees, anneeId, setAnneeId };
}

/** Statut d'abonnement de l'établissement, pour le compte à rebours affiché à son
 * Administrateur dans le topbar (non applicable aux autres rôles). Se rafraîchit toutes
 * les 5 minutes : le compte à rebours se décrémente d'un jour à minuit sans que l'admin
 * ait besoin de recharger la page pendant la journée. */
function useAbonnementEcole(actif: boolean) {
  const [ecole, setEcole] = useState<Ecole | null>(null);

  useEffect(() => {
    if (!actif) return;
    const charger = () => parametresEcoleApi.get().then(({ data }) => setEcole(data)).catch(() => {});
    charger();
    const id = setInterval(charger, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [actif]);

  return ecole;
}

const ABONNEMENT_TONE: Record<string, string> = {
  paye: "bg-emerald-50 text-emerald-700",
  en_attente: "bg-slate-100 text-slate-600",
  en_retard: "bg-amber-100 text-amber-700",
  bloque: "bg-rose-100 text-rose-700",
  suspendu: "bg-rose-100 text-rose-700",
};

/** Jours restants avant la prochaine échéance de paiement, quand le mois en cours est déjà
 * payé (le statut redevient "en_attente" — pas "en retard" — dès le 1er du mois suivant, avec
 * une nouvelle échéance au même jour du mois — voir Ecole.jour_echeance côté backend). Calcul
 * 100% côté client : ne dépend que de la date du jour et du jour d'échéance de l'école. */
function joursAvantProchaineEcheance(jourEcheance: number): number {
  const aujourdhui = new Date();
  const jour = Math.min(jourEcheance, 28);
  const debutAujourdhui = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
  const prochaine = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() + 1, jour);
  return Math.round((prochaine.getTime() - debutAujourdhui.getTime()) / 86400000);
}

/** Compte à rebours de l'abonnement de l'établissement, affiché à son Administrateur. */
function AbonnementBadge({ ecole }: { ecole: Ecole | null }) {
  if (!ecole) return null;

  let texte: string;
  if (ecole.statut_abonnement === "paye") {
    const j = joursAvantProchaineEcheance(ecole.jour_echeance);
    texte = `✓ Jours restant ${j}`;
  } else if (ecole.statut_abonnement === "en_attente" && ecole.jours_avant_echeance !== null) {
    const j = ecole.jours_avant_echeance;
    texte = j > 0 ? `Jours restant ${j}` : "Échéance aujourd'hui";
  } else if (ecole.statut_abonnement === "en_retard" && ecole.jours_avant_blocage !== null) {
    const j = ecole.jours_avant_blocage;
    texte = j > 0 ? `⚠️ Blocage dans ${j}j` : "⚠️ Blocage imminent";
  } else if (ecole.statut_abonnement === "bloque") {
    texte = "🚫 Accès bloqué — abonnement impayé";
  } else {
    texte = "🚫 Compte suspendu";
  }

  return (
    <NavLink
      to="/parametres-ecole"
      title="Voir les paramètres de l'abonnement"
      className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition hover:brightness-95 ${ABONNEMENT_TONE[ecole.statut_abonnement]}`}
    >
      {texte}
    </NavLink>
  );
}

export function ProtectedRoute(
  { children, roles, feature }: { children: ReactNode; roles?: Role[]; feature?: string }
) {
  const { user, loading, enModeSupport } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Compte créé par un administrateur (ou mot de passe réinitialisé) : mot de passe temporaire
  // à changer avant tout autre accès — sauf sur la page qui permet justement de le faire, et
  // sauf en mode support (le Super Admin qui consulte le compte n'a pas à en changer le mot
  // de passe pour continuer à naviguer).
  if (user.doit_changer_mot_de_passe && !enModeSupport && pathname !== "/changer-mot-de-passe") {
    return <Navigate to="/changer-mot-de-passe" replace />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  // Module désactivé par le Super Admin pour cette école (voir EcoleDetailPage) : bloque
  // l'accès direct par URL, en plus du masquage dans la navigation ci-dessous.
  if (feature && user.ecole_fonctionnalites_desactivees?.includes(feature)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AppLayout() {
  const { user, logout, enModeSupport, quitterModeSupport } = useAuth();
  useInactivityLogout(logout);
  const now = useClock();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const fonctionnalitesDesactivees = user?.ecole_fonctionnalites_desactivees ?? [];
  const categories = NAV_CATEGORIES
    .map((cat) => ({
      ...cat,
      items: cat.items.filter((item) =>
        user && item.roles.includes(user.role) && (!item.feature || !fonctionnalitesDesactivees.includes(item.feature))
      ),
    }))
    .filter((cat) => cat.items.length > 0);
  const { ouvertes, toggle } = useCategoriesOuvertes(categories, pathname);
  const { repliee, toggle: toggleSidebar } = useSidebarRepliee();
  // Sur mobile, la sidebar est un tiroir hors-écran (repliée par défaut, ouverte via le bouton
  // ☰ du topbar) plutôt que la colonne fixe utilisée sur desktop — distinct de `repliee`
  // ci-dessus (le mode icônes, lui, ne concerne que le desktop). Se referme automatiquement à
  // chaque navigation pour ne pas rester ouvert par-dessus la page suivante.
  const [mobileOuvert, setMobileOuvert] = useState(false);
  useEffect(() => setMobileOuvert(false), [pathname]);
  const peutTraiterJustificatifs = !!user && (user.role === "admin" || user.role === "surveillance");
  const justificatifsEnAttente = useJustificatifsEnAttente(
    peutTraiterJustificatifs && !fonctionnalitesDesactivees.includes("justificatifs")
  );
  const ticketsActifs = useSupportBadge(!!user);
  const badges: Record<string, number> = {};
  if (justificatifsEnAttente > 0) badges["/justificatifs"] = justificatifsEnAttente;
  if (ticketsActifs > 0) badges["/support"] = ticketsActifs;
  const { annees, anneeId, setAnneeId } = useAnneesScolaires(!!user && user.role !== "superadmin");
  const ecoleAbonnement = useAbonnementEcole(!!user && user.role === "admin");
  const [nomPlateforme, setNomPlateforme] = useState<string | null>(null);
  const [logoPlateforme, setLogoPlateforme] = useState<string | null>(null);
  useEffect(() => {
    plateformeBrandingApi.get().then(({ data }) => {
      setNomPlateforme(data.nom_plateforme);
      setLogoPlateforme(data.logo);
    }).catch(() => {});
  }, []);
  if (!user) return null;

  const displayName = user.full_name || user.username;

  const handleQuitterSupport = async () => {
    await quitterModeSupport();
    navigate("/ecoles");
  };

  return (
    <div className="flex h-screen overflow-hidden flex-col">
      {enModeSupport && (
        <div className="h-9 shrink-0 bg-amber-500 text-white text-sm font-semibold flex items-center justify-center gap-3 no-print">
          🛠️ Mode support — connecté en tant que {displayName}
          <button onClick={handleQuitterSupport} className="underline hover:no-underline font-bold">
            Revenir au Super Admin
          </button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden relative">
      {mobileOuvert && (
        <div
          className="fixed inset-0 z-30 bg-ink-950/50 md:hidden no-print"
          onClick={() => setMobileOuvert(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 md:static md:z-auto md:translate-x-0 ${
          mobileOuvert ? "translate-x-0" : "-translate-x-full"
        } ${repliee ? "md:w-20" : "md:w-64"} shrink-0 gradient-sidebar flex flex-col no-print transition-transform md:transition-[width] duration-300`}
      >
        <button
          type="button"
          onClick={toggleSidebar}
          title={repliee ? "Déplier la sidebar" : "Replier la sidebar"}
          aria-label={repliee ? "Déplier la sidebar" : "Replier la sidebar"}
          className="absolute -right-3 top-6 hidden md:flex h-7 w-7 rounded-full bg-white shadow-md ring-1 ring-black/5 items-center justify-center text-ink-500 hover:text-brand-600 hover:shadow-lg active:scale-95 transition-all duration-200 z-10"
        >
          <svg viewBox="0 0 20 20" fill="none" className={`h-3.5 w-3.5 transition-transform duration-300 ${repliee ? "rotate-180" : ""}`}>
            <path d="M12.5 5L7.5 10L12.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setMobileOuvert(false)}
          title="Fermer le menu"
          aria-label="Fermer le menu"
          className="absolute right-3 top-4 flex md:hidden h-8 w-8 rounded-full bg-white/10 items-center justify-center text-white text-lg hover:bg-white/20 transition-colors z-10"
        >
          ×
        </button>

        <div className={`h-16 flex items-center gap-2.5 shrink-0 ${repliee ? "justify-center px-2" : "px-5"}`}>
          {/* Le logo et le nom affichés sont ceux de L'ÉCOLE du compte connecté quand elle en a
              un (chaque école a le sien, modifiable par son Admin — voir ParametresEcolePage) —
              seul le Super Admin, qui n'appartient à aucune école, voit la marque de la
              plateforme elle-même. */}
          {(user.ecole_logo || logoPlateforme) ? (
            <img src={user.ecole_logo || logoPlateforme!} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
          ) : (
            <span className="text-2xl">🎒</span>
          )}
          {!repliee && (
            <div className="min-w-0">
              <span className="font-extrabold text-white tracking-tight block leading-tight text-base truncate">
                {user.ecole_nom || nomPlateforme || "Taly-School"}
              </span>
              {user.ecole_nom && <span className="text-[11px] text-white/70 truncate block">{nomPlateforme || "Taly-School"}</span>}
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {categories.map((cat) => {
            const estOuverte = ouvertes.has(cat.label);
            const badgeCategorie = cat.items.reduce((total, item) => total + (badges[item.to] ?? 0), 0);
            return (
              <div key={cat.label}>
                {!repliee && (
                  <button
                    onClick={() => toggle(cat.label)}
                    className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      {cat.label}
                      {!estOuverte && badgeCategorie > 0 && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                    </span>
                    <span className={`text-xs transition-transform duration-200 ${estOuverte ? "rotate-180" : ""}`}>▾</span>
                  </button>
                )}
                {(repliee || estOuverte) && (
                  <div className="space-y-0.5 mb-2 animate-fade-in-up">
                    {cat.items.map((item) => {
                      const badge = badges[item.to] ?? 0;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === "/"}
                          title={repliee ? item.label : undefined}
                          className={({ isActive }) =>
                            `flex items-center gap-3 py-2.5 rounded-full text-sm font-semibold transition-all ${
                              repliee ? "justify-center px-0" : "px-3"
                            } ${
                              isActive
                                ? "bg-white text-brand-800 shadow-lg"
                                : "text-white/85 hover:bg-white/10 hover:text-white hover:translate-x-1"
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span
                                className={`relative h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-sm ${
                                  isActive ? "bg-brand-100" : "bg-white/10"
                                }`}
                              >
                                {item.icon}
                                {repliee && badge > 0 && (
                                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                                    {badge > 9 ? "9+" : badge}
                                  </span>
                                )}
                              </span>
                              {!repliee && (
                                <>
                                  <span className="truncate flex-1">{item.label}</span>
                                  {badge > 0 && (
                                    <span
                                      className={`h-5 min-w-[20px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                                        isActive ? "bg-rose-500 text-white" : "bg-rose-500/90 text-white"
                                      }`}
                                    >
                                      {badge > 99 ? "99+" : badge}
                                    </span>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 px-3 pb-3 pt-2 border-t border-white/10 space-y-2">
          {!repliee && (
            <div className="text-center py-1">
              <p className="text-white/90 text-sm font-bold tabular-nums">{now.toLocaleTimeString("fr-FR")}</p>
              <p className="text-white/50 text-[11px]">{now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
            </div>
          )}

          <button
            onClick={logout}
            title={repliee ? "Déconnexion" : undefined}
            className="w-full flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm rounded-full py-2.5 shadow-lg shadow-rose-900/20 transition-colors"
          >
            <span>↩</span> {!repliee && "Déconnexion"}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* `min-h-16` + `flex-wrap` (au lieu de `h-16` fixe sans wrap) : sur un écran étroit, le
            sélecteur d'année scolaire (groupe de gauche) et le badge d'abonnement (groupe de
            droite, ni l'un ni l'autre compressible) ne tenaient plus côte à côte sur une seule
            ligne de 64px et se chevauchaient au lieu de passer à la ligne — l'en-tête grandit
            maintenant simplement d'une ligne quand c'est nécessaire, sans effet sur le bureau où
            tout continue de tenir sur une seule ligne. */}
        <header className="min-h-16 bg-white/80 backdrop-blur-sm border-b border-slate-100 flex flex-wrap items-center justify-between gap-y-2 py-2 px-3 sm:px-6 no-print">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOuvert(true)}
              title="Ouvrir le menu"
              aria-label="Ouvrir le menu"
              className="md:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-brand-700 transition mr-1"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                <path d="M3 5.5H17M3 10H17M3 14.5H17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <p className="text-sm text-slate-400 font-medium hidden sm:block shrink-0">Bonjour 👋</p>
            {annees.length > 0 && (
              <select
                value={anneeId ?? ""}
                onChange={(e) => setAnneeId(Number(e.target.value))}
                title="Année scolaire de la session"
                className="text-sm font-semibold text-slate-600 bg-slate-100 border-none rounded-full pl-3 pr-7 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {annees.map((a) => (
                  <option key={a.id} value={a.id}>{a.libelle}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {user.role === "admin" && <AbonnementBadge ecole={ecoleAbonnement} />}
            <ThemeToggle />
            <NavLink to="/profil" className="flex items-center gap-2.5 pl-1 pr-1 sm:pr-3 py-1 rounded-full group hover:bg-slate-100 transition-colors">
              <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-bold text-sm shadow-soft group-hover:shadow-glow transition-shadow">
                {initials(displayName)}
              </div>
              <span className="hidden sm:block font-bold text-ink-900 leading-tight group-hover:text-brand-700 transition-colors text-sm">{displayName}</span>
            </NavLink>
            <TopbarActions />
            <span className={`hidden md:inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold ${TOPBAR_ROLE_BADGE[user.role]}`}>
              {user.role_display}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 sm:p-6">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}
