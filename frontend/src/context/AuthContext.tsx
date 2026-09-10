import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { authApi } from "../api/services";
import { tokenStorage } from "../api/client";
import type { User } from "../types";

const RETOUR_KEY = "support_retour_tokens";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
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
    } catch {
      setUser(null);
      tokenStorage.clear();
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
  }, []);

  const logout = useCallback(() => {
    tokenStorage.clear();
    sessionStorage.removeItem(RETOUR_KEY);
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
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, impersonate, enModeSupport, quitterModeSupport }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur d'un AuthProvider");
  return ctx;
}
