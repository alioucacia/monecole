import type { CategoriePaiement } from "../types";

/** Libellés courts de la catégorie de paiement (voir EleveProfile.CategoriePaiement côté
 * backend) — pour l'étiquette affichée sous le nom de l'élève dans les listes. */
const STATUTS: Record<CategoriePaiement, { label: string; className: string }> = {
  standard: { label: "Mensualité : Standard", className: "bg-slate-100 text-slate-500" },
  fondation_50: { label: "Fondation — 50%", className: "bg-amber-100 text-amber-700" },
  fondation_gratuit: { label: "Fondation — Gratuit", className: "bg-emerald-100 text-emerald-700" },
  inscription_seulement: { label: "Inscription uniquement", className: "bg-sky-100 text-sky-700" },
};

/** Étiquette « Statut de paiement (mensualité) » — distingue d'un coup d'œil les élèves pris en
 * charge par la Fondation des élèves au tarif standard. `exonereFratrie` (benjamin d'une famille
 * d'au moins 6 enfants) prime : l'élève ne paie pas la mensualité, quelle que soit sa catégorie. */
export function StatutMensualiteBadge({ categorie, exonereFratrie }: { categorie?: CategoriePaiement | null; exonereFratrie?: boolean }) {
  if (exonereFratrie) return <ExonereFratrieBadge />;
  const statut = STATUTS[categorie ?? "standard"] ?? STATUTS.standard;
  return (
    <span
      title="Statut de paiement (mensualité)"
      className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statut.className}`}
    >
      {statut.label}
    </span>
  );
}

/** Distinction de l'enfant exonéré de mensualité au titre de la fratrie. */
export function ExonereFratrieBadge() {
  return (
    <span
      title="Classe la plus basse d'une famille d'au moins 6 enfants inscrits : ne paie pas la mensualité"
      className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700 ring-1 ring-violet-300"
    >
      ★ Exonéré — Fratrie
    </span>
  );
}
