import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { authApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, Input, OtpBoxInput } from "../components/ui";
import { useToast } from "../context/ToastContext";

type Etape = "email" | "code" | "mot_de_passe" | "termine";

export default function ForgotPasswordPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [etape, setEtape] = useState<Etape>("email");

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  // Étape "code" — seule sur son propre écran, en carreaux : le formulaire de mot de passe
  // n'apparaît qu'une fois ce code confirmé (voir PasswordResetOtpVerifyView côté backend, qui
  // renvoie un `reset_ticket` de courte durée porté jusqu'à l'étape suivante).
  const [otpCode, setOtpCode] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [resetTicket, setResetTicket] = useState("");

  // Étape "mot_de_passe" — n'apparaît qu'après un code confirmé.
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState("");

  const handleSubmitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.requestPasswordReset(email);
      setEtape("code");
    } catch (err) {
      toast.error(extractErrorMessage(err) || "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (code: string) => {
    setOtpError("");
    setOtpLoading(true);
    try {
      const { data } = await authApi.verifyPasswordResetOtp(email, code);
      setResetTicket(data.reset_ticket);
      setEtape("mot_de_passe");
    } catch (err) {
      setOtpError(extractErrorMessage(err) || "Code invalide ou expiré.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSubmitCode = (e: FormEvent) => {
    e.preventDefault();
    submitCode(otpCode);
  };

  // Vérification automatique dès les 6 chiffres saisis — passe à l'étape suivante sans attendre
  // un clic sur « Vérifier le code », même logique que la double authentification à la connexion.
  useEffect(() => {
    if (etape === "code" && otpCode.length === 6 && !otpLoading) {
      submitCode(otpCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpCode, etape]);

  const handleSubmitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwdError("");
    if (newPassword !== confirmPassword) {
      setPwdError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setPwdLoading(true);
    try {
      await authApi.completePasswordResetOtp(resetTicket, newPassword);
      setEtape("termine");
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setPwdError(extractErrorMessage(err) || "Une erreur est survenue — recommencez depuis le code reçu.");
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/30 blur-3xl" />

      <div className="relative w-full max-w-md bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden p-8 sm:p-10">
        {etape === "email" && (
          <>
            <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Mot de passe oublié</h2>
            <p className="text-slate-500 text-sm mb-6">
              Indiquez votre adresse e-mail : si un compte y est associé, un lien ET un code de réinitialisation vous seront envoyés.
            </p>
            <form onSubmit={handleSubmitEmail} className="space-y-4">
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
              <Link to="/login" className="block text-center text-sm font-semibold text-slate-500 hover:text-brand-700">
                ← Retour à la connexion
              </Link>
            </form>
          </>
        )}

        {etape === "code" && (
          <>
            <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1 text-center">Code de vérification</h2>
            <p className="text-slate-500 text-sm mb-6 text-center">
              Saisissez le code à 6 chiffres envoyé à {email} (ou suivez le lien reçu par e-mail).
            </p>
            <form onSubmit={handleSubmitCode} className="space-y-5">
              <OtpBoxInput value={otpCode} onChange={setOtpCode} autoFocus disabled={otpLoading} />
              <Button type="submit" className="w-full" disabled={otpLoading || otpCode.length !== 6}>
                {otpLoading ? "Vérification…" : "Vérifier le code"}
              </Button>
              {otpError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 text-center">
                  {otpError}
                </p>
              )}
              <button
                type="button"
                onClick={() => { setEtape("email"); setOtpCode(""); setOtpError(""); }}
                className="block w-full text-center text-sm font-semibold text-slate-500 hover:text-brand-700"
              >
                ← Renvoyer à une autre adresse
              </button>
            </form>
          </>
        )}

        {etape === "mot_de_passe" && (
          <>
            <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Nouveau mot de passe</h2>
            <p className="text-slate-500 text-sm mb-6">Code confirmé — choisissez votre nouveau mot de passe.</p>
            <form onSubmit={handleSubmitPassword} className="space-y-4">
              <Input
                label="Nouveau mot de passe" type="password" required autoFocus
                value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setPwdError(""); }}
              />
              <Input
                label="Confirmer le mot de passe" type="password" required
                value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setPwdError(""); }}
              />
              <Button type="submit" className="w-full" disabled={pwdLoading}>
                {pwdLoading ? "Enregistrement…" : "Réinitialiser le mot de passe"}
              </Button>
              {pwdError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 text-center">
                  {pwdError}
                </p>
              )}
            </form>
          </>
        )}

        {etape === "termine" && (
          <>
            <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Nouveau mot de passe</h2>
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5 mt-4">
              Mot de passe réinitialisé avec succès. Redirection vers la connexion…
            </p>
          </>
        )}
      </div>
    </div>
  );
}
