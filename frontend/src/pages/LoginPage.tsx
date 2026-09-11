import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";

import { extractErrorMessage } from "../api/client";
import { plateformeBrandingApi } from "../api/services";
import { Button, Input } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

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
  const { user, login } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nomPlateforme, setNomPlateforme] = useState("Taly-School");

  useEffect(() => {
    plateformeBrandingApi.get().then(({ data }) => {
      if (data.nom_plateforme) setNomPlateforme(data.nom_plateforme);
    }).catch(() => {});
  }, []);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password, rememberMe);
    } catch (err) {
      toast.error(extractErrorMessage(err) || "Identifiants incorrects.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
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
            <div className="h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl mb-5 ring-1 ring-white/20">
              🏫
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
          <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Connexion</h2>
          <p className="text-slate-500 text-sm mb-6">Connectez-vous pour accéder à votre espace.</p>

          <form onSubmit={handleSubmit} className={`space-y-4 ${shake ? "animate-shake" : ""}`}>
            <Input
              label="Nom d'utilisateur, e-mail ou téléphone"
              placeholder="Nom d'utilisateur, e-mail ou téléphone"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <Input label="Mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
          </form>
        </div>
      </div>
    </div>
  );
}
