import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button, Modal, Input } from "../components/ui";

/**
 * Remplace les popups natives du navigateur (`window.confirm`/`window.prompt`) par de vraies
 * modales de l'app — mêmes composants (`Modal`, `Button`) que partout ailleurs, contrairement
 * aux popups système, dont l'apparence ne peut pas être adaptée au design de l'application (et
 * qui bloquent le thread JS pendant leur affichage). Usage identique à l'ancien `confirm()`/
 * `prompt()`, à un `await` près : `if (!(await confirmer("Supprimer ?"))) return;`.
 */

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Bouton de confirmation en rouge — pour une action destructrice (suppression...). */
  danger?: boolean;
}

interface PromptOptions {
  title?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;
type PromptFn = (message: string, options?: PromptOptions) => Promise<string | null>;

interface DialogContextValue {
  confirm: ConfirmFn;
  prompt: PromptFn;
}

const DialogContext = createContext<DialogContextValue | null>(null);

type EtatConfirm = { kind: "confirm"; message: string; options: ConfirmOptions };
type EtatPrompt = { kind: "prompt"; message: string; options: PromptOptions };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<EtatConfirm | EtatPrompt | null>(null);
  const [valeurSaisie, setValeurSaisie] = useState("");
  const resolveConfirm = useRef<(v: boolean) => void>();
  const resolvePrompt = useRef<(v: string | null) => void>();

  const confirm = useCallback<ConfirmFn>((message, options = {}) => {
    setEtat({ kind: "confirm", message, options });
    return new Promise((resolve) => { resolveConfirm.current = resolve; });
  }, []);

  const prompt = useCallback<PromptFn>((message, options = {}) => {
    setValeurSaisie("");
    setEtat({ kind: "prompt", message, options });
    return new Promise((resolve) => { resolvePrompt.current = resolve; });
  }, []);

  const fermerConfirm = (resultat: boolean) => {
    setEtat(null);
    resolveConfirm.current?.(resultat);
  };

  const fermerPrompt = (resultat: string | null) => {
    setEtat(null);
    resolvePrompt.current?.(resultat);
  };

  const handleSubmitPrompt = (e: FormEvent) => {
    e.preventDefault();
    if (etat?.kind === "prompt" && etat.options.required && !valeurSaisie.trim()) return;
    fermerPrompt(valeurSaisie);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}

      <Modal open={etat?.kind === "confirm"} onClose={() => fermerConfirm(false)} title={etat?.options.title || "Confirmation"}>
        {etat?.kind === "confirm" && (
          <div className="space-y-5">
            <p className="text-sm text-slate-600 whitespace-pre-line">{etat.message}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => fermerConfirm(false)}>
                {etat.options.cancelLabel || "Annuler"}
              </Button>
              <Button type="button" variant={etat.options.danger ? "danger" : "primary"} onClick={() => fermerConfirm(true)}>
                {etat.options.confirmLabel || "Confirmer"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={etat?.kind === "prompt"} onClose={() => fermerPrompt(null)} title={etat?.options.title || "Saisie"}>
        {etat?.kind === "prompt" && (
          <form onSubmit={handleSubmitPrompt} className="space-y-5">
            <p className="text-sm text-slate-600 whitespace-pre-line">{etat.message}</p>
            <Input
              label={etat.options.label}
              placeholder={etat.options.placeholder}
              value={valeurSaisie}
              onChange={(e) => setValeurSaisie(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => fermerPrompt(null)}>
                {etat.options.cancelLabel || "Annuler"}
              </Button>
              <Button type="submit">{etat.options.confirmLabel || "Valider"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </DialogContext.Provider>
  );
}

function useDialogContext() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useConfirm/usePrompt doivent être utilisés à l'intérieur d'un ConfirmProvider");
  return ctx;
}

/** `const confirmer = useConfirm(); if (!(await confirmer("Supprimer ?"))) return;` */
export function useConfirm(): ConfirmFn {
  return useDialogContext().confirm;
}

/** `const demander = usePrompt(); const motif = await demander("Motif ?");` — `null` si annulé. */
export function usePrompt(): PromptFn {
  return useDialogContext().prompt;
}
