import { MODELES_DOCUMENT } from "../types";

/** Miniature stylisée représentant l'allure générale d'un modèle de document (1-4), colorée
 * avec les couleurs de l'école — pas un rendu PDF réel (aucune conversion PDF→image côté
 * backend, volontairement pour rester léger), mais fidèle à la logique effectivement
 * implémentée dans les gabarits PDF (bandeau plein / bandeau deux tons / non rempli avec
 * filets / bandeau dense monochrome) afin que l'aperçu corresponde à ce qui sera généré. */
function ModeleThumbnail({
  modele, couleurPrincipale, couleurSecondaire,
}: { modele: number; couleurPrincipale: string; couleurSecondaire: string }) {
  return (
    <div className="w-full aspect-[3/4] rounded-md overflow-hidden border border-slate-200 bg-white flex flex-col shrink-0">
      {modele === 2 && (
        <div className="flex h-5 shrink-0">
          <div style={{ width: "65%", backgroundColor: couleurPrincipale }} />
          <div style={{ width: "35%", backgroundColor: couleurSecondaire }} />
        </div>
      )}
      {modele === 3 && (
        <div
          className="h-5 shrink-0 flex items-center justify-center"
          style={{ borderTop: `2px solid ${couleurPrincipale}`, borderBottom: `2px solid ${couleurPrincipale}` }}
        >
          <div className="h-0.5 w-1/2" style={{ backgroundColor: couleurSecondaire }} />
        </div>
      )}
      {modele === 4 && <div className="h-3.5 shrink-0" style={{ backgroundColor: couleurPrincipale }} />}
      {modele === 1 && (
        <>
          <div className="h-5 shrink-0" style={{ backgroundColor: couleurPrincipale }} />
          <div className="h-0.5 shrink-0" style={{ backgroundColor: couleurSecondaire }} />
        </>
      )}
      {modele === 5 && (
        <div className="p-1.5 space-y-1">
          <div className="h-1 w-2/3 rounded-full" style={{ backgroundColor: "#e2e8f0" }} />
          <div className="h-3 w-full rounded-sm mt-1" style={{ backgroundColor: couleurSecondaire }} />
        </div>
      )}
      <div className="flex-1 p-2 space-y-1.5">
        <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: "#e2e8f0" }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: "#e2e8f0" }} />
        <div className="mt-2 h-1 w-full rounded-full" style={{ backgroundColor: "#f1f5f9" }} />
        <div className="h-1 w-full rounded-full" style={{ backgroundColor: "#f1f5f9" }} />
        <div className="h-1 w-5/6 rounded-full" style={{ backgroundColor: "#f1f5f9" }} />
        {modele === 5 && <div className="h-3 w-full rounded-sm mt-1.5" style={{ backgroundColor: couleurSecondaire }} />}
      </div>
    </div>
  );
}

/** Sélecteur d'un modèle de document (1-4) sous forme de galerie de miniatures cliquables,
 * plutôt qu'un menu déroulant à l'aveugle — le Super Admin voit à quoi ressemble chaque
 * modèle (avec les couleurs choisies pour l'école) avant de le choisir. */
export function ModeleDocumentField({
  label, value, onChange, couleurPrincipale, couleurSecondaire, values,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  couleurPrincipale: string;
  couleurSecondaire: string;
  /** Sous-ensemble des modèles proposés pour ce document (par défaut : les 4 génériques
   * 1-4). Utilisé par le bulletin pour inclure aussi le modèle 5 « Officiel », qui n'a de
   * rendu dédié que pour ce document. */
  values?: number[];
}) {
  const modeles = MODELES_DOCUMENT.filter((m) => (values ?? [1, 2, 3, 4]).includes(m.value));
  return (
    <div>
      <span className="block text-sm font-semibold text-slate-600 mb-2">{label}</span>
      <div className={`grid gap-2 ${modeles.length >= 5 ? "grid-cols-5" : "grid-cols-4"}`}>
        {modeles.map((m) => {
          const selected = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange(m.value)}
              aria-pressed={selected}
              className={`rounded-lg p-1.5 text-left transition ${
                selected ? "ring-2 ring-brand-500 bg-brand-50" : "ring-1 ring-transparent hover:bg-slate-50"
              }`}
            >
              <ModeleThumbnail modele={m.value} couleurPrincipale={couleurPrincipale} couleurSecondaire={couleurSecondaire} />
              <span className={`block mt-1 text-[11px] text-center font-medium truncate ${selected ? "text-brand-700" : "text-slate-500"}`}>
                {selected ? "✓ " : ""}{m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
