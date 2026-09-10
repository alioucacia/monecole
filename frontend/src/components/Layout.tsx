import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { anneesApi, parametresEcoleApi, plateformeBrandingApi, unwrapList } from "../api/services";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
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

/** Compte à rebours de l'abonnement de l'établissement, affiché à son Administrateur. */
function AbonnementBadge({ ecole }: { ecole: Ecole | null }) {
  if (!ecole) return null;

  let texte: string;
  if (ecole.statut_abonnement === "paye") {
    texte = "Abonnement à jour ✓";
  } else if (ecole.statut_abonnement === "en_attente" && ecole.jours_avant_echeance !== null) {
    const j = ecole.jours_avant_echeance;
    texte = j > 0 ? `Échéance dans ${j} jour${j > 1 ? "s" : ""}` : "Échéance aujourd'hui";
  } else if (ecole.statut_abonnement === "en_retard" && ecole.jours_avant_blocage !== null) {
    const j = ecole.jours_avant_blocage;
    texte = j > 0 ? `⚠️ Blocage dans ${j} jour${j > 1 ? "s" : ""}` : "⚠️ Blocage imminent";
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
  const { annees, anneeId, setAnneeId } = useAnneesScolaires(!!user && user.role !== "superadmin");
  const ecoleAbonnement = useAbonnementEcole(!!user && user.role === "admin");
  const [nomPlateforme, setNomPlateforme] = useState<string | null>(null);
  useEffect(() => {
    plateformeBrandingApi.get().then(({ data }) => setNomPlateforme(data.nom_plateforme)).catch(() => {});
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
      <div className="flex flex-1 overflow-hidden">
      <aside className="w-64 shrink-0 gradient-sidebar flex flex-col no-print">
        <div className="h-16 flex items-center gap-2.5 px-5 shrink-0">
          <span className="text-2xl">🎒</span>
          <div className="min-w-0">
            <span className="font-extrabold text-white tracking-tight block leading-tight">{nomPlateforme || "École Manager"}</span>
            {user.ecole_nom && <span className="text-[11px] text-white/70 truncate block">{user.ecole_nom}</span>}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
          {categories.map((cat) => {
            const estOuverte = ouvertes.has(cat.label);
            return (
              <div key={cat.label}>
                <button
                  onClick={() => toggle(cat.label)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors"
                >
                  {cat.label}
                  <span className={`text-xs transition-transform duration-200 ${estOuverte ? "rotate-180" : ""}`}>▾</span>
                </button>
                {estOuverte && (
                  <div className="space-y-0.5 mb-2 animate-fade-in-up">
                    {cat.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-semibold transition-all ${
                            isActive
                              ? "bg-white text-brand-800 shadow-lg"
                              : "text-white/85 hover:bg-white/10 hover:text-white"
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span
                              className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-sm ${
                                isActive ? "bg-brand-100" : "bg-white/10"
                              }`}
                            >
                              {item.icon}
                            </span>
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 px-3 pb-3 pt-2 border-t border-white/10 space-y-2">
          <div className="text-center py-1">
            <p className="text-white/90 text-sm font-bold tabular-nums">{now.toLocaleTimeString("fr-FR")}</p>
            <p className="text-white/50 text-[11px]">{now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm rounded-full py-2.5 shadow-lg shadow-rose-900/20 transition-colors"
          >
            <span>↩</span> Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white/80 backdrop-blur-sm border-b border-slate-100 flex items-center justify-between px-6 no-print">
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-400 font-medium">Bonjour 👋</p>
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
          <div className="flex items-center gap-2">
            {user.role === "admin" && <AbonnementBadge ecole={ecoleAbonnement} />}
            <ThemeToggle />
            <NavLink to="/profil" className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full group hover:bg-slate-100 transition-colors">
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center font-bold text-sm shadow-soft group-hover:shadow-glow transition-shadow">
                {initials(displayName)}
              </div>
              <span className="font-bold text-ink-900 leading-tight group-hover:text-brand-700 transition-colors text-sm">{displayName}</span>
            </NavLink>
            <TopbarActions />
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold ${TOPBAR_ROLE_BADGE[user.role]}`}>
              {user.role_display}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}
