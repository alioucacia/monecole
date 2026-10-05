import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  anneesApi, enseignementsApi, programmesApi, unwrapList,
  type AvancementClasse, type AvancementMatiere, type ChapitreProgramme, type StatutChapitre,
} from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from "../components/ui";
import { useAnnee } from "../context/AnneeContext";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import type { AnneeScolaire, Enseignement } from "../types";

const STATUTS: Record<StatutChapitre, { label: string; color: "slate" | "amber" | "green" }> = {
  a_faire: { label: "À faire", color: "slate" },
  en_cours: { label: "En cours", color: "amber" },
  termine: { label: "Terminé", color: "green" },
};

function Barre({ pourcentage }: { pourcentage: number | null }) {
  const valeur = pourcentage ?? 0;
  const couleur = valeur >= 75 ? "bg-emerald-500" : valeur >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${couleur}`} style={{ width: `${valeur}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-10 text-right">{pourcentage === null ? "—" : `${pourcentage}%`}</span>
    </div>
  );
}

/** Chapitres d'une matière dans une classe : liste, changement de statut, ajout, suppression. */
function ChapitresMatiere({
  classeId, matiere, peutModifier, onChange,
}: { classeId: number; matiere: AvancementMatiere; peutModifier: boolean; onChange: () => void }) {
  const toast = useToast();
  const confirmer = useConfirm();
  const [chapitres, setChapitres] = useState<ChapitreProgramme[]>([]);
  const [loading, setLoading] = useState(true);
  const [titre, setTitre] = useState("");
  const [heures, setHeures] = useState("");

  const charger = useCallback(() => {
    setLoading(true);
    programmesApi.list({ classe: classeId, matiere: matiere.matiere_id })
      .then(({ data }) => setChapitres(unwrapList(data)))
      .finally(() => setLoading(false));
  }, [classeId, matiere.matiere_id]);

  useEffect(() => { charger(); }, [charger]);

  const apres = () => { charger(); onChange(); };

  const changerStatut = async (c: ChapitreProgramme, statut: StatutChapitre) => {
    try {
      await programmesApi.update(c.id, { statut });
      apres();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const ajouter = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await programmesApi.create({
        classe: classeId, matiere: matiere.matiere_id, titre: titre.trim(),
        ordre: chapitres.length + 1, heures_prevues: heures || null,
      });
      setTitre("");
      setHeures("");
      apres();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const supprimer = async (c: ChapitreProgramme) => {
    if (!(await confirmer(`Supprimer le chapitre « ${c.titre} » ?`, { danger: true }))) return;
    try {
      await programmesApi.remove(c.id);
      apres();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  if (loading) return <div className="py-4 flex justify-center"><Spinner /></div>;

  return (
    <div className="mt-3 space-y-2">
      {chapitres.length === 0 && (
        <p className="text-sm text-slate-400">Aucun chapitre saisi pour ce programme.</p>
      )}
      {chapitres.map((c, i) => (
        <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2">
          <span className="text-xs font-bold text-slate-400 w-6">{i + 1}.</span>
          <div className="flex-1 min-w-[160px]">
            <p className={`text-sm font-medium ${c.statut === "termine" ? "text-slate-400 line-through" : "text-slate-700"}`}>{c.titre}</p>
            {c.statut === "termine" && c.date_realisation && (
              <p className="text-[11px] text-slate-400">
                Terminé le {new Date(c.date_realisation).toLocaleDateString("fr-FR")}{c.realise_par_nom ? ` par ${c.realise_par_nom}` : ""}
              </p>
            )}
          </div>
          {c.heures_prevues && <span className="text-xs text-slate-400">{Number(c.heures_prevues)} h</span>}
          {peutModifier ? (
            <select
              value={c.statut}
              onChange={(e) => changerStatut(c, e.target.value as StatutChapitre)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
            >
              {Object.entries(STATUTS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </select>
          ) : (
            <Badge color={STATUTS[c.statut].color}>{STATUTS[c.statut].label}</Badge>
          )}
          {peutModifier && (
            <button onClick={() => supprimer(c)} className="text-xs text-rose-500 hover:underline" title="Supprimer">🗑️</button>
          )}
        </div>
      ))}
      {peutModifier && (
        <form noValidate onSubmit={ajouter} className="flex flex-wrap items-end gap-2 pt-1">
          <Input label="Nouveau chapitre" required placeholder="Ex : Les fractions" value={titre} onChange={(e) => setTitre(e.target.value)} className="min-w-[220px]" />
          <Input label="Heures prévues" type="number" min={0} step="0.5" value={heures} onChange={(e) => setHeures(e.target.value)} className="w-28" />
          <Button type="submit">+ Ajouter</Button>
        </form>
      )}
    </div>
  );
}

/** Avancement des programmes : vue d'ensemble de toutes les classes pour la direction, et
 * détail matière par matière (chapitres) — l'enseignant y coche les chapitres de ses propres
 * matières/classes. */
export default function ProgrammesPage() {
  const { user } = useAuth();
  const { anneeId: anneeVueId } = useAnnee();
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [anneeId, setAnneeId] = useState("");
  const [classes, setClasses] = useState<AvancementClasse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classeId, setClasseId] = useState<number | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [mesEnseignements, setMesEnseignements] = useState<Enseignement[]>([]);

  useEffect(() => {
    anneesApi.list().then(({ data }) => {
      const liste = unwrapList(data);
      setAnnees(liste);
      // Par défaut : l'année affichée dans toute l'application (sélecteur du haut).
      const active = liste.find((a) => a.id === anneeVueId) ?? liste.find((a) => a.active);
      if (active) setAnneeId(String(active.id));
    });
    if (user?.role === "teacher") {
      enseignementsApi.list({ page_size: 200 }).then(({ data }) => setMesEnseignements(unwrapList(data)));
    }
  }, [user?.role, anneeVueId]);

  const charger = useCallback(() => {
    setError("");
    return programmesApi.avancement({ annee_scolaire: anneeId || undefined })
      .then(({ data }) => setClasses(data.classes))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [anneeId]);

  useEffect(() => { setLoading(true); charger(); }, [charger]);

  const peutModifier = (classe: number, matiere: number) =>
    user?.role === "admin" || mesEnseignements.some((e) => e.classe === classe && e.matiere === matiere);

  const classe = classes.find((c) => c.classe_id === classeId) || null;
  // L'enseignant ne voit que ses classes ; la direction voit tout l'établissement.
  const classesVisibles = user?.role === "teacher"
    ? classes.filter((c) => mesEnseignements.some((e) => e.classe === c.classe_id))
    : classes;

  return (
    <div>
      <PageHeader
        title="Programmes"
        description="Avancement du programme de chaque classe, matière par matière — les enseignants cochent les chapitres au fil de l'année."
      />
      <div className="flex flex-wrap gap-3 mb-6">
        <Select label="Année scolaire" value={anneeId} onChange={(e) => { setAnneeId(e.target.value); setClasseId(null); }} className="max-w-xs">
          {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}{a.active ? " (en cours)" : ""}</option>)}
        </Select>
        {classe && (
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => { setClasseId(null); setOuverte(null); }}>← Toutes les classes</Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>
      ) : classesVisibles.length === 0 ? (
        <EmptyState title="Aucune classe" description="Aucune classe (ou aucun enseignement) pour cette année scolaire." />
      ) : !classe ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classesVisibles.map((c) => (
            <button key={c.classe_id} onClick={() => setClasseId(c.classe_id)} className="text-left">
              <Card className="hover:shadow-soft transition">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold text-ink-900">{c.classe_nom}</p>
                  <span className="text-xs text-slate-400">{c.termines}/{c.total} chapitres</span>
                </div>
                <Barre pourcentage={c.pourcentage} />
                <p className="text-xs text-slate-400 mt-2">{c.matieres.length} matière(s)</p>
              </Card>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Card>
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-ink-900">{classe.classe_nom} — avancement global</p>
              <span className="text-xs text-slate-400">{classe.termines}/{classe.total} chapitres terminés</span>
            </div>
            <Barre pourcentage={classe.pourcentage} />
          </Card>
          {classe.matieres.length === 0 && (
            <EmptyState title="Aucune matière" description="Affectez des enseignants à cette classe (Classes → Enseignements) pour saisir leurs programmes." />
          )}
          {classe.matieres.map((m) => (
            <Card key={m.matiere_id}>
              <button className="w-full text-left" onClick={() => setOuverte(ouverte === m.matiere_id ? null : m.matiere_id)}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="font-semibold text-slate-800">
                    {ouverte === m.matiere_id ? "▾" : "▸"} {m.matiere_nom}
                    {m.enseignant && <span className="ml-2 text-xs font-normal text-slate-400">{m.enseignant}</span>}
                  </p>
                  <span className="text-xs text-slate-400">
                    {m.termines}/{m.total} terminé(s){m.en_cours ? ` · ${m.en_cours} en cours` : ""}
                  </span>
                </div>
                <Barre pourcentage={m.pourcentage} />
              </button>
              {ouverte === m.matiere_id && (
                <ChapitresMatiere
                  classeId={classe.classe_id} matiere={m}
                  peutModifier={peutModifier(classe.classe_id, m.matiere_id)} onChange={charger}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
