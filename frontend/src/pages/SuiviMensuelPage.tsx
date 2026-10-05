import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { classesApi, fraisApi, unwrapList } from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, PageHeader, Select, Spinner, Table } from "../components/ui";
import { CycleSelect } from "../components/CycleSelect";
import { ExonereFratrieBadge } from "../components/StatutMensualite";
import { useAnnee } from "../context/AnneeContext";
import type { Classe, Cycle, SuiviMensuelClasse, SuiviMensuelInscription, SuiviMensuelMois } from "../types";

const STATUT_BADGE: Record<string, { label: string; color: "green" | "amber" | "rose" }> = {
  paye: { label: "Payé", color: "green" },
  partiel: { label: "Partiel", color: "amber" },
  non_paye: { label: "Non payé", color: "rose" },
};

function montant(value: string | number) {
  return Number(value).toLocaleString("fr-FR");
}

function money(value: string | number) {
  return `${montant(value)} GNF`;
}

function moisLabel(mois: string) {
  // "2026-10" -> "oct. 26"
  const [annee, m] = mois.split("-");
  const date = new Date(Number(annee), Number(m) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

function moisLabelLong(mois: string) {
  const [annee, m] = mois.split("-");
  return new Date(Number(annee), Number(m) - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

type StatutFiltre = "" | "payes" | "non_payes";

/** « payes » si tout ce qui est dû est réglé, « non_payes » sinon (impayé ou partiel) — sur le
 * mois filtré, ou à défaut sur l'inscription et les mois déjà commencés. `null` : rien à suivre.
 * Même règle que `_situation_paiement` côté backend (PDF). */
function situationPaiement(e: SuiviMensuelClasse["eleves"][number], moisFiltre: string): StatutFiltre | null {
  const colonnes: (SuiviMensuelMois | SuiviMensuelInscription)[] = moisFiltre
    ? e.mois.filter((m) => m.mois === moisFiltre)
    : [...e.mois.filter((m) => !m.a_venir), ...(e.inscription ? [e.inscription] : [])];
  if (colonnes.length === 0) return null;
  return colonnes.every((c) => c.statut === "paye") ? "payes" : "non_payes";
}

/** Cellule payé / partiel / non payé, commune aux mois et à l'inscription. */
function CelluleStatut({ ligne, note }: { ligne: SuiviMensuelMois | SuiviMensuelInscription; note?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={`Payé ${money(ligne.montant_paye)} / ${money(ligne.montant_du)}`}>
      <Badge color={STATUT_BADGE[ligne.statut].color}>{STATUT_BADGE[ligne.statut].label}</Badge>
      <span className="text-[10px] text-slate-500">
        {money(ligne.montant_paye)} / {money(ligne.montant_du)}
      </span>
      {ligne.statut === "partiel" && (
        <span className="text-[10px] font-semibold text-amber-600">reste {money(ligne.reste)}</span>
      )}
      {note && <span className="text-[10px] text-brand-600">{note}</span>}
    </div>
  );
}

export default function SuiviMensuelPage() {
  const { anneeId } = useAnnee();
  const [classes, setClasses] = useState<Classe[]>([]);
  const [cycleFiltre, setCycleFiltre] = useState<Cycle | "">("");
  // "" (par défaut) = toutes les classes — du cycle choisi, ou de toute l'école.
  const [classeId, setClasseId] = useState<string>("");
  // "" = tous les mois (avec la colonne Inscription / Réinscription), sinon "AAAA-MM".
  const [moisFiltre, setMoisFiltre] = useState("");
  // "" = tous les élèves, sinon seulement les élèves payés / non payés (écran et impression).
  const [statutFiltre, setStatutFiltre] = useState<StatutFiltre>("");
  const [suivi, setSuivi] = useState<SuiviMensuelClasse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [impression, setImpression] = useState(false);

  useEffect(() => {
    // Classes de l'année affichée (sélecteur du haut).
    classesApi.list({ page_size: 200, annee_scolaire: anneeId ?? undefined }).then(({ data }) => setClasses(unwrapList(data)));
  }, []);

  // Par défaut (aucun filtre) : tous les élèves de l'année active.
  useEffect(() => {
    const params = classeId ? { classe: Number(classeId) } : { cycle: cycleFiltre || undefined };
    setLoading(true);
    setError("");
    fraisApi.suiviMensuelClasse(params)
      .then(({ data }) => setSuivi(data))
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [classeId, cycleFiltre]);

  // Imprime la liste telle que filtrée à l'écran (cycle / classe / mois / statut) — ou, via les
  // boutons dédiés, seulement les élèves payés / non payés. PDF généré côté serveur.
  const handleImprimer = async (statut: StatutFiltre = statutFiltre) => {
    setImpression(true);
    setError("");
    try {
      await fraisApi.suiviMensuelClassePdf(
        {
          ...(classeId ? { classe: Number(classeId) } : { cycle: cycleFiltre || undefined }),
          mois: moisFiltre || undefined,
          statut: statut || undefined,
        },
        `suivi_mensuel${moisFiltre ? `_${moisFiltre}` : ""}${statut ? `_${statut}` : ""}.pdf`,
      );
    } catch (err) {
      setError(await extractBlobErrorMessage(err));
    } finally {
      setImpression(false);
    }
  };

  const handleSuiviMensuelPdf = async (eleveId: number, matricule: string) => {
    setError("");
    try {
      await fraisApi.suiviMensuelPdf(eleveId, `suivi_mensuel_${matricule}.pdf`);
    } catch (err) {
      // Sans ce catch, un échec restait invisible (bouton "mort") — voir le même correctif
      // sur les fiches de paiement/badges.
      setError(await extractBlobErrorMessage(err));
    }
  };

  // Mois de mensualité de l'année (Octobre → Juin) : Septembre, mois de l'inscription, n'en
  // fait pas partie — il est remplacé par la colonne Inscription / Réinscription.
  const tousLesMois = suivi?.mois ?? [];
  const moisAffiches = moisFiltre ? tousLesMois.filter((m) => m === moisFiltre) : tousLesMois;
  const avecInscription = !moisFiltre;

  // Total payé / reste d'un élève sur les colonnes affichées (inscription + mois, ou le seul mois
  // filtré) — affichés devant les mois, et cumulés en bas du tableau.
  const totauxEleve = (e: SuiviMensuelClasse["eleves"][number]) => {
    const lignes: (SuiviMensuelMois | SuiviMensuelInscription)[] = [
      ...(avecInscription && e.inscription ? [e.inscription] : []),
      ...e.mois.filter((m) => moisAffiches.includes(m.mois)),
    ];
    return {
      paye: lignes.reduce((total, l) => total + Number(l.montant_paye), 0),
      reste: lignes.reduce((total, l) => total + Number(l.reste), 0),
    };
  };
  const elevesAffiches = (suivi?.eleves ?? []).filter(
    (e) => !statutFiltre || situationPaiement(e, moisFiltre) === statutFiltre,
  );
  const totauxGeneraux = elevesAffiches.reduce(
    (acc, e) => {
      const t = totauxEleve(e);
      return { paye: acc.paye + t.paye, reste: acc.reste + t.reste };
    },
    { paye: 0, reste: 0 },
  );
  const aSuivre = suivi?.eleves.some((e) => e.mois.length > 0 || e.inscription) ?? false;

  return (
    <div>
      <PageHeader
        title="Suivi mensuel des paiements"
        description="Inscription / réinscription puis mensualités d'Octobre à Juin — statut payé / partiel / non payé, mois par mois, par élève (paiements mensuels, annuels ou par tranches)."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => handleImprimer()} disabled={impression || loading || !suivi || suivi.eleves.length === 0}>
              {impression ? "Préparation…" : "🖨️ Imprimer la liste"}
            </Button>
            <Button variant="secondary" onClick={() => handleImprimer("non_payes")} disabled={impression || loading || !suivi || suivi.eleves.length === 0}>
              🖨️ Non payés
            </Button>
            <Button variant="secondary" onClick={() => handleImprimer("payes")} disabled={impression || loading || !suivi || suivi.eleves.length === 0}>
              🖨️ Payés
            </Button>
            <Link to="/paiements" className="text-sm text-brand-600 font-medium hover:underline">← Retour aux paiements</Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <CycleSelect
          label="Cycle"
          value={cycleFiltre}
          onChange={(c) => {
            setCycleFiltre(c);
            setClasseId("");
          }}
          className="max-w-xs"
        />
        <Select label="Classe" value={classeId} onChange={(e) => setClasseId(e.target.value)} className="max-w-xs">
          <option value="">— Toutes les classes —</option>
          {classes.filter((c) => !cycleFiltre || c.cycle === cycleFiltre).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </Select>
        <Select label="Mois" value={moisFiltre} onChange={(e) => setMoisFiltre(e.target.value)} className="max-w-xs">
          <option value="">— Tous les mois —</option>
          {tousLesMois.map((m) => <option key={m} value={m} className="capitalize">{moisLabelLong(m)}</option>)}
        </Select>
        <Select label="Statut" value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value as StatutFiltre)} className="max-w-xs">
          <option value="">— Tous les élèves —</option>
          <option value="payes">Élèves payés</option>
          <option value="non_payes">Élèves non payés</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>
      ) : !suivi || suivi.eleves.length === 0 ? (
        <EmptyState title="Aucun élève" description="Cette sélection ne compte aucun élève actif." />
      ) : !aSuivre ? (
        <EmptyState
          title="Aucun frais à suivre"
          description="Aucun élève de cette sélection n'a de frais d'inscription/réinscription ni de scolarité (mensuelle, annuelle ou par tranches). Configurez-les depuis Paiements → Types de frais."
        />
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-4">
            Année scolaire <span className="font-semibold text-ink-900">{suivi.annee_scolaire}</span> — {suivi.classe} — {elevesAffiches.length} élève(s)
            {statutFiltre && ` ${statutFiltre === "payes" ? "payé(s)" : "non payé(s)"} sur ${suivi.eleves.length}`}.
          </p>
          <div className="overflow-x-auto">
            <Table headers={[
              "Élève", "Mois impayés",
              // Titre sur deux lignes : sur une seule, il élargissait la colonne bien au-delà de
              // celles des mois.
              ...(avecInscription ? [<span className="block text-center leading-tight">Inscription /<br />Réinscription</span>] : []),
              ...moisAffiches.map(moisLabel),
              // Après le dernier mois (Juin).
              "Total payé", "Reste",
            ]}>
              {elevesAffiches.map((e) => {
                const parMois = new Map(e.mois.map((m) => [m.mois, m]));
                // « À jour » seulement si TOUT est réglé : un mois non payé, même pas encore échu,
                // ou une inscription non soldée empêche l'indice « à jour ». Les mois échus non
                // payés (impayés) restent distingués de ceux à venir.
                const nbImpayes = e.mois.filter((m) => m.statut === "non_paye" && !m.a_venir).length;
                const nbAVenir = e.mois.filter((m) => m.statut === "non_paye" && m.a_venir).length;
                const nbPartiels = e.mois.filter((m) => m.statut === "partiel").length;
                const inscriptionDue = !!e.inscription && e.inscription.statut !== "paye";
                const aJour = nbImpayes === 0 && nbAVenir === 0 && nbPartiels === 0 && !inscriptionDue;
                const totaux = totauxEleve(e);
                return (
                  <tr key={e.eleve_id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                      <Link to={`/eleves/${e.eleve_id}`} className="hover:underline">{e.eleve_nom}</Link>
                      <button
                        onClick={() => handleSuiviMensuelPdf(e.eleve_id, e.matricule)}
                        title="Rapport de suivi (PDF)"
                        className="ml-1.5 text-slate-300 hover:text-brand-600 transition"
                      >
                        📄
                      </button>
                      {e.exonere_fratrie && <div><ExonereFratrieBadge /></div>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {aJour ? (
                        <span className="text-emerald-600 text-xs">✓ à jour</span>
                      ) : (
                        <div className="flex gap-1.5">
                          {nbImpayes > 0 && <Badge color="rose">{nbImpayes} impayé{nbImpayes > 1 ? "s" : ""}</Badge>}
                          {nbPartiels > 0 && <Badge color="amber">{nbPartiels} partiel{nbPartiels > 1 ? "s" : ""}</Badge>}
                          {nbAVenir > 0 && <Badge color="slate">{nbAVenir} non payé{nbAVenir > 1 ? "s" : ""} à venir</Badge>}
                          {inscriptionDue && <Badge color="rose">{e.inscription?.libelle} non soldée</Badge>}
                        </div>
                      )}
                    </td>
                    {avecInscription && (
                      <td className="px-2 py-2.5 text-center whitespace-nowrap">
                        {e.inscription ? (
                          <CelluleStatut ligne={e.inscription} note={e.inscription.libelle} />
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    )}
                    {moisAffiches.map((mois) => {
                      const m = parMois.get(mois);
                      return (
                        <td key={mois} className="px-2 py-2.5 text-center whitespace-nowrap">
                          {m ? <CelluleStatut ligne={m} note={m.couvert_par || undefined} /> : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 whitespace-nowrap text-sm font-semibold text-emerald-700">{money(totaux.paye)}</td>
                    <td className={`px-4 py-2.5 whitespace-nowrap text-sm font-semibold ${totaux.reste > 0 ? "text-rose-600" : "text-slate-400"}`}>
                      {money(totaux.reste)}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                <td className="px-4 py-3 text-ink-900 whitespace-nowrap">Total ({elevesAffiches.length} élève{elevesAffiches.length > 1 ? "s" : ""})</td>
                <td className="px-4 py-3" colSpan={1 + (avecInscription ? 1 : 0) + moisAffiches.length} />
                <td className="px-4 py-3 whitespace-nowrap text-emerald-700">{money(totauxGeneraux.paye)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-rose-600">{money(totauxGeneraux.reste)}</td>
              </tr>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
