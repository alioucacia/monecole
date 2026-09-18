import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { authApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, Input } from "../components/ui";
import { useToast } from "../context/ToastContext";

export default function ForgotPasswordPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  // Saisie directe du code reçu (voir PasswordResetRequestView côté backend, qui envoie
  // maintenant un lien ET un code) — évite de dépendre du lien cliquable, qui peut ne pas
  // aboutir (client mail/navigateur le basculant en HTTPS avant que le site ne soit servi en
  // HTTPS, voir backend/DEPLOYMENT.md) : on reste directement dans l'app.
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpDone, setOtpDone] = useState(false);
  const [otpError, setOtpError] = useState("");

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

  const handleSubmitOtp = async (e: FormEvent) => {
    e.preventDefault();
    setOtpError("");
    if (newPassword !== confirmPassword) {
      setOtpError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setOtpLoading(true);
    try {
      await authApi.confirmPasswordResetOtp(email, otpCode.trim(), newPassword);
      setOtpDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setOtpError(extractErrorMessage(err) || "Code invalide ou expiré.");
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/30 blur-3xl" />

      <div className="relative w-full max-w-md bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden p-8 sm:p-10">
        <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Mot de passe oublié</h2>
        <p className="text-slate-500 text-sm mb-6">
          Indiquez votre adresse e-mail : si un compte y est associé, un lien ET un code de réinitialisation vous seront envoyés.
        </p>

        {sent ? (
          otpDone ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5">
              Mot de passe réinitialisé avec succès. Redirection vers la connexion…
            </p>
          ) : (
            <div className="space-y-5">
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5">
                Si un compte existe avec cet e-mail, un lien ET un code à 6 chiffres viennent d'être envoyés. Cliquez
                sur le lien, ou saisissez directement le code ci-dessous.
              </p>

              <form onSubmit={handleSubmitOtp} className="space-y-4 border-t border-slate-100 pt-5">
                <p className="text-sm font-semibold text-slate-700">Saisir le code reçu</p>
                <Input
                  label="Code à 6 chiffres" placeholder="123456" inputMode="numeric" maxLength={6}
                  value={otpCode} onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "")); setOtpError(""); }}
                />
                <Input
                  label="Nouveau mot de passe" type="password"
                  value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setOtpError(""); }}
                />
                <Input
                  label="Confirmer le mot de passe" type="password"
                  value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setOtpError(""); }}
                />
                <Button type="submit" className="w-full" disabled={otpLoading || otpCode.length !== 6}>
                  {otpLoading ? "Enregistrement…" : "Réinitialiser avec le code"}
                </Button>
                {otpError && (
                  <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 text-center">
                    {otpError}
                  </p>
                )}
              </form>

              <Link to="/login" className="block text-center text-sm font-semibold text-slate-500 hover:text-brand-700">
                ← Retour à la connexion
              </Link>
            </div>
          )
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
              {loading ? "Envoi…" : "Envoyer le lien et le code"}
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
