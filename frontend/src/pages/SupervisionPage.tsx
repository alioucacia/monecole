import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ecolesApi, supervisionApi } from "../api/services";
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard, Table } from "../components/ui";
import type { EcoleStatsGlobales, SupervisionData } from "../types";

function taille(octets: number) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  if (octets < 1024 * 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(octets / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

export default function SupervisionPage() {
  const [data, setData] = useState<SupervisionData | null>(null);
  const [ecoleStats, setEcoleStats] = useState<EcoleStatsGlobales | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([supervisionApi.get(), ecolesApi.stats()])
      .then(([supervisionRes, ecoleStatsRes]) => {
        setData(supervisionRes.data);
        setEcoleStats(ecoleStatsRes.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!data) return <EmptyState title="Impossible de charger les données de supervision" />;

  const derniere = data.dernieres_sauvegardes[0];
  const pctDisque = data.disque ? Math.round((data.disque.utilise_octets / data.disque.total_octets) * 100) : null;
  const disqueCritique = pctDisque !== null && pctDisque >= 90;
  const sauvegardeStale = data.jours_depuis_derniere_sauvegarde_reussie !== null && data.jours_depuis_derniere_sauvegarde_reussie > 2;

  return (
    <div>
      <PageHeader
        title="Supervision technique"
        description="Santé, sécurité et volumétrie de toute la plateforme."
        actions={<Link to="/sauvegardes" className="text-sm text-brand-600 font-medium hover:underline">Voir toutes les sauvegardes →</Link>}
      />

      {/* Alertes prioritaires — visibles en un coup d'œil avant tout le reste */}
      {(data.debug_actif || disqueCritique || sauvegardeStale) && (
        <div className="space-y-2 mb-6">
          {data.debug_actif && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-800">
              <span className="text-lg">🚨</span>
              <span><strong>Mode DEBUG activé</strong> — à désactiver impérativement en production (expose des informations sensibles en cas d'erreur).</span>
            </div>
          )}
          {disqueCritique && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-800">
              <span className="text-lg">💽</span>
              <span><strong>Disque presque plein</strong> ({pctDisque}% utilisé) — libérez de l'espace ou augmentez le stockage du serveur.</span>
            </div>
          )}
          {sauvegardeStale && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <span className="text-lg">⏰</span>
              <span><strong>Sauvegarde en retard</strong> — dernière sauvegarde réussie il y a {data.jours_depuis_derniere_sauvegarde_reussie} jours. Vérifiez la tâche planifiée.</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Taille de la base de données" value={taille(data.taille_base_donnees_octets)} icon="🗄️" accent="brand" />
        <StatCard label="Taille des médias (photos, logos…)" value={taille(data.taille_media_octets)} icon="🖼️" accent="teal" />
        <StatCard label="Écoles actives / total" value={`${data.nombre_ecoles_actives} / ${data.nombre_ecoles}`} icon="🏫" accent="green" />
        <StatCard label="Utilisateurs (toutes écoles)" value={data.nombre_utilisateurs_total} icon="👥" accent="amber" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Actifs dans les dernières 24h" value={data.utilisateurs_actifs_24h} icon="🟢" accent="green" />
        <StatCard label="Actifs sur 7 jours" value={data.utilisateurs_actifs_7j} icon="📅" accent="brand" />
        <StatCard label="Jamais connectés" value={data.utilisateurs_jamais_connectes} icon="💤" accent="rose" />
      </div>

      {ecoleStats && ecoleStats.ecoles_a_surveiller.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 mb-6">
          <h3 className="font-bold text-amber-800 mb-2">⚠️ Écoles à relancer avant blocage</h3>
          <ul className="space-y-1.5">
            {ecoleStats.ecoles_a_surveiller.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <Link to={`/ecoles/${e.id}`} className="text-amber-900 font-medium hover:underline">{e.nom}</Link>
                <Badge color="amber">{e.jours_avant_blocage} jour{e.jours_avant_blocage > 1 ? "s" : ""} avant blocage</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-ink-900">Dernières sauvegardes</h3>
            {derniere && <Badge color={derniere.statut === "succes" ? "green" : "rose"}>{derniere.statut === "succes" ? "Dernière : succès" : "Dernière : échec"}</Badge>}
          </div>
          {data.dernieres_sauvegardes.length === 0 ? (
            <EmptyState title="Aucune sauvegarde enregistrée" />
          ) : (
            <Table headers={["Date", "Statut", "Taille", "Durée"]}>
              {data.dernieres_sauvegardes.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-3 text-slate-600 text-sm">{new Date(log.date_lancement).toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-3"><Badge color={log.statut === "succes" ? "green" : "rose"}>{log.statut === "succes" ? "Succès" : "Échec"}</Badge></td>
                  <td className="px-4 py-3 text-sm">{taille(log.taille_octets)}</td>
                  <td className="px-4 py-3 text-sm">{log.duree_secondes.toFixed(1)} s</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <h3 className="font-bold text-ink-900 mb-4">Environnement serveur</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Django</span><span className="font-semibold">{data.version_django}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Python</span><span className="font-semibold">{data.version_python} ({data.interpreteur_python})</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Base de données</span><span className="font-semibold uppercase">{data.moteur_base_donnees}</span></div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 shrink-0">Système</span>
              <span className="font-semibold text-right truncate" title={data.plateforme_serveur}>{data.plateforme_serveur}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Mode DEBUG</span>
              <Badge color={data.debug_actif ? "rose" : "green"}>{data.debug_actif ? "Activé" : "Désactivé"}</Badge>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {data.disque && (
          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Espace disque du serveur</h3>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden mb-2">
              <div
                className={`h-full rounded-full ${disqueCritique ? "bg-rose-500" : pctDisque && pctDisque >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${pctDisque}%` }}
              />
            </div>
            <p className="text-sm text-slate-500 mb-3">{pctDisque}% utilisé — {taille(data.disque.libre_octets)} libre(s) sur {taille(data.disque.total_octets)}</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Utilisé</span><span className="font-semibold">{taille(data.disque.utilise_octets)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total</span><span className="font-semibold">{taille(data.disque.total_octets)}</span></div>
            </div>
          </Card>
        )}

        <Card className="lg:col-span-2">
          <h3 className="font-bold text-ink-900 mb-4">Écoles les plus volumineuses (par nombre d'utilisateurs)</h3>
          {data.top_ecoles.length === 0 ? (
            <EmptyState title="Aucune école" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.top_ecoles.map((e, i) => (
                <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                  <Link to={`/ecoles/${e.id}`} className="text-slate-700 font-medium hover:underline">#{i + 1} {e.nom}</Link>
                  <span className="text-slate-500">{e.nb_utilisateurs} utilisateur{e.nb_utilisateurs > 1 ? "s" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
