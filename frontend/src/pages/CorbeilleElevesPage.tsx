import { useCallback, useEffect, useState } from "react";

import { extractErrorMessage } from "../api/client";
import { elevesApi, type EleveCorbeille } from "../api/services";
import { Badge, Button, EmptyState, Input, PageHeader, RowActions, Spinner, Table } from "../components/ui";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

/**
 * Corbeille des élèves (administrateur uniquement) : un élève supprimé y reste, masqué partout et
 * compte désactivé, jusqu'à sa restauration (tout revient à l'identique) ou sa suppression
 * définitive (voir backend people/corbeille.py).
 */
export default function CorbeilleElevesPage() {
  const confirmer = useConfirm();
  const toast = useToast();
  const [eleves, setEleves] = useState<EleveCorbeille[] | null>(null);
  const [recherche, setRecherche] = useState("");
  const [coches, setCoches] = useState<Set<number>>(new Set());
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(() => {
    elevesApi.corbeille()
      .then(({ data }) => {
        setEleves(data);
        setCoches((prev) => new Set(data.filter((e) => prev.has(e.id)).map((e) => e.id)));
      })
      .catch((err) => toast.error(extractErrorMessage(err)));
    // `toast` est recréé à chaque rendu du ToastProvider : l'ajouter rechargerait la liste à chaque toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(charger, [charger]);

  const terme = recherche.trim().toLowerCase();
  const visibles = (eleves ?? []).filter((e) => !terme || `${e.nom} ${e.matricule} ${e.classe}`.toLowerCase().includes(terme));
  const tousCoches = visibles.length > 0 && visibles.every((e) => coches.has(e.id));
  const basculer = (id: number) => setCoches((prev) => {
    const suivant = new Set(prev);
    if (suivant.has(id)) suivant.delete(id); else suivant.add(id);
    return suivant;
  });
  const basculerTous = () => setCoches((prev) => {
    const suivant = new Set(prev);
    visibles.forEach((e) => (tousCoches ? suivant.delete(e.id) : suivant.add(e.id)));
    return suivant;
  });

  const executer = async (action: () => Promise<string>) => {
    setEnCours(true);
    try {
      toast.success(await action());
      setCoches(new Set());
      charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setEnCours(false);
    }
  };

  const restaurer = (ids: number[]) => executer(async () => {
    const { data } = await elevesApi.restaurerCorbeille(ids);
    return `${data.restaures} élève(s) restauré(s).`;
  });

  const supprimer = async (ids: number[]) => {
    if (!(await confirmer(
      `Supprimer définitivement ${ids.length} élève(s) ? Leur compte, leurs frais, notes et présences seront effacés. Cette action est irréversible.`,
      { danger: true, title: "Suppression définitive" },
    ))) return;
    executer(async () => {
      const { data } = await elevesApi.supprimerDefinitivement(ids);
      return `${data.supprimes} élève(s) supprimé(s) définitivement.`;
    });
  };

  const vider = async () => {
    if (!(await confirmer(
      `Vider la corbeille ? Les ${eleves?.length ?? 0} élève(s) qu'elle contient seront supprimés définitivement. Cette action est irréversible.`,
      { danger: true, title: "Vider la corbeille" },
    ))) return;
    executer(async () => {
      const { data } = await elevesApi.viderCorbeille();
      return `Corbeille vidée : ${data.supprimes} élève(s) supprimé(s) définitivement.`;
    });
  };

  return (
    <div>
      <PageHeader
        title="Corbeille des élèves"
        description="Élèves supprimés : ils n'apparaissent plus nulle part et leur compte est désactivé. Restaurez-les à l'identique, ou supprimez-les définitivement."
        actions={eleves && eleves.length > 0 && (
          <Button variant="danger" disabled={enCours} onClick={vider}>🗑️ Vider la corbeille</Button>
        )}
      />

      {eleves === null ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : eleves.length === 0 ? (
        <EmptyState title="La corbeille est vide" description="Les élèves supprimés depuis la liste Élèves apparaîtront ici." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Rechercher (nom, matricule, classe)…" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="max-w-xs" />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" disabled={coches.size === 0 || enCours} onClick={() => restaurer([...coches])}>
                ♻️ Restaurer{coches.size ? ` (${coches.size})` : ""}
              </Button>
              <Button variant="danger" disabled={coches.size === 0 || enCours} onClick={() => supprimer([...coches])}>
                Supprimer définitivement{coches.size ? ` (${coches.size})` : ""}
              </Button>
            </div>
          </div>
          <Table headers={[
            <input key="tous" type="checkbox" checked={tousCoches} onChange={basculerTous} aria-label="Tout cocher" />,
            "Élève", "Matricule", "Classe", "Statut avant", "Supprimé le", "Par", "Actions",
          ]}>
            {visibles.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3"><input type="checkbox" checked={coches.has(e.id)} onChange={() => basculer(e.id)} aria-label={`Cocher ${e.nom}`} /></td>
                <td className="px-4 py-3 font-medium text-slate-700">
                  {e.nom}
                  {e.parent && <span className="block text-xs text-slate-400">Parent : {e.parent}</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.matricule}</td>
                <td className="px-4 py-3">{e.classe ? `${e.classe} (${e.annee})` : <span className="text-slate-400">Sans classe</span>}</td>
                <td className="px-4 py-3">
                  <Badge color={e.actif_avant_corbeille ? "green" : "slate"}>{e.actif_avant_corbeille ? "Actif" : "Archivé"}</Badge>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(e.supprime_le).toLocaleString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-500">{e.supprime_par || "—"}</td>
                <td className="px-4 py-3">
                  <RowActions>
                    <button className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50" disabled={enCours} onClick={() => restaurer([e.id])}>
                      ♻️ Restaurer
                    </button>
                    <button className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50" disabled={enCours} onClick={() => supprimer([e.id])}>
                      Supprimer définitivement
                    </button>
                  </RowActions>
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-sm text-slate-500">Total : {eleves.length}</p>
        </div>
      )}
    </div>
  );
}
