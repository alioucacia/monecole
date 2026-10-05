import { useEffect, useState } from "react";

import { sauvegardesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, PageHeader, Spinner, Table } from "../components/ui";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import type { SauvegardeLog } from "../types";

const STATUT: Record<SauvegardeLog["statut"], { label: string; color: "green" | "rose" | "amber" }> = {
  succes: { label: "Succès", color: "green" },
  echec: { label: "Échec", color: "rose" },
  en_cours: { label: "En cours…", color: "amber" },
};

function taille(octets: number) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function SauvegardesPage() {
  const [logs, setLogs] = useState<SauvegardeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [lancement, setLancement] = useState(false);
  const [error, setError] = useState("");

  const load = (silencieux = false) => {
    if (!silencieux) setLoading(true);
    sauvegardesApi.list({ page_size: 100 }).then(({ data }) => setLogs(unwrapList(data))).finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  // La sauvegarde s'exécute en arrière-plan côté serveur : l'historique est rechargé toutes les
  // 5 s (voir useAutoRefresh) pour afficher son résultat dès qu'il est connu.
  const enCours = logs.some((l) => l.statut === "en_cours");
  useAutoRefresh(() => load(true));

  const handleLancer = async () => {
    setLancement(true);
    setError("");
    try {
      await sauvegardesApi.lancer();
      load(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLancement(false);
    }
  };

  const derniere = logs[0];

  return (
    <div>
      <PageHeader
        title="Sauvegardes"
        description="Sauvegarde journalière automatique de toute la plateforme (toutes écoles), conservée 30 jours."
        actions={
          <Button onClick={handleLancer} disabled={lancement || enCours}>
            {lancement || enCours ? "Sauvegarde en cours…" : "🗄️ Lancer une sauvegarde maintenant"}
          </Button>
        }
      />

      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 mb-4">{error}</p>}

      {derniere && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Dernière sauvegarde</p>
            <p className="text-lg font-bold text-ink-900">{new Date(derniere.date_lancement).toLocaleString("fr-FR")}</p>
          </div>
          <Badge color={STATUT[derniere.statut].color}>{STATUT[derniere.statut].label}</Badge>
        </div>
      )}

      <p className="text-xs text-slate-400 mb-4">
        Pour automatiser l'exécution quotidienne, planifiez <code className="bg-slate-100 px-1.5 py-0.5 rounded">python manage.py backup_daily</code> via
        le Planificateur de tâches Windows (ou un cron serveur) une fois par jour.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : logs.length === 0 ? (
        <EmptyState title="Aucune sauvegarde enregistrée" description="Lancez votre première sauvegarde manuelle ci-dessus." />
      ) : (
        <Table headers={["Date", "Statut", "Taille", "Durée", "Message", "Fichier"]}>
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="px-4 py-3 text-slate-600">{new Date(log.date_lancement).toLocaleString("fr-FR")}</td>
              <td className="px-4 py-3"><Badge color={STATUT[log.statut].color}>{STATUT[log.statut].label}</Badge></td>
              <td className="px-4 py-3">{taille(log.taille_octets)}</td>
              <td className="px-4 py-3">{log.duree_secondes.toFixed(1)} s</td>
              <td className="px-4 py-3 text-xs text-slate-500">{log.message}</td>
              <td className="px-4 py-3">
                {log.fichier ? (
                  <button
                    className="text-xs font-semibold text-brand-600 hover:underline"
                    onClick={() => sauvegardesApi.telecharger(log.id, log.fichier)}
                  >
                    Télécharger
                  </button>
                ) : "—"}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
