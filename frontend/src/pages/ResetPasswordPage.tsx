import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { authApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, Input } from "../components/ui";
import { useToast } from "../context/ToastContext";

export default function ResetPasswordPage() {
  const toast = useToast();
  const { uid, token } = useParams<{ uid: string; token: string }>();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!uid || !token) {
      toast.error("Lien de réinitialisation invalide.");
      return;
    }

    setLoading(true);
    try {
      await authApi.confirmPasswordReset(uid, token, newPassword);
      setDone(true);
      toast.success("Mot de passe réinitialisé avec succès.");
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      toast.error(extractErrorMessage(err) || "Ce lien est invalide ou a expiré.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/30 blur-3xl" />

      <div className="relative w-full max-w-md bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden p-8 sm:p-10">
        <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Nouveau mot de passe</h2>
        <p className="text-slate-500 text-sm mb-6">Choisissez un nouveau mot de passe pour votre compte.</p>

        {done ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5">
            Mot de passe réinitialisé avec succès. Redirection vers la connexion…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nouveau mot de passe"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus
            />
            <Input
              label="Confirmer le mot de passe"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Enregistrement…" : "Réinitialiser le mot de passe"}
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
