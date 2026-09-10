import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { authApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, Input } from "../components/ui";
import { useToast } from "../context/ToastContext";

export default function ForgotPasswordPage() {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      toast.error(extractErrorMessage(err) || "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/30 blur-3xl" />

      <div className="relative w-full max-w-md bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden p-8 sm:p-10">
        <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Mot de passe oublié</h2>
        <p className="text-slate-500 text-sm mb-6">
          Indiquez votre adresse e-mail : si un compte y est associé, un lien de réinitialisation vous sera envoyé.
        </p>

        {sent ? (
          <div className="space-y-5">
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5">
              Si un compte existe avec cet e-mail, un lien de réinitialisation vient d'être envoyé. Pensez à
              vérifier vos courriers indésirables.
            </p>
            <Link to="/login" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
              ← Retour à la connexion
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Adresse e-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Envoi…" : "Envoyer le lien de réinitialisation"}
            </Button>
            <Link
              to="/login"
              className="block text-center text-sm font-semibold text-slate-500 hover:text-brand-700"
            >
              ← Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
