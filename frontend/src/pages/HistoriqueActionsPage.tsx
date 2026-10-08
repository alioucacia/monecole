import { Fragment, useEffect, useState } from "react";

import { usersApi } from "../api/services";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Spinner, Table } from "../components/ui";
import { usePaginated } from "../hooks/usePaginated";
import type { JournalUtilisateurEntry } from "../types";

const ACTIONS: { valeur: JournalUtilisateurEntry["action"]; label: string; color: "green" | "brand" | "rose" | "slate" | "amber" | "teal" }[] = [
  { valeur: "creation", label: "Création", color: "green" },
  { valeur: "modification", label: "Modification", color: "brand" },
  { valeur: "suppression", label: "Suppression", color: "rose" },
  { valeur: "export", label: "Export", color: "amber" },
  { valeur: "connexion", label: "Connexion", color: "teal" },
  { valeur: "autre", label: "Autre action", color: "slate" },
];

const CATEGORIES: [JournalUtilisateurEntry["categorie"], string][] = [
  ["eleve", "Élèves"], ["enseignant", "Enseignants"], ["note", "Notes"], ["paiement", "Paiements"],
  ["academique", "Classes & matières"], ["presence", "Présences"], ["compte", "Comptes"],
  ["communication", "Communication"], ["bibliotheque", "Bibliothèque"], ["transport", "Transport"],
  ["cantine", "Cantine"], ["acces", "Contrôle d'accès"], ["parametres", "Paramètres & données"],
  ["connexion", "Connexions"], ["autre", "Autre"],
];

const ROLES: [string, string][] = [
  ["admin", "Administrateur"], ["directeur", "Directeur"], ["comptabilite", "Comptabilité"],
  ["surveillance", "Surveillance"], ["teacher", "Enseignant"], ["parent", "Parent"], ["student", "Élève"],
];

const OPERATIONS: Record<string, string> = { creation: "Créé", modification: "Modifié", suppression: "Supprimé" };

function dateHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}

function Details({ entree }: { entree: JournalUtilisateurEntry }) {
  return (
    <div className="space-y-3 text-sm">
      {entree.details.length === 0 ? (
        <p className="text-slate-500">Aucun détail supplémentaire enregistré pour cette action.</p>
      ) : (
        entree.details.map((element, i) => (
          <div key={i}>
            <p className="font-semibold text-ink-900">
              {OPERATIONS[element.operation] ?? element.operation} · {element.modele} « {element.libelle} »
            </p>
            {element.champs && element.champs.length > 0 && (
              <ul className="mt-1 ml-4 space-y-0.5 text-slate-600">
                {element.champs.map((c, j) => (
                  <li key={j}>
                    <span className="font-medium">{c.champ}</span> :{" "}
                    {c.masque ? (
                      <span className="italic text-slate-400">modifié (valeur masquée)</span>
                    ) : (
                      <>
                        <span className="line-through text-rose-600">{c.avant || "(vide)"}</span>
                        {" → "}
                        <span className="text-emerald-700">{c.apres || "(vide)"}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
      <p className="text-xs text-slate-400">
        {[entree.adresse_ip && `IP ${entree.adresse_ip}`, entree.appareil, entree.methode && `${entree.methode} ${entree.chemin}`]
          .filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

export default function HistoriqueActionsPage() {
  const [saisie, setSaisie] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [categorie, setCategorie] = useState("");
  const [role, setRole] = useState("");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [ouverte, setOuverte] = useState<number | null>(null);

  // La recherche part 400 ms après la dernière frappe, pas à chaque touche.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(saisie.trim()), 400);
    return () => clearTimeout(timer);
  }, [saisie]);

  const { items, count, loading, hasNext, hasPrevious, goNext, goPrevious } = usePaginated<JournalUtilisateurEntry>(
    () => usersApi.journalEcole({
      page_size: 50,
      search: search || undefined,
      action: action || undefined,
      categorie: categorie || undefined,
      role: role || undefined,
      date_debut: dateDebut || undefined,
      date_fin: dateFin || undefined,
    }),
    [search, action, categorie, role, dateDebut, dateFin],
  );

  const filtresActifs = saisie || action || categorie || role || dateDebut || dateFin;
  const reinitialiser = () => {
    setSaisie(""); setAction(""); setCategorie(""); setRole(""); setDateDebut(""); setDateFin("");
  };

  return (
    <div>
      <PageHeader
        title="Historique des actions"
        description="Qui a fait quoi dans l'établissement : créations, modifications, suppressions, exports et connexions, avec le détail des changements."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 mb-4">
        <Input
          label="Rechercher"
          className="lg:col-span-2"
          placeholder="Nom de l'utilisateur, élève, description…"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
        />
        <Select label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Toutes</option>
          {ACTIONS.map((a) => <option key={a.valeur} value={a.valeur}>{a.label}</option>)}
        </Select>
        <Select label="Domaine" value={categorie} onChange={(e) => setCategorie(e.target.value)}>
          <option value="">Tous</option>
          {CATEGORIES.map(([valeur, label]) => <option key={valeur} value={valeur}>{label}</option>)}
        </Select>
        <Select label="Rôle" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous</option>
          {ROLES.map(([valeur, label]) => <option key={valeur} value={valeur}>{label}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Du" type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
          <Input label="Au" type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 text-sm text-slate-500">
        <span>{count !== null && `${count.toLocaleString("fr-FR")} action(s)`}</span>
        {filtresActifs && <Button variant="secondary" onClick={reinitialiser}>Effacer les filtres</Button>}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucune action enregistrée" description={filtresActifs ? "Aucun résultat pour ces filtres." : undefined} />
      ) : (
        <>
          <Table headers={["Date", "Utilisateur", "Action", "Domaine", "Description", ""]}>
            {items.map((e) => {
              const style = ACTIONS.find((a) => a.valeur === e.action);
              return (
                <Fragment key={e.id}>
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOuverte(ouverte === e.id ? null : e.id)}>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{dateHeure(e.horodatage)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">
                        {e.utilisateur_nom || "—"}
                        {e.utilisateur === null && <span className="ml-1 text-xs text-slate-400">(compte supprimé)</span>}
                      </p>
                      <p className="text-xs text-slate-500">{e.utilisateur_role_display}</p>
                    </td>
                    <td className="px-4 py-3"><Badge color={style?.color ?? "slate"}>{e.action_display}</Badge></td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{e.categorie_display}</td>
                    <td className="px-4 py-3 text-slate-700">{e.description}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{ouverte === e.id ? "▲ Masquer" : "▼ Détails"}</td>
                  </tr>
                  {ouverte === e.id && (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 bg-slate-50"><Details entree={e} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Table>
          {(hasPrevious || hasNext) && (
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" disabled={!hasPrevious} onClick={goPrevious}>← Précédent</Button>
              <Button variant="secondary" disabled={!hasNext} onClick={goNext}>Suivant →</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
