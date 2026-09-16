import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import axios from "axios";

import { extractErrorMessage } from "../api/client";
import { authApi, plateformeBrandingApi } from "../api/services";
import { Button, Input, OtpBoxInput } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useCooldown } from "../hooks/useCooldown";

// const DEMO_ACCOUNTS = [
//   { role: "Admin", username: "admin", password: "admin123" },
//   { role: "Enseignant", username: "enseignant1", password: "enseignant123" },
//   { role: "Élève", username: "eleve1", password: "eleve123" },
//   { role: "Parent", username: "parent1", password: "parent123" },
// ];

/** Illustration vectorielle d'une école, utilisée en décor sur la page de connexion. */
function SchoolIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      {/* Sol */}
      <ellipse cx="100" cy="148" rx="90" ry="8" fill="white" fillOpacity="0.08" />

      {/* Buissons */}
      <circle cx="28" cy="140" r="10" fill="#2dd4bf" fillOpacity="0.55" />
      <circle cx="40" cy="144" r="7" fill="#2dd4bf" fillOpacity="0.45" />
      <circle cx="172" cy="140" r="10" fill="#2dd4bf" fillOpacity="0.55" />
      <circle cx="160" cy="144" r="7" fill="#2dd4bf" fillOpacity="0.45" />

      {/* Marches */}
      <rect x="70" y="142" width="60" height="5" rx="1.5" fill="white" fillOpacity="0.5" />
      <rect x="75" y="147" width="50" height="5" rx="1.5" fill="white" fillOpacity="0.35" />

      {/* Corps du bâtiment */}
      <rect x="35" y="70" width="130" height="72" rx="4" fill="white" fillOpacity="0.95" />

      {/* Toit */}
      <polygon points="100,30 20,75 180,75" fill="#5eead4" />
      <rect x="18" y="72" width="164" height="8" rx="2" fill="#2dd4bf" />

      {/* Fronton / horloge */}
      <circle cx="100" cy="55" r="10" fill="#ede9fe" stroke="#7c3aed" strokeWidth="2" />
      <line x1="100" y1="55" x2="100" y2="49" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <line x1="100" y1="55" x2="104" y2="57" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />

      {/* Drapeau */}
      <line x1="165" y1="20" x2="165" y2="72" stroke="white" strokeOpacity="0.6" strokeWidth="2" />
      <path d="M165 20 L185 26 L165 32 Z" fill="#fb7185" />

      {/* Fenêtres */}
      <rect x="46" y="86" width="16" height="16" rx="2" fill="#ddd6fe" />
      <rect x="68" y="86" width="16" height="16" rx="2" fill="#ddd6fe" />
      <rect x="46" y="110" width="16" height="16" rx="2" fill="#ddd6fe" />
      <rect x="68" y="110" width="16" height="16" rx="2" fill="#ddd6fe" />
      <rect x="116" y="86" width="16" height="16" rx="2" fill="#ddd6fe" />
      <rect x="138" y="86" width="16" height="16" rx="2" fill="#ddd6fe" />
      <rect x="116" y="110" width="16" height="16" rx="2" fill="#ddd6fe" />
      <rect x="138" y="110" width="16" height="16" rx="2" fill="#ddd6fe" />

      {/* Porte */}
      <rect x="90" y="108" width="20" height="34" rx="2" fill="#a78bfa" />
      <circle cx="106" cy="125" r="1.5" fill="#4c1d95" />
    </svg>
  );
}

export default function LoginPage() {
  const { user, login, completeLogin } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [shake, setShake] = useState(false);
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  // Double authentification (voir User.otp_actif côté backend) : le mot de passe a déjà été
  // vérifié (login() a répondu code="otp_requis", pas une erreur d'identifiants) — il ne reste
  // qu'à saisir le code reçu par e-mail/SMS pour obtenir le vrai accès.
  const [otpRequis, setOtpRequis] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  // Renvoi du code — délai aligné sur DELAI_MIN_RENVOI_SECONDES côté backend (accounts/services.py) :
  // en dessous, generer_otp() ne fait rien de plus (le code déjà envoyé est encore valable), ce
  // ne serait donc pas un vrai renvoi. `relancer()` est appelé au premier envoi (dans handleSubmit)
  // et à chaque renvoi manuel (handleResendOtp).
  const cooldownOtp = useCooldown(60);
  const [nomPlateforme, setNomPlateforme] = useState("Taly-School");
  const [logoPlateforme, setLogoPlateforme] = useState<string | null>(null);
  // `undefined` tant que la réponse de plateformeBrandingApi n'est pas encore arrivée — on évite
  // ainsi d'afficher une fraction de seconde le formulaire de connexion avant de basculer sur
  // l'écran de maintenance (ou l'inverse), le temps que l'appel réseau aboutisse.
  const [maintenance, setMaintenance] = useState<{ active: boolean; message: string } | undefined>(undefined);
  // Le Super Admin reste autorisé à se connecter pendant la maintenance (déjà géré côté serveur —
  // voir CustomTokenObtainPairSerializer.validate/PlateformeJWTAuthentication) : ce lien discret
  // lui permet d'atteindre le formulaire malgré l'écran de maintenance qui le masque par défaut
  // pour tout le monde. Un identifiant/mot de passe qui ne sont PAS ceux d'un Super Admin restent
  // bloqués par le serveur, avec le même message de maintenance affiché en erreur.
  const [formuleForcee, setFormuleForcee] = useState(false);

  useEffect(() => {
    plateformeBrandingApi.get().then(({ data }) => {
      if (data.nom_plateforme) setNomPlateforme(data.nom_plateforme);
      setLogoPlateforme(data.logo);
      setMaintenance({ active: data.maintenance_active, message: data.maintenance_message });
    }).catch(() => setMaintenance({ active: false, message: "" }));
  }, []);

  // Dès que les 6 chiffres du code OTP sont saisis, on le vérifie automatiquement — sans
  // attendre un clic sur « Confirmer » — pour que la connexion (et la redirection vers "/" via
  // `if (user) return <Navigate />` juste en dessous) se déclenche immédiatement une fois le
  // code valide. CRITIQUE : ce hook doit rester ICI, avant les `return` conditionnels
  // ci-dessous — placé après (comme précédemment), il n'était plus appelé du tout dès que
  // `user` devenait vrai (retour anticipé), ce qui violait les Règles des Hooks ("Rendered
  // fewer hooks than expected") et plantait le composant juste après une connexion réussie —
  // exactement le bug qui empêchait d'accéder à l'application après authentification.
  useEffect(() => {
    if (otpRequis && otpCode.trim().length === 6 && !loading) {
      submitOtp(otpCode.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpCode, otpRequis]);

  if (user) return <Navigate to="/" replace />;

  if (maintenance?.active && !formuleForcee) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 gradient-surface relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/30 blur-3xl" />

        <div className="relative flex flex-col items-center text-center max-w-sm">
          <div className="h-16 w-16 rounded-2xl bg-white/10 flex items-center justify-center text-3xl mb-6 ring-1 ring-white/20 overflow-hidden backdrop-blur">
            {logoPlateforme ? <img src={logoPlateforme} alt="" className="h-full w-full object-cover" /> : "🏫"}
          </div>

          <div className="h-14 w-14 animate-spin rounded-full border-4 border-white/25 border-t-white" />

          {/* Popup (bulle) sous le spinner, avec sa petite pointe vers le haut. */}
          <div className="relative mt-7 bg-white rounded-2xl shadow-2xl px-6 py-5 animate-pop-in">
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 h-4 w-4 rotate-45 bg-white" />
            <p className="relative font-extrabold text-ink-900 mb-1.5">🛠️ {nomPlateforme} est en maintenance</p>
            <p className="relative text-sm text-slate-500 leading-relaxed">
              {maintenance.message || "Nous effectuons une mise à jour. Merci de réessayer dans quelques instants."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setFormuleForcee(true)}
            className="mt-6 text-xs text-white/50 hover:text-white/80 hover:underline transition"
          >
            Connexion Super Administrateur
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");

    // Validation des champs obligatoires faite ici, en JS — volontairement PAS via l'attribut
    // HTML `required` (infobulle native du navigateur, pas de contrôle sur son apparence ni son
    // placement) : `.trim()` rejette aussi un champ qui ne contient que des espaces, que
    // `required` laisse passer tel quel. Le message s'affiche en bas du formulaire, comme les
    // erreurs de connexion elles-mêmes ci-dessous.
    const usernameTrim = username.trim();
    const passwordTrim = password.trim();
    if (!usernameTrim || !passwordTrim) {
      setFormError(
        !usernameTrim && !passwordTrim
          ? "Veuillez renseigner votre nom d'utilisateur et votre mot de passe."
          : !usernameTrim
          ? "Veuillez renseigner votre nom d'utilisateur, e-mail ou téléphone."
          : "Veuillez renseigner votre mot de passe."
      );
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    setLoading(true);
    try {
      await login(username, password, rememberMe);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data && (err.response.data as { code?: string }).code === "otp_requis") {
        setOtpRequis(true);
        setFormError("");
        setLoading(false);
        cooldownOtp.relancer();
        return;
      }
      setFormError(extractErrorMessage(err) || "Identifiants incorrects.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (code: string) => {
    setFormError("");
    if (code.length !== 6) {
      setFormError("Le code comporte 6 chiffres.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    setLoading(true);
    try {
      const { data } = await authApi.verifierOtpConnexion(username, code);
      // La redirection vers l'espace de l'utilisateur se fait ensuite automatiquement, sans
      // action supplémentaire : `completeLogin` met à jour `user` dans le contexte, ce qui fait
      // passer `if (user) return <Navigate .../>` en tête de ce composant au rendu suivant.
      completeLogin(data.access, data.refresh, data.user, rememberMe);
    } catch (err) {
      setFormError(extractErrorMessage(err) || "Code invalide ou expiré.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitOtp = (e: FormEvent) => {
    e.preventDefault();
    submitOtp(otpCode.trim());
  };

  const handleResendOtp = async () => {
    if (!cooldownOtp.pret) return;
    cooldownOtp.relancer();
    setFormError("");
    setOtpCode("");
    try {
      // Redéclenche l'envoi d'un code (login() renvoie toujours code="otp_requis" tant que le
      // 2FA reste actif — voir CustomTokenObtainPairSerializer.validate) ; le cas où il aurait
      // été désactivé entre-temps est couvert en terminant directement la connexion.
      const { data } = await authApi.login(username, password);
      completeLogin(data.access, data.refresh, data.user, rememberMe);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data && (err.response.data as { code?: string }).code === "otp_requis") {
        return;
      }
      setFormError(extractErrorMessage(err) || "Impossible de renvoyer le code.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface relative overflow-hidden">
      {/* Décor : formes floutées en arrière-plan */}
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/30 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-3xl" />

      <div className="relative w-full max-w-4xl grid md:grid-cols-2 bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden">
        <div className="hidden md:flex flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-800 to-ink-950 text-white p-10 relative overflow-hidden">
          <SchoolIllustration className="pointer-events-none absolute -right-10 -bottom-6 h-56 w-56 opacity-90" />

          <div className="relative">
            <div className="h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl mb-5 ring-1 ring-white/20 overflow-hidden">
              {logoPlateforme ? <img src={logoPlateforme} alt="" className="h-full w-full object-cover" /> : "🏫"}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">{nomPlateforme}</h1>
            <p className="mt-3 text-brand-100/90 leading-relaxed">
              Toute la vie de votre établissement au même endroit : inscriptions, notes et bulletins, présences,
              emploi du temps, paiements et communication avec les familles.
            </p>
          </div>

          {/* <div className="relative space-y-2 text-sm">
            <p className="font-bold text-white/90 uppercase tracking-wide text-xs">Comptes de démonstration</p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <div key={acc.username} className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-1.5">
                  <span className="text-brand-100">{acc.role}</span>
                  <span className="font-mono text-xs text-white">{acc.username} / {acc.password}</span>
                </div>
              ))}
            </div>
          </div> */}
        </div>

        <div className="p-8 sm:p-10 flex flex-col justify-center">
          {otpRequis ? (
            <>
              <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1 text-center">Vérification</h2>
              <p className="text-slate-500 text-sm mb-6 text-center">
                Un code à 6 chiffres a été envoyé par e-mail/SMS au compte « {username} ». Saisissez-le ci-dessous.
              </p>
              <form onSubmit={handleSubmitOtp} className={`space-y-5 ${shake ? "animate-shake" : ""}`}>
                <OtpBoxInput
                  value={otpCode}
                  onChange={(v) => { setOtpCode(v); if (formError) setFormError(""); }}
                  autoFocus
                  disabled={loading}
                />
                <Button type="submit" className="w-full" disabled={loading || otpCode.length !== 6}>
                  {loading ? "Vérification…" : "Confirmer"}
                </Button>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={!cooldownOtp.pret}
                  className="block w-full text-center text-sm font-semibold text-brand-700 hover:text-brand-800 disabled:text-slate-400 disabled:hover:text-slate-400 disabled:cursor-not-allowed"
                >
                  {cooldownOtp.pret ? "Renvoyer le code" : `Renvoyer le code dans ${cooldownOtp.restant}s`}
                </button>
                <button
                  type="button"
                  onClick={() => { setOtpRequis(false); setOtpCode(""); setFormError(""); }}
                  className="block w-full text-center text-sm font-semibold text-slate-500 hover:text-brand-700"
                >
                  ← Revenir à la connexion
                </button>
                {formError && (
                  <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 text-center">
                    {formError}
                  </p>
                )}
              </form>
            </>
          ) : (
            <>
          <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Connexion</h2>
          <p className="text-slate-500 text-sm mb-6">Connectez-vous pour accéder à votre espace.</p>

          <form onSubmit={handleSubmit} className={`space-y-4 ${shake ? "animate-shake" : ""}`}>
            <Input
              label="Nom d'utilisateur, e-mail ou téléphone"
              placeholder="Nom d'utilisateur, e-mail ou téléphone"
              value={username}
              onChange={(e) => { setUsername(e.target.value); if (formError) setFormError(""); }}
              autoFocus
            />
            <Input
              label="Mot de passe"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (formError) setFormError(""); }}
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                />
                Se souvenir de moi
              </label>
              <Link to="/mot-de-passe-oublie" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
                Mot de passe oublié ?
              </Link>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Connexion…" : "Se connecter"}
            </Button>

            {/* Message d'erreur en bas du formulaire — champ obligatoire manquant ou échec de
                connexion, calculés dynamiquement dans handleSubmit (pas l'attribut HTML
                `required`, dont l'infobulle native n'est ni stylable ni repositionnable). */}
            {formError && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 text-center">
                {formError}
              </p>
            )}
          </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
