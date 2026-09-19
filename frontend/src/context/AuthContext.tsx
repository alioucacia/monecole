import axios from "axios";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { authApi } from "../api/services";
import { tokenStorage } from "../api/client";
import type { User } from "../types";

const RETOUR_KEY = "support_retour_tokens";
/** Dernier profil utilisateur connu, mis en cache à chaque `/auth/me/` réussi — permet de rester
 * connecté hors-ligne au rechargement de l'app (voir refreshUser ci-dessous) plutôt que de
 * dépendre d'un appel réseau qui échouera systématiquement sans connexion. */
const CACHED_USER_KEY = "ecole_cached_user";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  /** Termine une connexion 2FA (voir LoginPage) une fois le code OTP confirmé — même effet que
   * login(), mais à partir d'un access/refresh déjà émis par /auth/verifier-otp-connexion/. */
  completeLogin: (access: string, refresh: string, targetUser: User, remember?: boolean) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  /** Bascule la session sur un autre compte (mode support) en gardant le moyen d'y revenir. */
  impersonate: (access: string, refresh: string, targetUser: User) => void;
  /** true si la session actuelle est un mode support lancé par le Super Admin. */
  enModeSupport: boolean;
  /** Restaure la session Super Admin d'origine après un passage en mode support. */
  quitterModeSupport: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [enModeSupport, setEnModeSupport] = useState(() => !!sessionStorage.getItem(RETOUR_KEY));

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await authApi.me();
      setUser(data);
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data));
    } catch (err) {
      // Aucune réponse du tout = hors-ligne (ou serveur injoignable), pas un jeton invalide : le
      // déconnecter ferait perdre l'accès à toute l'app hors-ligne (coquille + données en cache)
      // pour un simple défaut de réseau. On garde les jetons et on retombe sur le dernier profil
      // connu ; un vrai jeton invalide (401) est de toute façon déjà géré par l'intercepteur
      // d'`api/client.ts` (rafraîchissement, puis déconnexion + redirection si ça échoue aussi).
      if (axios.isAxiosError(err) && !err.response) {
        const cache = localStorage.getItem(CACHED_USER_KEY);
        if (cache) {
          try {
            setUser(JSON.parse(cache) as User);
            return;
          } catch {
            // Cache corrompu — retombe sur la déconnexion ci-dessous.
          }
        }
        return;
      }
      setUser(null);
      tokenStorage.clear();
      localStorage.removeItem(CACHED_USER_KEY);
    }
  }, []);

  useEffect(() => {
    const token = tokenStorage.getAccess();
    if (!token) {
      setLoading(false);
      return;
    }
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string, remember = true) => {
    const { data } = await authApi.login(username, password);
    tokenStorage.set(data.access, data.refresh, remember);
    setUser(data.user);
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
  }, []);

  const completeLogin = useCallback((access: string, refresh: string, targetUser: User, remember = true) => {
    tokenStorage.set(access, refresh, remember);
    setUser(targetUser);
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(targetUser));
  }, []);

  const logout = useCallback(() => {
    tokenStorage.clear();
    sessionStorage.removeItem(RETOUR_KEY);
    localStorage.removeItem(CACHED_USER_KEY);
    setEnModeSupport(false);
    setUser(null);
  }, []);

  const impersonate = useCallback((access: string, refresh: string, targetUser: User) => {
    // Conserve les jetons Super Admin actuels pour pouvoir y revenir depuis le mode support.
    const access0 = tokenStorage.getAccess();
    const refresh0 = tokenStorage.getRefresh();
    if (access0 && refresh0) {
      sessionStorage.setItem(RETOUR_KEY, JSON.stringify({ access: access0, refresh: refresh0 }));
    }
    tokenStorage.set(access, refresh);
    setEnModeSupport(true);
    setUser(targetUser);
  }, []);

  const quitterModeSupport = useCallback(async () => {
    const sauvegarde = sessionStorage.getItem(RETOUR_KEY);
    if (!sauvegarde) return;
    const { access, refresh } = JSON.parse(sauvegarde) as { access: string; refresh: string };
    sessionStorage.removeItem(RETOUR_KEY);
    tokenStorage.set(access, refresh);
    setEnModeSupport(false);
    await refreshUser();
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, loading, login, completeLogin, logout, refreshUser, impersonate, enModeSupport, quitterModeSupport }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur d'un AuthProvider");
  return ctx;
}
