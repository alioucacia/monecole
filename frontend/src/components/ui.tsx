import { useRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, MouseEvent, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white/95 rounded-2xl shadow-soft border border-slate-100 p-5 animate-fade-in-up transition-shadow duration-300 hover:shadow-card ${className}`}>
      {children}
    </div>
  );
}

const ACCENT_TILES: Record<string, string> = {
  brand: "bg-gradient-to-br from-brand-500 to-brand-700 text-white",
  green: "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white",
  amber: "bg-gradient-to-br from-amber-400 to-amber-600 text-white",
  rose: "bg-gradient-to-br from-rose-400 to-rose-600 text-white",
  teal: "bg-gradient-to-br from-accent-400 to-accent-600 text-white",
};

export function StatCard({
  label, value, icon, accent = "brand",
}: { label: string; value: ReactNode; icon?: ReactNode; accent?: "brand" | "green" | "amber" | "rose" | "teal" }) {
  return (
    <Card className="flex items-center gap-3 sm:gap-4 group">
      {icon && (
        <div className={`h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-xl2 flex items-center justify-center text-lg sm:text-xl shadow-soft transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 ${ACCENT_TILES[accent]}`}>
          {icon}
        </div>
      )}
      {/* `break-words` : un montant formaté ("1 251 000 GNF") contient des espaces insécables
          (Number.toLocaleString("fr-FR")) sur lesquels le texte ne peut pas se couper — sans
          quoi une carte étroite (mobile, grille 2 colonnes) le laissait déborder/rogné plutôt
          que de passer à la ligne suivante. */}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-lg sm:text-2xl font-extrabold text-ink-900 tracking-tight break-words">{value}</p>
      </div>
    </Card>
  );
}

export function Badge({ children, color = "slate" }: { children: ReactNode; color?: "slate" | "green" | "amber" | "rose" | "brand" | "teal" }) {
  const colors: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    brand: "bg-brand-100 text-brand-700",
    teal: "bg-accent-100 text-accent-700",
  };
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${colors[color]}`}>{children}</span>;
}

export function Button({
  variant = "primary", className = "", children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  // `active:scale-95` sur les 4 variantes : un léger effet d'enfoncement au clic (relâché dès que
  // le bouton reperd le focus tactile/souris), pour un retour plus tactile qu'un simple
  // changement de couleur — perceptible sans ralentir l'interaction (150ms, comme le reste).
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";
  const variants: Record<string, string> = {
    primary: "bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-soft hover:shadow-glow hover:-translate-y-0.5",
    secondary: "bg-white border border-slate-200 text-slate-700 hover:border-brand-300 hover:text-brand-700 hover:-translate-y-0.5 hover:shadow-soft",
    danger: "bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-soft hover:shadow-lg hover:-translate-y-0.5",
    ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

// `required` n'est volontairement JAMAIS transmis à l'élément natif (voir Input/Select/Textarea
// ci-dessous) : l'infobulle "Veuillez renseigner ce champ" du navigateur n'est ni stylable ni
// cohérente avec le reste de l'app. Seul l'astérisque visuel reste — le contrôle réel du champ
// obligatoire se fait en Python (le serializer DRF rejette un champ manquant avec un message
// explicite, déjà affiché par chaque formulaire via `extractErrorMessage`) ou, quand une page a
// besoin d'un retour immédiat avant l'appel réseau, en React (voir par ex. LoginPage.tsx).
export function Input({ label, required, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="block text-sm font-semibold text-slate-600 mb-1.5">
          {label}{required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      <input
        className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 transition focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400 ${className}`}
        {...props}
      />
    </label>
  );
}

/** Saisie d'un code OTP « en carreaux » (une case par chiffre) — plus lisible qu'un simple champ
 * texte pour un code à 6 chiffres, et le geste (avance automatique, retour arrière, collage du
 * code entier reçu par SMS/e-mail d'un coup) est plus naturel. Utilisé partout où un OTP se
 * saisit (connexion 2FA, réinitialisation de mot de passe, vérification e-mail/téléphone). */
export function OtpBoxInput({
  value, onChange, length = 6, autoFocus = false, disabled = false,
}: { value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chiffres = Array.from({ length }, (_, i) => value[i] || "");

  const setChiffre = (i: number, saisie: string) => {
    const chiffre = saisie.replace(/\D/g, "").slice(-1);
    const suivant = value.split("");
    suivant[i] = chiffre;
    onChange(suivant.join("").slice(0, length));
    if (chiffre && i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !chiffres[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const colle = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!colle) return;
    onChange(colle);
    refs.current[Math.min(colle.length, length - 1)]?.focus();
  };

  return (
    <div className="flex items-center justify-center gap-2">
      {chiffres.map((chiffre, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={chiffre}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => setChiffre(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="h-14 w-12 rounded-xl2 border-2 border-slate-200 bg-white text-center text-xl font-extrabold text-ink-900 transition focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400 disabled:opacity-50"
        />
      ))}
    </div>
  );
}

const ACTION_BUTTON_SIZES: Record<"sm" | "md", string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
};

export function EditButton({
  onClick, title = "Modifier", tone = "default", size = "md", className = "",
}: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; title?: string; tone?: "default" | "light"; size?: "sm" | "md"; className?: string }) {
  const toneClasses =
    tone === "light"
      ? "text-white/90 hover:bg-white/20 hover:text-white"
      : "text-brand-600 hover:bg-brand-50 hover:text-brand-700";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center rounded-lg transition-transform duration-150 hover:scale-110 active:scale-90 ${ACTION_BUTTON_SIZES[size]} ${toneClasses} ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25L18.75 8.25" />
      </svg>
    </button>
  );
}

export function DeleteButton({
  onClick, title = "Supprimer", tone = "default", size = "md", className = "",
}: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; title?: string; tone?: "default" | "light"; size?: "sm" | "md"; className?: string }) {
  const toneClasses =
    tone === "light"
      ? "text-white/90 hover:bg-white/20 hover:text-white"
      : "text-rose-600 hover:bg-rose-50 hover:text-rose-700";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center rounded-lg transition-transform duration-150 hover:scale-110 active:scale-90 ${ACTION_BUTTON_SIZES[size]} ${toneClasses} ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    </button>
  );
}

export function RowActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-1 ${className}`}>{children}</div>;
}

export function Select({
  label, required, children, className = "", ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; children: ReactNode }) {
  return (
    <label className="block">
      {label && (
        <span className="block text-sm font-semibold text-slate-600 mb-1.5">
          {label}{required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      <select
        className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 transition focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400 ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

// Même règle que Input/Select ci-dessus : `required` jamais transmis à l'élément natif.
export function Textarea({
  label, required, className = "", ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="block text-sm font-semibold text-slate-600 mb-1.5">
          {label}{required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      <textarea
        className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 transition focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400 ${className}`}
        {...props}
      />
    </label>
  );
}

export function Modal({
  open, onClose, title, children, wide = false,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 backdrop-blur-sm p-4 animate-fade-in-up" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto animate-pop-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 hover:rotate-90 text-xl leading-none transition-all duration-200"
          >
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-spin rounded-full border-2 border-brand-100 border-t-brand-600 h-6 w-6 ${className}`} />
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-14 text-slate-500 animate-fade-in-up">
      <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-brand-50 text-brand-400 flex items-center justify-center text-xl animate-pulse-soft">✦</div>
      <p className="font-semibold text-slate-600">{title}</p>
      {description && <p className="text-sm mt-1 text-slate-400">{description}</p>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-7">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-900 tracking-tight">{title}</h1>
        {description && <p className="text-slate-500 mt-1.5">{description}</p>}
      </div>
      {/* `flex-wrap` : certaines pages passent 3-4 boutons dans `actions` (ex: Paiements) — sans
          ça, ils étaient tous forcés sur une seule ligne qui débordait hors de l'écran en
          mobile (défilement horizontal peu visible plutôt que de passer à la ligne). */}
      {actions && <div className="flex items-center flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-soft bg-white">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-brand-50/60">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3.5 text-left font-bold text-brand-900/80 text-xs uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 [&>tr]:transition [&>tr:hover]:bg-brand-50/40">{children}</tbody>
      </table>
    </div>
  );
}
