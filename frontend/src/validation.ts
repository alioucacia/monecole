import { emitToast } from "./context/ToastContext";

/**
 * Contrôle commun des formulaires, fait en React/JS plutôt que par le navigateur : tous les
 * formulaires portent `noValidate` (plus aucune infobulle native « Veuillez renseigner ce champ »,
 * « La valeur doit être inférieure ou égale à… », ni non stylables ni cohérentes avec l'app).
 *
 * Avant chaque envoi, on vérifie ici — pour tout formulaire de la page — les champs marqués
 * obligatoires (`data-requis`, posé par Input/Select/Textarea quand on leur passe `required`), les
 * bornes `min`/`max` des champs numériques et le format des e-mails. En cas de problème, l'envoi est
 * bloqué, les champs fautifs sont entourés en rouge et UN message simple s'affiche. Le serveur
 * (Python) refait de toute façon ses propres contrôles — voir school_backend/exceptions.py.
 */

type Champ = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nomDuChamp(champ: Champ): string {
  const libelle = champ.closest("label")?.querySelector("span")?.textContent ?? champ.getAttribute("aria-label") ?? champ.name;
  return (libelle || "ce champ").replace(/\s*\*\s*$/, "").trim();
}

function marquer(champ: Champ) {
  champ.setAttribute("data-invalide", "");
  const effacer = () => {
    champ.removeAttribute("data-invalide");
    champ.removeEventListener("input", effacer);
    champ.removeEventListener("change", effacer);
  };
  champ.addEventListener("input", effacer);
  champ.addEventListener("change", effacer);
}

function verifier(form: HTMLFormElement): string | null {
  const champs = Array.from(form.querySelectorAll<Champ>("input, select, textarea")).filter(
    (c) => !c.disabled && c.type !== "hidden" && c.type !== "submit" && c.type !== "button",
  );

  const manquants: Champ[] = [];
  for (const c of champs) {
    if (!c.hasAttribute("data-requis")) continue;
    const vide = c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio")
      ? !c.checked
      : c instanceof HTMLInputElement && c.type === "file"
      ? !c.files?.length
      : !String(c.value ?? "").trim();
    if (vide) manquants.push(c);
  }
  if (manquants.length > 0) {
    manquants.forEach(marquer);
    manquants[0].focus();
    const noms = [...new Set(manquants.map(nomDuChamp))];
    return `Veuillez remplir : ${noms.join(", ")}.`;
  }

  for (const c of champs) {
    if (!(c instanceof HTMLInputElement) || !c.value.trim()) continue;
    if (c.type === "number") {
      const valeur = Number(c.value);
      if (Number.isNaN(valeur)) {
        marquer(c); c.focus();
        return `${nomDuChamp(c)} : saisissez un nombre.`;
      }
      if (c.min !== "" && valeur < Number(c.min)) {
        marquer(c); c.focus();
        return `${nomDuChamp(c)} : minimum ${c.min}.`;
      }
      if (c.max !== "" && valeur > Number(c.max)) {
        marquer(c); c.focus();
        return `${nomDuChamp(c)} : maximum ${c.max}.`;
      }
    }
    if (c.type === "email" && !EMAIL.test(c.value.trim())) {
      marquer(c); c.focus();
      return `${nomDuChamp(c)} : adresse e-mail invalide.`;
    }
  }
  return null;
}

/** À appeler une fois au démarrage (main.tsx). Écoute en phase de capture sur `window` : le
 * contrôle passe AVANT le `onSubmit` React de la page, qui n'est pas appelé si un champ est faux. */
export function installerValidationFormulaires() {
  window.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const erreur = verifier(form);
      if (erreur) {
        event.preventDefault();
        event.stopPropagation();
        emitToast("error", erreur);
      }
    },
    true,
  );
}
