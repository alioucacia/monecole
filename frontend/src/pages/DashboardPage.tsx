import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, Navigate } from "react-router-dom";

import { dashboardApi } from "../api/services";
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from "../components/ui";
import { useAuth } from "../context/AuthContext";

const JOUR_LABELS: Record<string, string> = {
  lundi: "Lundi", mardi: "Mardi", mercredi: "Mercredi", jeudi: "Jeudi", vendredi: "Vendredi", samedi: "Samedi",
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === "superadmin") {
      setLoading(false);
      return;
    }
    dashboardApi.get().then(({ data }) => setData(data)).finally(() => setLoading(false));
  }, [user]);

  if (user?.role === "superadmin") return <Navigate to="/ecoles" replace />;
  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!data || !user) return <EmptyState title="Aucune donnée à afficher" />;

  return (
    <div>
      {(user.ecole_logo || user.ecole_nom) && (
        <div className="flex items-center gap-3 mb-4">
          {user.ecole_logo && (
            <img src={user.ecole_logo} alt={user.ecole_nom || "Logo de l'école"} className="h-12 w-12 rounded-xl object-cover border border-slate-100 shadow-soft shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-bold text-ink-900 truncate">{user.ecole_nom}</p>
            {user.ecole_adresse && <p className="text-xs text-slate-400 truncate">{user.ecole_adresse}</p>}
          </div>
        </div>
      )}

      <PageHeader title={`Tableau de bord — ${user.role_display}`} description="Vue d'ensemble de votre espace." />

      {user.role === "admin" && <AdminDashboard data={data} />}
      {user.role === "teacher" && <TeacherDashboard data={data} />}
      {user.role === "student" && <StudentDashboard data={data} />}
      {user.role === "parent" && <ParentDashboard data={data} />}
      {user.role === "comptabilite" && <ComptabiliteDashboard data={data} />}
      {user.role === "surveillance" && <SurveillanceDashboard data={data} />}
    </div>
  );
}

const ACCES_RAPIDE = [
  { to: "/eleves", label: "Nouvelle inscription", icon: "🧑‍🎓", color: "bg-blue-500 hover:bg-blue-600" },
  { to: "/reinscription", label: "Nouvelle réinscription", icon: "🔄", color: "bg-fuchsia-500 hover:bg-fuchsia-600" },
  { to: "/personnel-admin", label: "Inscription personnel", icon: "🗂️", color: "bg-teal-500 hover:bg-teal-600" },
  { to: "/notes", label: "Nouvelle saisie de notes", icon: "📝", color: "bg-rose-500 hover:bg-rose-600" },
  { to: "/emploi-du-temps", label: "Nouvel emploi du temps", icon: "🗓️", color: "bg-emerald-500 hover:bg-emerald-600" },
];

const PAIEMENT_COLORS = ["#22c55e", "#f43f5e"];

function AdminDashboard({ data }: { data: Record<string, any> }) {
  const paiementData = [
    { name: "Total payé", value: Number(data.total_encaisse) },
    { name: "Reste à payer", value: Math.max(Number(data.total_attendu) - Number(data.total_encaisse), 0) },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="font-bold text-ink-900 mb-4 flex items-center gap-2"><span>🔗</span> Accès rapide</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {ACCES_RAPIDE.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className={`${a.color} text-white rounded-2xl px-3 py-4 text-center text-xs font-bold uppercase tracking-wide shadow-soft transition-transform hover:-translate-y-0.5 flex flex-col items-center gap-2`}
            >
              <span className="text-2xl">{a.icon}</span>
              {a.label}
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">🎓 Nombre d'élèves</p>
          <p className="text-2xl font-extrabold text-ink-900 mb-2">{data.total_eleves}</p>
          <div className="flex justify-between text-xs">
            <span className="text-rose-500 font-semibold">Filles <b>{data.eleves_filles}</b></span>
            <span className="text-blue-500 font-semibold">Garçons <b>{data.eleves_garcons}</b></span>
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">🧑‍🏫 Nombre du personnel</p>
          <p className="text-2xl font-extrabold text-ink-900 mb-2">{data.total_enseignants}</p>
          <div className="flex justify-between text-xs">
            <span className="text-rose-500 font-semibold">Femme <b>{data.enseignants_femmes}</b></span>
            <span className="text-blue-500 font-semibold">Homme <b>{data.enseignants_hommes}</b></span>
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">🏫 Nombre de classes</p>
          <p className="text-2xl font-extrabold text-ink-900 mb-2">{data.total_classes}</p>
          <div className="flex flex-wrap gap-1">
            {data.classes_par_niveau.map((n: any) => (
              <Badge key={n.niveau} color="amber">{n.niveau} : {n.nb}</Badge>
            ))}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">💳 Paiement de scolarité</p>
          <p className="text-2xl font-extrabold text-ink-900 mb-2">{data.taux_recouvrement ?? "—"}%</p>
          <div className="flex justify-between text-xs">
            <span className="text-emerald-600 font-semibold">Payé {money(data.total_encaisse)}</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <h3 className="font-bold text-ink-900 mb-4">Effectif par classe</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.eleves_par_classe}>
              <defs>
                <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#6d28d9" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="nom" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="nb_eleves" fill="url(#barFill)" radius={[8, 8, 0, 0]} name="Élèves" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-bold text-ink-900 mb-2">Taux d'avancement des paiements</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={paiementData} dataKey="value" innerRadius={55} outerRadius={80} paddingAngle={3}>
                {paiementData.map((_, i) => <Cell key={i} fill={PAIEMENT_COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => money(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 text-xs mt-2">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Total payé</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Reste à payer</span>
          </div>
          <Link to="/paiements" className="mt-3 inline-block text-sm text-brand-600 font-medium hover:underline">
            Voir les paiements →
          </Link>
        </Card>
      </div>

      <Card>
        <h3 className="font-bold text-ink-900 mb-4">Dernières annonces</h3>
        {data.dernieres_annonces.length === 0 ? (
          <EmptyState title="Aucune annonce publiée" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.dernieres_annonces.map((a: any) => (
              <li key={a.id} className="py-3 flex items-center justify-between">
                <span className="font-medium text-slate-700">{a.titre}</span>
                <span className="text-xs text-slate-400">{new Date(a.date_publication).toLocaleDateString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TeacherDashboard({ data }: { data: Record<string, any> }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="Mes classes" value={data.nombre_classes} icon="🏫" accent="brand" />
        <StatCard label="Mes matières" value={data.nombre_matieres} icon="📚" accent="green" />
      </div>

      <Card>
        <h3 className="font-bold text-ink-900 mb-4">Cours d'aujourd'hui</h3>
        {data.creneaux_du_jour.length === 0 ? (
          <EmptyState title="Pas de cours aujourd'hui" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.creneaux_du_jour.map((c: any) => (
              <li key={c.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-700">{c.enseignement__matiere__nom} — {c.classe__nom}</p>
                  <p className="text-slate-400">Salle {c.salle}</p>
                </div>
                <Badge color="brand">{c.heure_debut.slice(0, 5)} - {c.heure_fin.slice(0, 5)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="font-bold text-ink-900 mb-4">Dernières notes saisies</h3>
        {data.dernieres_notes.length === 0 ? (
          <EmptyState title="Aucune note saisie récemment" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.dernieres_notes.map((n: any) => (
              <li key={n.id} className="py-3 flex items-center justify-between text-sm">
                <span>{n.eleve__first_name} {n.eleve__last_name} — {n.matiere__nom}</span>
                <Badge>{n.valeur}/20</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StudentDashboard({ data }: { data: Record<string, any> }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Moyenne générale" value={data.moyenne_generale !== null ? `${data.moyenne_generale}/20` : "—"} icon="📊" accent="brand" />
        <StatCard label="Taux de présence" value={data.taux_presence !== null ? `${data.taux_presence}%` : "—"} icon="✅" accent="green" />
        <StatCard label="Solde à payer" value={money(data.solde_frais)} icon="💳" accent={Number(data.solde_frais) > 0 ? "rose" : "green"} />
      </div>

      <Card>
        <h3 className="font-bold text-ink-900 mb-4">Classe : {data.classe ?? "—"}</h3>
        <h4 className="text-sm font-medium text-slate-500 mb-2">Prochains cours</h4>
        {data.prochains_creneaux.length === 0 ? (
          <EmptyState title="Aucun cours programmé" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.prochains_creneaux.map((c: any, i: number) => (
              <li key={i} className="py-3 flex items-center justify-between text-sm">
                <span>{JOUR_LABELS[c.jour] ?? c.jour} — {c.enseignement__matiere__nom}</span>
                <Badge color="brand">{c.heure_debut.slice(0, 5)} - {c.heure_fin.slice(0, 5)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ComptabiliteDashboard({ data }: { data: Record<string, any> }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total attendu" value={money(data.total_attendu)} icon="📥" accent="brand" />
        <StatCard label="Total encaissé" value={money(data.total_encaisse)} icon="💰" accent="green" />
        <StatCard label="Élèves en impayé" value={data.nb_eleves_impayes} icon="⚠️" accent="rose" />
        <StatCard label="Fiches de paie en attente" value={data.paies_enseignants_en_attente} icon="🧾" accent="amber" />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-ink-900">Taux de recouvrement</h3>
          <span className="text-lg font-bold text-brand-700">{data.taux_recouvrement ?? "—"}%</span>
        </div>
        <p className="text-sm text-slate-500">Solde restant à encaisser : <span className="font-semibold text-rose-600">{money(data.solde_total)}</span></p>
        <Link to="/paiements" className="mt-4 inline-block text-sm text-brand-600 font-medium hover:underline">Gérer les paiements →</Link>
      </Card>

      <Card>
        <h3 className="font-bold text-ink-900 mb-4">Derniers paiements encaissés</h3>
        {data.derniers_paiements.length === 0 ? (
          <EmptyState title="Aucun paiement enregistré" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.derniers_paiements.map((p: any) => (
              <li key={p.id} className="py-3 flex items-center justify-between text-sm">
                <span>{p.frais__eleve__user__first_name} {p.frais__eleve__user__last_name}</span>
                <span className="font-semibold text-green-600">{money(p.montant)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SurveillanceDashboard({ data }: { data: Record<string, any> }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Élèves inscrits" value={data.total_eleves} icon="🎓" accent="brand" />
        <StatCard label="Taux de présence" value={data.taux_presence_global !== null ? `${data.taux_presence_global}%` : "—"} icon="✅" accent="green" />
        <StatCard label="Absents aujourd'hui" value={data.absents_du_jour} icon="🚫" accent="rose" />
      </div>

      <Card>
        <h3 className="font-bold text-ink-900 mb-4">Alertes récentes envoyées aux parents</h3>
        {data.alertes_recentes.length === 0 ? (
          <EmptyState title="Aucune alerte récente" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.alertes_recentes.map((a: any) => (
              <li key={a.id} className="py-3 text-sm">
                <p className="font-medium text-slate-700">{a.eleve__user__first_name} {a.eleve__user__last_name}</p>
                <p className="text-slate-500 text-xs">{a.message}</p>
              </li>
            ))}
          </ul>
        )}
        <Link to="/presences" className="mt-4 inline-block text-sm text-brand-600 font-medium hover:underline">Gérer les présences →</Link>
      </Card>
    </div>
  );
}

function ParentDashboard({ data }: { data: Record<string, any> }) {
  if (!data.enfants || data.enfants.length === 0) {
    return <EmptyState title="Aucun enfant rattaché à ce compte" />;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {data.enfants.map((enfant: any) => (
        <Card key={enfant.id}>
          <h3 className="font-bold text-ink-900">{enfant.nom_complet}</h3>
          <p className="text-sm text-slate-500 mb-4">{enfant.classe ?? "Classe non assignée"}</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Taux de présence</span><span className="font-medium">{enfant.taux_presence !== null ? `${enfant.taux_presence}%` : "—"}</span></div>
            <div className="flex justify-between">
              <span className="text-slate-500">Solde à payer</span>
              <span className={`font-medium ${Number(enfant.solde_frais) > 0 ? "text-rose-600" : "text-green-600"}`}>{money(enfant.solde_frais)}</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
