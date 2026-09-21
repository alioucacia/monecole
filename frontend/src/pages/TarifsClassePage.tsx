import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { anneesApi, classesApi, fraisApi, tarifsClasseApi, typesFraisApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { useToast } from "../context/ToastContext";
import type { AnneeScolaire, Classe, TarifClasse, TypeFrais } from "../types";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function TarifsClassePage() {
  const toast = useToast();
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [anneeId, setAnneeId] = useState("");
  const [classes, setClasses] = useState<Classe[]>([]);
  const [types, setTypes] = useState<TypeFrais[]>([]);
  const [tarifs, setTarifs] = useState<TarifClasse[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [genererClasse, setGenererClasse] = useState<Classe | null>(null);
  const [genererDate, setGenererDate] = useState("");
  const [genererSaving, setGenererSaving] = useState(false);
  const [genererError, setGenererError] = useState("");

  useEffect(() => {
    anneesApi.list().then(({ data }) => {
      const liste = unwrapList(data);
      setAnnees(liste);
      setAnneeId((liste.find((a) => a.active) || liste[0])?.id.toString() || "");
    });
    typesFraisApi.list().then(({ data }) => setTypes(unwrapList(data)));
  }, []);

  useEffect(() => {
    if (!anneeId) return;
    setLoading(true);
    Promise.all([
      classesApi.list({ annee_scolaire: anneeId, page_size: 200 }).then(({ data }) => setClasses(unwrapList(data))),
      tarifsClasseApi.list({ annee_scolaire: anneeId }).then(({ data }) => setTarifs(unwrapList(data))),
    ]).finally(() => setLoading(false));
  }, [anneeId]);

  const tarifParCellule = useMemo(() => {
    const map = new Map<string, TarifClasse>();
    tarifs.forEach((t) => map.set(`${t.classe}-${t.type_frais}`, t));
    return map;
  }, [tarifs]);

  const handleCellBlur = async (classe: Classe, type: TypeFrais, valeur: string) => {
    const key = `${classe.id}-${type.id}`;
    const existant = tarifParCellule.get(key);
    const valeurActuelle = existant ? existant.montant : "";
    if (valeur === valeurActuelle || (!valeur && !existant)) return;
    if (!valeur) return; // pas de suppression au blur — utiliser le bouton dédié si besoin un jour

    setSavingKey(key);
    try {
      const { data } = await tarifsClasseApi.definir({
        type_frais: type.id, classe: classe.id, annee_scolaire: Number(anneeId), montant: valeur,
      });
      setTarifs((prev) => [...prev.filter((t) => !(t.classe === classe.id && t.type_frais === type.id)), data]);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSavingKey(null);
    }
  };

  const openGenerer = (classe: Classe) => {
    setGenererClasse(classe);
    setGenererDate("");
    setGenererError("");
  };

  const handleGenerer = async () => {
    if (!genererClasse || !genererDate) return;
    setGenererSaving(true);
    setGenererError("");
    try {
      const { data } = await fraisApi.genererPourClasse({
        classe: genererClasse.id, annee_scolaire: Number(anneeId), date_echeance: genererDate,
      });
      toast.success(`${data.crees} frais créé(s) pour ${data.classe} (${data.eleves} élève(s) dans la classe).`);
      setGenererClasse(null);
    } catch (err) {
      setGenererError(extractErrorMessage(err));
    } finally {
      setGenererSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Tarifs par classe"
        description="Paramétrez le montant de chaque type de frais, classe par classe, pour l'année scolaire choisie."
        actions={<Link to="/paiements" className="text-sm text-brand-600 font-medium hover:underline">← Retour aux paiements</Link>}
      />

      <div className="mb-6 max-w-xs">
        <Select label="Année scolaire" value={anneeId} onChange={(e) => setAnneeId(e.target.value)}>
          {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : classes.length === 0 || types.length === 0 ? (
        <EmptyState
          title="Rien à paramétrer"
          description={types.length === 0 ? "Créez d'abord un type de frais (Paiements → Types de frais)." : "Aucune classe pour cette année scolaire."}
        />
      ) : (
        <div className="overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-soft">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Classe</th>
                {types.map((t) => (
                  <th key={t.id} className="px-4 py-3 text-left font-semibold text-slate-500">
                    {t.nom}
                    <span className="block text-[11px] font-normal text-slate-400">Standard : {money(t.montant_standard)}</span>
                  </th>
                ))}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {classes.map((classe) => (
                <tr key={classe.id}>
                  <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                    {classe.nom}
                    <span className="block text-[11px] font-normal text-slate-400">{classe.effectif} élève(s)</span>
                  </td>
                  {types.map((type) => {
                    const key = `${classe.id}-${type.id}`;
                    const tarif = tarifParCellule.get(key);
                    return (
                      <td key={type.id} className="px-4 py-2.5">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={tarif?.montant ?? ""}
                          key={tarif?.montant ?? "vide"}
                          placeholder={type.montant_standard}
                          disabled={savingKey === key}
                          onBlur={(e) => handleCellBlur(classe, type, e.target.value)}
                          className="w-32 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-300 transition focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400 disabled:opacity-50"
                        />
                        {/* Pour un type mensuel, ce champ EST le montant par mois (voir Frais.montant
                            "représente le montant par mois" — cf. business rules paiements) : cette
                            ligne traduit ce que ça représente sur l'année scolaire (9 mois), pour que
                            l'admin puisse aussi raisonner/paramétrer en pensant "montant annuel". */}
                        {type.periodicite === "mensuel" && (
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            = {money(Number(tarif?.montant ?? type.montant_standard) * 9)}/an
                          </p>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => openGenerer(classe)}
                      className="text-xs font-semibold text-brand-700 hover:underline"
                    >
                      Générer les frais →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3">
        Une case vide utilise le montant standard du type de frais. Le tarif est enregistré automatiquement en quittant la case.
      </p>

      <Modal open={!!genererClasse} onClose={() => setGenererClasse(null)} title={`Générer les frais — ${genererClasse?.nom ?? ""}`}>
        {genererClasse && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Crée le frais de chaque type ci-dessus pour tous les élèves actifs de <strong>{genererClasse.nom}</strong>,
              en utilisant le tarif paramétré (ou le montant standard si aucun n'est défini). Les frais déjà existants
              pour un élève ne sont jamais dupliqués.
            </p>
            <Input
              label="Date d'échéance" type="date" required
              value={genererDate}
              onChange={(e) => setGenererDate(e.target.value)}
            />

            {genererError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{genererError}</p>}

            <div className="flex justify-end gap-2 mt-2">
              <Button type="button" variant="secondary" onClick={() => setGenererClasse(null)}>Annuler</Button>
              <Button onClick={handleGenerer} disabled={genererSaving || !genererDate}>
                {genererSaving ? "Génération…" : "Générer les frais"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
