import { useEffect, useState } from "react";

import { sauvegardesEcoleApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Spinner, Table } from "../components/ui";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import type { OperationSauvegardeEcole } from "../types";

const STATUT: Record<OperationSauvegardeEcole["statut"], { label: string; color: "green" | "rose" | "amber" }> = {
  succes: { label: "Succès", color: "green" },
  echec: { label: "Échec", color: "rose" },
  en_cours: { label: "En cours…", color: "amber" },
};

const LIBELLES_RESUME: [keyof OperationSauvegardeEcole["resume"], string][] = [
  ["eleves", "élèves"],
  ["enseignants", "enseignants"],
  ["classes", "classes"],
  ["notes", "notes"],
  ["paiements", "paiements"],
];

function taille(octets: number) {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

function dateHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function resume(op: OperationSauvegardeEcole) {
  return LIBELLES_RESUME.filter(([cle]) => op.resume?.[cle] !== undefined)
    .map(([cle, libelle]) => `${op.resume[cle]} ${libelle}`)
    .join(" · ");
}

/** Avertissement commun aux deux façons de restaurer (depuis l'historique ou un fichier). */
function AvertissementRestauration() {
  return (
    <div className="text-sm text-slate-600 space-y-2 mb-4">
      <p className="text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">
        Toutes les données actuelles de l'établissement (élèves, notes, paiements, classes…) seront
        <strong> remplacées</strong> par celles de la sauvegarde. Ce qui a été saisi depuis sera perdu.
      </p>
      <p>
        L'état actuel est d'abord sauvegardé automatiquement : vous pourrez revenir en arrière depuis l'historique.
        Les comptes Administrateur actuels sont conservés tels quels.
      </p>
    </div>
  );
}

export default function SauvegardeEcolePage() {
  const [operations, setOperations] = useState<OperationSauvegardeEcole[]>([]);
  const [loading, setLoading] = useState(true);
  const [lancement, setLancement] = useState(false);
  const [error, setError] = useState("");

  // Restauration depuis l'historique (`aRestaurer`) ou depuis un fichier (`importOuvert`).
  const [aRestaurer, setARestaurer] = useState<OperationSauvegardeEcole | null>(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [motDePasse, setMotDePasse] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreurModal, setErreurModal] = useState("");

  const load = (silencieux = false) => {
    if (!silencieux) setLoading(true);
    sauvegardesEcoleApi.list({ page_size: 100 })
      .then(({ data }) => setOperations(unwrapList(data)))
      .catch((err) => !silencieux && setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);
  // Sauvegardes et restaurations s'exécutent en arrière-plan côté serveur : l'historique est
  // rechargé toutes les 5 s pour afficher leur résultat.
  useAutoRefresh(() => load(true));

  const enCours = operations.find((op) => op.statut === "en_cours");

  const fermerModal = () => {
    setARestaurer(null);
    setImportOuvert(false);
    setFichier(null);
    setMotDePasse("");
    setErreurModal("");
  };

  const handleSauvegarder = async () => {
    setLancement(true);
    setError("");
    try {
      await sauvegardesEcoleApi.lancer();
      load(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLancement(false);
    }
  };

  const handleRestaurer = async () => {
    if (!motDePasse) {
      setErreurModal("Saisissez votre mot de passe pour confirmer.");
      return;
    }
    if (importOuvert && !fichier) {
      setErreurModal("Choisissez le fichier de sauvegarde (.zip).");
      return;
    }
    setEnvoi(true);
    setErreurModal("");
    try {
      let source = aRestaurer;
      if (importOuvert && fichier) {
        source = (await sauvegardesEcoleApi.importer(fichier, motDePasse)).data;
      }
      if (source) await sauvegardesEcoleApi.restaurer(source.id, motDePasse);
      fermerModal();
      load(true);
    } catch (err) {
      setErreurModal(extractErrorMessage(err));
      load(true);
    } finally {
      setEnvoi(false);
    }
  };

  const derniereSauvegarde = operations.find((op) => op.type === "sauvegarde" && op.statut === "succes");

  return (
    <div>
      <PageHeader
        title="Sauvegarde & restauration"
        description="Sauvegardez toutes les données de votre établissement et restaurez-les en cas de besoin."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOuvert(true)} disabled={!!enCours}>
              📂 Restaurer depuis un fichier
            </Button>
            <Button onClick={handleSauvegarder} disabled={lancement || !!enCours}>
              {enCours ? `${enCours.type === "restauration" ? "Restauration" : "Sauvegarde"} en cours…` : "🗄️ Sauvegarder maintenant"}
            </Button>
          </>
        }
      />

      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 mb-4">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Dernière sauvegarde</p>
          {derniereSauvegarde ? (
            <>
              <p className="text-lg font-bold text-ink-900">{dateHeure(derniereSauvegarde.date_lancement)}</p>
              <p className="text-xs text-slate-500 mt-1">{resume(derniereSauvegarde)}</p>
            </>
          ) : (
            <p className="text-lg font-bold text-ink-900">Aucune</p>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 text-sm text-slate-600 space-y-1.5">
          <p>
            Une sauvegarde contient <strong>toutes les données</strong> de l'établissement (comptes, élèves, notes,
            présences, paiements, dépenses, bibliothèque, transport, cantine…) et leurs fichiers (photos, logo, justificatifs).
          </p>
          <p>
            Téléchargez-la régulièrement et gardez-la en lieu sûr : elle contient des données personnelles. Les
            10 dernières sont aussi conservées sur le serveur.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : operations.length === 0 ? (
        <EmptyState title="Aucune sauvegarde pour l'instant" description="Lancez votre première sauvegarde avec le bouton ci-dessus." />
      ) : (
        <Table headers={["Date", "Opération", "Statut", "Contenu", "Taille", "Détail", ""]}>
          {operations.map((op) => (
            <tr key={op.id}>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                {dateHeure(op.date_lancement)}
                {op.auteur_nom && <span className="block text-xs text-slate-400">{op.auteur_nom}</span>}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="font-semibold text-ink-900">{op.type === "restauration" ? "♻️ Restauration" : "🗄️ Sauvegarde"}</span>
                {op.type === "sauvegarde" && <span className="block text-xs text-slate-400">{op.origine_display}</span>}
              </td>
              <td className="px-4 py-3"><Badge color={STATUT[op.statut].color}>{STATUT[op.statut].label}</Badge></td>
              <td className="px-4 py-3 text-xs text-slate-500">{op.statut === "succes" ? resume(op) : "—"}</td>
              <td className="px-4 py-3 whitespace-nowrap">{op.taille_octets ? taille(op.taille_octets) : "—"}</td>
              <td className="px-4 py-3 text-xs text-slate-500 max-w-xs">{op.message}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {op.disponible && (
                  <div className="flex gap-3">
                    <button
                      className="text-xs font-semibold text-brand-600 hover:underline"
                      onClick={() => sauvegardesEcoleApi.telecharger(op.id, op.fichier).catch((err) => setError(extractErrorMessage(err)))}
                    >
                      Télécharger
                    </button>
                    <button
                      className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-40 disabled:no-underline"
                      disabled={!!enCours}
                      onClick={() => setARestaurer(op)}
                    >
                      Restaurer
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={!!aRestaurer || importOuvert}
        onClose={fermerModal}
        title={importOuvert ? "Restaurer depuis un fichier" : "Restaurer cette sauvegarde"}
      >
        {aRestaurer && (
          <p className="text-sm text-slate-600 mb-3">
            Sauvegarde du <strong>{dateHeure(aRestaurer.date_lancement)}</strong>
            {resume(aRestaurer) && <> — {resume(aRestaurer)}</>}
          </p>
        )}
        {importOuvert && (
          <label className="block mb-4">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">
              Fichier de sauvegarde (.zip) téléchargé depuis cette page<span className="text-rose-500"> *</span>
            </span>
            <input type="file" accept=".zip,application/zip" onChange={(e) => setFichier(e.target.files?.[0] || null)} className="text-sm" />
          </label>
        )}
        <AvertissementRestauration />
        <Input
          label="Votre mot de passe"
          required
          type="password"
          autoComplete="current-password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />
        {erreurModal && <p className="text-sm text-rose-600 mt-3">{erreurModal}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={fermerModal} disabled={envoi}>Annuler</Button>
          <Button variant="danger" onClick={handleRestaurer} disabled={envoi}>
            {envoi ? (importOuvert ? "Envoi du fichier…" : "Lancement…") : "♻️ Restaurer"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
