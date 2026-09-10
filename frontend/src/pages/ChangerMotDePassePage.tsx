import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { authApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, Input } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

/** Écran plein cadre, imposé après une connexion avec un mot de passe temporaire (compte
 * fraîchement créé ou réinitialisé par un administrateur) — voir ProtectedRoute dans
 * components/Layout.tsx, qui redirige ici tant que `user.doit_changer_mot_de_passe` est vrai. */
export default function ChangerMotDePassePage() {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      await refreshUser();
      toast.success("Mot de passe défini avec succès. Bienvenue !");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 gradient-surface relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-accent-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-brand-400/30 blur-3xl" />

      <div className="relative w-full max-w-md bg-white/95 backdrop-blur rounded-2xl2 shadow-2xl overflow-hidden p-8 sm:p-10">
        <div className="h-14 w-14 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center text-2xl mb-5">
          🔒
        </div>
        <h2 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-1">Choisissez votre mot de passe</h2>
        <p className="text-slate-500 text-sm mb-6">
          Bonjour {user?.full_name || user?.username}. Pour la sécurité de votre compte, vous devez
          définir votre propre mot de passe avant de continuer.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Mot de passe actuel (temporaire)" type="password" required
            value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoFocus
          />
          <Input
            label="Nouveau mot de passe" type="password" required
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            label="Confirmer le nouveau mot de passe" type="password" required
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Enregistrement…" : "Définir mon mot de passe"}
          </Button>
          <button
            type="button"
            onClick={logout}
            className="block w-full text-center text-sm font-semibold text-slate-400 hover:text-slate-600"
          >
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );
}
