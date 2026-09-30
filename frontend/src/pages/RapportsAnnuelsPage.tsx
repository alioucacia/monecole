import { useCallback, useEffect, useState } from "react";

import { rapportsAnnuelsApi, type LigneRapportAnnuel } from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, PageHeader, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

/** Rapports annuels PDF (élèves, réussite, absences, évolution des résultats, recettes,
 * dépenses, enseignants, classes, statistiques) — générés automatiquement à la fin de chaque
 * année scolaire, téléchargeables ici ; l'administrateur peut aussi en générer un à tout moment
 * (bilan provisoire pour l'année en cours). */
export default function RapportsAnnuelsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const estAdmin = user?.role === "admin";
  const [lignes, setLignes] = useState<LigneRapportAnnuel[]>([]);
  const [loading, setLoading] = useState(true);
  const [enCours, setEnCours] = useState<number | null>(null);

  const charger = useCallback(() => {
    rapportsAnnuelsApi.list()
      .then(({ data }) => setLignes(data))
      .catch((err) => toast.error(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { charger(); }, [charger]);

  const generer = async (l: LigneRapportAnnuel) => {
    setEnCours(l.annee_scolaire_id);
    try {
      const { data } = await rapportsAnnuelsApi.generer(l.annee_scolaire_id);
      toast.success(data.provisoire ? "Bilan provisoire généré." : "Rapport annuel généré.");
      charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setEnCours(null);
    }
  };

  const telecharger = async (l: LigneRapportAnnuel) => {
    setEnCours(l.annee_scolaire_id);
    try {
      await rapportsAnnuelsApi.pdf(l.annee_scolaire_id, `rapport_annuel_${l.annee_scolaire}.pdf`);
      charger();
    } catch (err) {
      toast.error(await extractBlobErrorMessage(err));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Rapports annuels"
        description="Bilan de chaque année scolaire en PDF prêt à imprimer : élèves, réussite, absences, évolution des résultats, recettes, dépenses, enseignants, classes et statistiques. Généré automatiquement à la fin de l'année."
      />
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : lignes.length === 0 ? (
        <EmptyState title="Aucune année scolaire" description="Créez une année scolaire dans Paramètres de l'école." />
      ) : (
        <Table headers={["Année scolaire", "Statut", "Rapport", "Actions"]}>
          {lignes.map((l) => (
            <tr key={l.annee_scolaire_id}>
              <td className="px-4 py-3 font-semibold text-slate-700">{l.annee_scolaire}</td>
              <td className="px-4 py-3">
                <Badge color={l.terminee ? "slate" : "teal"}>
                  {l.terminee ? "Terminée" : `En cours (jusqu'au ${new Date(l.date_fin).toLocaleDateString("fr-FR")})`}
                </Badge>
              </td>
              <td className="px-4 py-3 text-sm text-slate-500">
                {l.rapport ? (
                  <>
                    Généré le {new Date(l.rapport.genere_le).toLocaleDateString("fr-FR")}
                    {l.rapport.automatique ? " (automatiquement)" : ""}
                    {l.rapport.provisoire && <span className="ml-2"><Badge color="amber">Provisoire</Badge></span>}
                  </>
                ) : l.terminee ? "Sera généré automatiquement" : "Généré à la fin de l'année"}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => telecharger(l)} disabled={enCours === l.annee_scolaire_id}>
                    {enCours === l.annee_scolaire_id ? "Patientez…" : "⬇️ Télécharger le PDF"}
                  </Button>
                  {estAdmin && (
                    <Button variant="ghost" onClick={() => generer(l)} disabled={enCours === l.annee_scolaire_id}>
                      🔄 {l.rapport ? "Régénérer" : l.terminee ? "Générer" : "Bilan provisoire"}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-xs text-slate-400 mt-4">
        La génération prend quelques secondes (toutes les statistiques de l'année sont recalculées). « Régénérer » met à jour
        le rapport si des notes ou paiements ont été corrigés depuis.
      </p>
    </div>
  );
}
