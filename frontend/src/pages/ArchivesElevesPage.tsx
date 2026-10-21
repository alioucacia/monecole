import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { elevesApi } from "../api/services";
import { HistoriqueStatutListe, RestaurerEleveModal, SortieEleveModal, TypeSortieBadge } from "../components/ArchivesEleve";
import { Button, EmptyState, Input, Modal, PageHeader, RowActions, Spinner, StatCard, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import { TYPES_SORTIE, type EleveProfile, type TypeSortie } from "../types";

/**
 * Archives des élèves, séparées par nature de sortie (archivés, transférés, abandons, cycle
 * terminé) — restauration possible sans perte d'historique (voir backend people/archives.py).
 */
export default function ArchivesElevesPage() {
  const { user } = useAuth();
  const toast = useToast();
  // Directeur : lecture seule (backend IsAdminOrComptabilite).
  const peutGerer = user?.role === "admin" || user?.role === "comptabilite";
  const [onglet, setOnglet] = useState<TypeSortie | "">("");
  const [search, setSearch] = useState("");
  const [resume, setResume] = useState<Record<TypeSortie | "total", number> | null>(null);
  const [aReclasser, setAReclasser] = useState<EleveProfile[] | null>(null);
  const [aRestaurer, setARestaurer] = useState<EleveProfile | null>(null);
  const [historique, setHistorique] = useState<EleveProfile | null>(null);

  const { items, count, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<EleveProfile>(
    () => elevesApi.list({ actif: false, type_sortie: onglet || undefined, search: search || undefined, ordering: "-date_sortie" }),
    [onglet, search]
  );

  const chargerResume = useCallback(() => {
    elevesApi.archivesResume().then(({ data }) => setResume(data)).catch(() => {});
  }, []);
  useEffect(chargerResume, [chargerResume]);

  const actualiser = () => {
    reload();
    chargerResume();
  };

  const onglets: { value: TypeSortie | ""; label: string; icon: string; n?: number }[] = [
    { value: "", label: "Toutes les sorties", icon: "📦", n: resume?.total },
    ...TYPES_SORTIE.map((t) => ({ value: t.value, label: t.label, icon: t.icon, n: resume?.[t.value] })),
  ];

  return (
    <div>
      <PageHeader
        title="Archives des élèves"
        description="Élèves sortis de l'établissement, classés par nature de sortie. Leur historique est conservé et ils peuvent être restaurés à tout moment."
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {onglets.map((o) => (
          <button
            key={o.value} className={`text-left rounded-2xl ${onglet === o.value ? "ring-2 ring-brand-500" : ""}`}
            onClick={() => setOnglet(o.value)}
          >
            <StatCard label={o.label} value={o.n !== undefined ? String(o.n) : "…"} icon={o.icon} accent="brand" />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <Input placeholder="Rechercher (nom, matricule)…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun élève dans ces archives" />
      ) : (
        <>
          <Table headers={["Matricule", "Nom complet", "Dernière classe", "Sortie", "Date", "Motif / destination", "Actions"]}>
            {items.map((eleve) => (
              <tr key={eleve.id}>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{eleve.matricule}</td>
                <td className="px-4 py-3 font-medium text-slate-700">
                  <Link to={`/eleves/${eleve.id}`} className="hover:text-brand-700">
                    {eleve.user.first_name} {eleve.user.last_name}
                  </Link>
                </td>
                <td className="px-4 py-3">{eleve.classe_nom || <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-3"><TypeSortieBadge eleve={eleve} /></td>
                <td className="px-4 py-3 text-slate-500">
                  {eleve.date_sortie ? new Date(eleve.date_sortie).toLocaleDateString("fr-FR") : "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {eleve.etablissement_destination && <span className="block">→ {eleve.etablissement_destination}</span>}
                  {eleve.motif_sortie || (!eleve.etablissement_destination && <span className="text-slate-400">—</span>)}
                </td>
                <td className="px-4 py-3">
                  <RowActions>
                    <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setHistorique(eleve)}>
                      🕘 Historique
                    </button>
                    {peutGerer && (
                      <>
                        <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setAReclasser([eleve])}>
                          ✏️ Reclasser
                        </button>
                        <button className="text-xs font-semibold text-emerald-600 hover:underline" onClick={() => setARestaurer(eleve)}>
                          ✅ Restaurer
                        </button>
                      </>
                    )}
                  </RowActions>
                </td>
              </tr>
            ))}
          </Table>
          <div className="flex justify-between items-center mt-4 text-sm text-slate-500">
            <span>Total : {count ?? items.length}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!hasPrevious} onClick={goPrevious}>← Précédent</Button>
              <Button variant="secondary" disabled={!hasNext} onClick={goNext}>Suivant →</Button>
            </div>
          </div>
        </>
      )}

      <SortieEleveModal
        eleves={aReclasser} onClose={() => setAReclasser(null)}
        onDone={() => { setAReclasser(null); toast.success("Sortie mise à jour."); actualiser(); }}
      />
      <RestaurerEleveModal
        eleve={aRestaurer} onClose={() => setARestaurer(null)}
        onDone={(e) => { setARestaurer(null); toast.success(`${e.user.first_name} ${e.user.last_name} a été restauré(e).`); actualiser(); }}
      />
      <Modal
        open={historique !== null} onClose={() => setHistorique(null)}
        title={historique ? `Historique — ${historique.user.first_name} ${historique.user.last_name}` : ""}
      >
        {historique && <HistoriqueStatutListe eleveId={historique.id} />}
      </Modal>
    </div>
  );
}
