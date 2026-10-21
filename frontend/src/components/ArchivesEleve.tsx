import { useEffect, useState, type FormEvent } from "react";

import { classesApi, elevesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { TYPES_SORTIE, type Classe, type EleveProfile, type HistoriqueStatutEleve, type TypeSortie } from "../types";
import { Badge, Button, Input, Modal, Select, Spinner } from "./ui";

/** Nature de la sortie d'un élève inactif (archivé / transféré / abandon / cycle terminé). */
export function TypeSortieBadge({ eleve }: { eleve: Pick<EleveProfile, "actif" | "type_sortie"> }) {
  if (eleve.actif) return null;
  const type = TYPES_SORTIE.find((t) => t.value === eleve.type_sortie) ?? TYPES_SORTIE[0];
  return <Badge color={type.color}>{type.icon} {type.label}</Badge>;
}

/**
 * Sortie d'un ou plusieurs élèves (voir backend people/archives.py) — ou, pour un seul élève déjà
 * sorti, changement de la nature de sa sortie. Rien n'est supprimé : l'élève devient inactif et
 * garde sa classe, ses notes, frais et paiements.
 */
export function SortieEleveModal({
  eleves, onClose, onDone,
}: { eleves: EleveProfile[] | null; onClose: () => void; onDone: (eleve?: EleveProfile) => void }) {
  const reclassement = eleves?.length === 1 && !eleves[0].actif;
  const [form, setForm] = useState({ type_sortie: "archive" as TypeSortie, motif: "", date_sortie: "", etablissement_destination: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eleves) return;
    const e = eleves.length === 1 ? eleves[0] : null;
    setForm({
      type_sortie: (e && e.type_sortie) || "archive",
      motif: e && !e.actif ? e.motif_sortie : "",
      date_sortie: e && !e.actif && e.date_sortie ? e.date_sortie : "",
      etablissement_destination: e && !e.actif ? e.etablissement_destination : "",
    });
    setError("");
  }, [eleves]);

  if (!eleves) return null;
  const titre = reclassement
    ? "Modifier la sortie"
    : eleves.length === 1
      ? `Sortie de ${eleves[0].user.first_name} ${eleves[0].user.last_name}`
      : `Sortie de ${eleves.length} élèves`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const data = {
      type_sortie: form.type_sortie, motif: form.motif, date_sortie: form.date_sortie || null,
      etablissement_destination: form.type_sortie === "transfert" ? form.etablissement_destination : "",
    };
    try {
      if (eleves.length === 1) {
        const { data: eleve } = await elevesApi.sortie(eleves[0].id, data);
        onDone(eleve);
      } else {
        await elevesApi.sortieGroupee(eleves.map((el) => el.id), data);
        onDone();
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={titre}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-500">
          L'élève devient inactif et rejoint les archives. Rien n'est supprimé : notes, frais et paiements restent
          consultables, et il peut être restauré à tout moment.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TYPES_SORTIE.map((t) => (
            <button
              key={t.value} type="button"
              onClick={() => setForm({ ...form, type_sortie: t.value })}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold text-left transition ${
                form.type_sortie === t.value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-brand-300"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        {form.type_sortie === "transfert" && (
          <Input
            label="Établissement d'accueil" value={form.etablissement_destination} maxLength={150}
            onChange={(e) => setForm({ ...form, etablissement_destination: e.target.value })}
          />
        )}
        <Input label="Motif (optionnel)" value={form.motif} maxLength={255} onChange={(e) => setForm({ ...form, motif: e.target.value })} />
        <Input
          label={reclassement ? "Date de sortie" : "Date de sortie (aujourd'hui par défaut)"} type="date"
          value={form.date_sortie} onChange={(e) => setForm({ ...form, date_sortie: e.target.value })}
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Confirmer"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Restauration d'un élève sorti : dans sa dernière classe ou dans une autre (année en cours). */
export function RestaurerEleveModal({
  eleve, onClose, onDone,
}: { eleve: EleveProfile | null; onClose: () => void; onDone: (eleve: EleveProfile) => void }) {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [classe, setClasse] = useState("");
  const [motif, setMotif] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eleve) return;
    setClasse("");
    setMotif("");
    setError("");
    classesApi.list().then(({ data }) => setClasses(unwrapList(data))).catch(() => {});
  }, [eleve]);

  if (!eleve) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await elevesApi.restaurer(eleve.id, { classe: classe ? Number(classe) : null, motif });
      onDone(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Restaurer ${eleve.user.first_name} ${eleve.user.last_name}`}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-500">
          L'élève redevient actif. Son historique (notes, paiements, sorties précédentes) est conservé.
        </p>
        <Select label="Classe" value={classe} onChange={(e) => setClasse(e.target.value)}>
          <option value="">{eleve.classe_nom ? `Dernière classe (${eleve.classe_nom})` : "Sans classe"}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}{c.annee_scolaire_libelle ? ` — ${c.annee_scolaire_libelle}` : ""}
            </option>
          ))}
        </Select>
        <Input label="Motif (optionnel)" value={motif} maxLength={255} onChange={(e) => setMotif(e.target.value)} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={saving}>{saving ? "Restauration…" : "✅ Restaurer"}</Button>
        </div>
      </form>
    </Modal>
  );
}

const ICONES_EVENEMENT: Record<HistoriqueStatutEleve["evenement"], string> = {
  sortie: "🚪", reclassement: "✏️", restauration: "✅",
};

/** Journal des sorties / reclassements / restaurations d'un élève (jamais effacé). */
export function HistoriqueStatutListe({ eleveId, version = 0 }: { eleveId: number; version?: number }) {
  const [evenements, setEvenements] = useState<HistoriqueStatutEleve[] | null>(null);

  useEffect(() => {
    elevesApi.historiqueStatut(eleveId).then(({ data }) => setEvenements(data)).catch(() => setEvenements([]));
  }, [eleveId, version]);

  if (evenements === null) return <Spinner />;
  if (!evenements.length) return <p className="text-sm text-slate-400">Aucune sortie ni restauration enregistrée.</p>;
  return (
    <ol className="space-y-3">
      {evenements.map((ev) => (
        <li key={ev.id} className="flex gap-3 text-sm">
          <span className="shrink-0">{ICONES_EVENEMENT[ev.evenement]}</span>
          <div>
            <p className="font-semibold text-slate-700">
              {ev.evenement_display}
              {ev.type_sortie_display && ev.evenement !== "restauration" && <> — {ev.type_sortie_display}</>}
              {ev.evenement === "restauration" && ev.type_sortie_display && (
                <span className="font-normal text-slate-500"> (était : {ev.type_sortie_display})</span>
              )}
            </p>
            <p className="text-slate-500">
              {new Date(ev.date).toLocaleDateString("fr-FR")}
              {ev.classe_nom && <> · {ev.classe_nom}{ev.annee_scolaire_libelle && ` (${ev.annee_scolaire_libelle})`}</>}
              {ev.auteur_nom && <> · par {ev.auteur_nom}</>}
            </p>
            {ev.etablissement_destination && <p className="text-slate-500">Vers : {ev.etablissement_destination}</p>}
            {ev.motif && <p className="text-slate-500 italic">{ev.motif}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
