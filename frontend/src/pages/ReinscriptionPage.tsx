import { useEffect, useState } from "react";

import { classesApi, elevesApi, typesFraisApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Spinner } from "../components/ui";
import { ClasseOptions } from "../components/CycleSelect";
import { usePrompt } from "../context/ConfirmContext";
import type { Classe, EleveProfile } from "../types";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function ReinscriptionPage() {
  const demander = usePrompt();
  const [classes, setClasses] = useState<Classe[]>([]);
  const [classeSourceId, setClasseSourceId] = useState("");
  const [classeDestId, setClasseDestId] = useState("");
  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [inactifs, setInactifs] = useState<EleveProfile[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);

  // Recherche des élèves DÉJÀ réinscrits dans une classe (voir EleveProfile.statut_inscription,
  // mis à "reinscription" par handleReinscrire/l'action serveur `reinscription`) — section
  // séparée de la réinscription en masse ci-dessus, pour retrouver/imprimer cette liste après coup.
  const [classeRecherche, setClasseRecherche] = useState("");
  const [rechercheNom, setRechercheNom] = useState("");
  const [reinscrits, setReinscrits] = useState<EleveProfile[]>([]);
  const [loadingReinscrits, setLoadingReinscrits] = useState(false);
  const [imprimant, setImprimant] = useState(false);
  const [ficheEnCours, setFicheEnCours] = useState<number | null>(null);

  // Montant du frais de réinscription pour `classeDestId`, résolu automatiquement dès qu'une
  // classe de destination est choisie — voir TypeFrais.usage/TarifClasse et
  // typesFraisApi.tarifParUsage. Remplace l'ancienne section "Frais de réinscription
  // (optionnel)" où l'admin devait choisir un type de frais et ressaisir un montant à la main :
  // le frais est maintenant créé côté serveur avec ce même montant, sans rien à saisir ici.
  const [tarifReinscription, setTarifReinscription] = useState<{ type_frais_nom: string | null; montant: string | null } | null>(null);
  const [dateEcheance, setDateEcheance] = useState("");

  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    classesApi.list({ page_size: 100 }).then(({ data }) => setClasses(unwrapList(data)));
  }, []);

  useEffect(() => {
    if (!classeDestId) {
      setTarifReinscription(null);
      return;
    }
    typesFraisApi.tarifParUsage("reinscription", Number(classeDestId))
      .then(({ data }) => setTarifReinscription(data))
      .catch(() => setTarifReinscription(null));
  }, [classeDestId]);

  const loadEleves = () => {
    if (!classeSourceId) {
      setEleves([]);
      setInactifs([]);
      return;
    }
    setLoading(true);
    Promise.all([
      elevesApi.list({ classe: classeSourceId, actif: true, page_size: 200 }),
      elevesApi.list({ classe: classeSourceId, actif: false, page_size: 200 }),
    ]).then(([actifsRes, inactifsRes]) => {
      const actifs = unwrapList(actifsRes.data);
      setEleves(actifs);
      setInactifs(unwrapList(inactifsRes.data));
      setSelected(Object.fromEntries(actifs.map((el) => [el.id, true])));
    }).finally(() => setLoading(false));
  };

  useEffect(loadEleves, [classeSourceId]);

  const loadReinscrits = () => {
    if (!classeRecherche) {
      setReinscrits([]);
      return;
    }
    setLoadingReinscrits(true);
    elevesApi.list({
      classe: classeRecherche, statut_inscription: "reinscription",
      search: rechercheNom || undefined, page_size: 200,
    })
      .then(({ data }) => setReinscrits(unwrapList(data)))
      .finally(() => setLoadingReinscrits(false));
  };

  useEffect(loadReinscrits, [classeRecherche, rechercheNom]);

  const handleImprimerListe = async () => {
    setImprimant(true);
    try {
      await elevesApi.exportPdf({ classe: classeRecherche, statut_inscription: "reinscription", search: rechercheNom || undefined });
    } finally {
      setImprimant(false);
    }
  };

  const handleFicheReinscription = async (eleve: EleveProfile) => {
    setFicheEnCours(eleve.id);
    try {
      await elevesApi.ficheReinscription(eleve.id, `fiche_reinscription_${eleve.matricule}.pdf`);
    } finally {
      setFicheEnCours(null);
    }
  };

  const toggleAll = (value: boolean) => {
    setSelected(Object.fromEntries(eleves.map((el) => [el.id, value])));
  };

  const handleReinscrire = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([id]) => Number(id));
    if (!classeDestId || ids.length === 0) {
      setError("Sélectionnez une classe de destination et au moins un élève.");
      return;
    }
    setProcessing(true);
    setError("");
    setMessage("");
    try {
      const { data } = await elevesApi.reinscription({
        eleves: ids, classe_destination: Number(classeDestId),
        date_echeance_frais: dateEcheance || null,
      });
      setMessage(`${data.reinscrits} élève(s) réinscrit(s) dans ${data.classe_destination}. ${data.frais_crees} frais de réinscription créé(s).`);
      loadEleves();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const handleNonReinscrit = async (eleve: EleveProfile) => {
    const motif = await demander(`Vous pouvez préciser le motif du départ de ${eleve.user.first_name} ${eleve.user.last_name}.`, {
      title: "Élève non réinscrit", label: "Motif (optionnel)", confirmLabel: "Confirmer",
    }) || "";
    await elevesApi.marquerNonReinscrit(eleve.id, motif);
    loadEleves();
  };

  const handleReactiver = async (eleve: EleveProfile) => {
    await elevesApi.reactiver(eleve.id);
    loadEleves();
  };

  const nbSelectionnes = Object.values(selected).filter(Boolean).length;

  return (
    <div>
      <PageHeader
        title="Réinscription"
        description="Passez vos élèves dans la classe supérieure et gérez les départs, d'une année sur l'autre."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Select label="Classe source (élèves à traiter)" value={classeSourceId} onChange={(e) => setClasseSourceId(e.target.value)}>
          <option value="">— Sélectionner —</option>
          <ClasseOptions classes={classes} label={(c) => `${c.nom} (${c.annee_scolaire_libelle})`} />
        </Select>
        <Select label="Classe de destination" value={classeDestId} onChange={(e) => setClasseDestId(e.target.value)}>
          <option value="">— Sélectionner —</option>
          <ClasseOptions classes={classes} label={(c) => `${c.nom} (${c.annee_scolaire_libelle})`} />
        </Select>
      </div>

      {classeDestId && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 mb-6">
          <p className="text-sm font-bold text-ink-900 mb-3">Frais de réinscription</p>
          {!tarifReinscription || !tarifReinscription.type_frais_nom ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5">
              Aucun type de frais n'est marqué « Frais de réinscription » dans votre établissement — aucun frais ne
              sera créé. Paramétrez-le dans <span className="font-semibold">Paiements → ⚙️ Types de frais</span>.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  {tarifReinscription.type_frais_nom} — {classes.find((c) => String(c.id) === classeDestId)?.nom}
                </p>
                <p className="text-2xl font-extrabold text-ink-900">
                  {tarifReinscription.montant !== null ? money(tarifReinscription.montant) : "—"}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Créé automatiquement pour chaque élève réinscrit. Le montant se règle par classe dans
                  Paiements → 💰 Tarifs par classe.
                </p>
              </div>
              <Input label="Date d'échéance (optionnel)" type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 mb-4">{error}</p>}
      {message && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5 mb-4">{message}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !classeSourceId ? (
        <EmptyState title="Sélectionnez une classe source" description="La liste des élèves à réinscrire s'affichera ici." />
      ) : eleves.length === 0 ? (
        <EmptyState title="Aucun élève actif dans cette classe" />
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-soft overflow-hidden mb-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-3">
                <button onClick={() => toggleAll(true)} className="text-xs font-semibold text-brand-600 hover:underline">Tout cocher</button>
                <button onClick={() => toggleAll(false)} className="text-xs font-semibold text-slate-500 hover:underline">Tout décocher</button>
              </div>
              <span className="text-xs text-slate-500">{nbSelectionnes} / {eleves.length} sélectionné(s)</span>
            </div>
            <ul className="divide-y divide-slate-50">
              {eleves.map((el) => (
                <li key={el.id} className="flex items-center gap-3 px-4 py-2.5">
                  <input
                    type="checkbox" checked={!!selected[el.id]} className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                    onChange={(e) => setSelected({ ...selected, [el.id]: e.target.checked })}
                  />
                  <span className="flex-1 text-sm font-medium text-slate-700">{el.user.first_name} {el.user.last_name}</span>
                  <span className="text-xs font-mono text-slate-400">{el.matricule}</span>
                  {el.statut_inscription === "reinscription" && (
                    <button
                      onClick={() => handleFicheReinscription(el)} disabled={ficheEnCours === el.id}
                      className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                    >
                      {ficheEnCours === el.id ? "Génération…" : "🖨️ Fiche"}
                    </button>
                  )}
                  <button onClick={() => handleNonReinscrit(el)} className="text-xs text-rose-600 hover:underline">Ne se réinscrit pas</button>
                </li>
              ))}
            </ul>
          </div>

          <Button onClick={handleReinscrire} disabled={processing || nbSelectionnes === 0}>
            {processing ? "Traitement…" : `Réinscrire ${nbSelectionnes} élève(s)`}
          </Button>

          {inactifs.length > 0 && (
            <div className="mt-8">
              <p className="text-sm font-bold text-ink-900 mb-3">Élèves ne s'étant pas réinscrits ({inactifs.length})</p>
              <ul className="divide-y divide-slate-50 bg-white rounded-2xl border border-slate-100 shadow-soft overflow-hidden">
                {inactifs.map((el) => (
                  <li key={el.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 text-sm font-medium text-slate-500">{el.user.first_name} {el.user.last_name}</span>
                    {el.motif_sortie && <Badge color="rose">{el.motif_sortie}</Badge>}
                    <button onClick={() => handleReactiver(el)} className="text-xs text-emerald-600 hover:underline">Réactiver</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-10 pt-8 border-t border-slate-100">
        <p className="text-sm font-bold text-ink-900 mb-1">Élèves déjà réinscrits</p>
        <p className="text-xs text-slate-400 mb-4">Retrouvez et imprimez la liste des élèves réinscrits dans une classe, ou leur fiche individuelle.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Select label="Classe" value={classeRecherche} onChange={(e) => setClasseRecherche(e.target.value)}>
            <option value="">— Sélectionner —</option>
            <ClasseOptions classes={classes} label={(c) => `${c.nom} (${c.annee_scolaire_libelle})`} />
          </Select>
          <Input label="Rechercher un nom (optionnel)" value={rechercheNom} onChange={(e) => setRechercheNom(e.target.value)} placeholder="Nom ou prénom…" />
        </div>

        {!classeRecherche ? (
          <EmptyState title="Sélectionnez une classe" description="La liste des élèves réinscrits s'affichera ici." />
        ) : loadingReinscrits ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : reinscrits.length === 0 ? (
          <EmptyState title="Aucun élève réinscrit dans cette classe" />
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500">{reinscrits.length} élève(s) réinscrit(s)</span>
              <Button variant="secondary" onClick={handleImprimerListe} disabled={imprimant}>
                {imprimant ? "Génération…" : "🖨️ Imprimer la liste"}
              </Button>
            </div>
            <ul className="divide-y divide-slate-50 bg-white rounded-2xl border border-slate-100 shadow-soft overflow-hidden">
              {reinscrits.map((el) => (
                <li key={el.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-sm font-medium text-slate-700">{el.user.first_name} {el.user.last_name}</span>
                  <span className="text-xs font-mono text-slate-400">{el.matricule}</span>
                  <button
                    onClick={() => handleFicheReinscription(el)} disabled={ficheEnCours === el.id}
                    className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                  >
                    {ficheEnCours === el.id ? "Génération…" : "🖨️ Fiche de réinscription"}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
