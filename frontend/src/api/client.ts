import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

import { emitToast } from "../context/ToastContext";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

export const TOKEN_KEYS = {
  access: "ecole_access_token",
  refresh: "ecole_refresh_token",
};

/** Préférence "Se souvenir de moi" (case cochée à la connexion) — stockée dans `localStorage`
 * (jamais effacée à la fermeture du navigateur) pour savoir, au prochain chargement de l'app,
 * dans quel support (localStorage = persiste / sessionStorage = effacé à la fermeture) relire
 * les jetons. Rien de sensible dedans, juste ce choix. */
const REMEMBER_KEY = "ecole_remember_me";

/** localStorage si l'utilisateur a coché "Se souvenir de moi" à la connexion, sessionStorage
 * sinon (comportement par défaut avant l'ajout de cette case : toujours localStorage). */
function currentStore(): Storage {
  return localStorage.getItem(REMEMBER_KEY) === "false" ? sessionStorage : localStorage;
}

export const tokenStorage = {
  getAccess: () => currentStore().getItem(TOKEN_KEYS.access),
  getRefresh: () => currentStore().getItem(TOKEN_KEYS.refresh),
  /** `remember` n'est fourni qu'à la connexion (case à cocher) — omis lors d'un simple
   * rafraîchissement de jeton ou d'un passage en mode support, pour garder le support de
   * stockage déjà choisi plutôt que d'en changer silencieusement. */
  set: (access: string, refresh: string, remember?: boolean) => {
    if (remember !== undefined) {
      localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
      // Vide l'AUTRE support : sinon un ancien jeu de jetons pourrait y traîner et semer la confusion.
      const other = remember ? sessionStorage : localStorage;
      other.removeItem(TOKEN_KEYS.access);
      other.removeItem(TOKEN_KEYS.refresh);
    }
    const store = currentStore();
    store.setItem(TOKEN_KEYS.access, access);
    store.setItem(TOKEN_KEYS.refresh, refresh);
  },
  setAccess: (access: string) => currentStore().setItem(TOKEN_KEYS.access, access),
  setRefresh: (refresh: string) => currentStore().setItem(TOKEN_KEYS.refresh, refresh),
  clear: () => {
    localStorage.removeItem(TOKEN_KEYS.access);
    localStorage.removeItem(TOKEN_KEYS.refresh);
    sessionStorage.removeItem(TOKEN_KEYS.access);
    sessionStorage.removeItem(TOKEN_KEYS.refresh);
  },
};

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccess();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let pendingQueue: { resolve: (token: string) => void; reject: (err: unknown) => void }[] = [];

function processQueue(error: unknown, token: string | null) {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (token) resolve(token);
    else reject(error);
  });
  pendingQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    // Maintenance plateforme / établissement suspendu : le backend renvoie un 401 avec un
    // `code` dédié (voir accounts.authentication.PlateformeJWTAuthentication) — inutile (et
    // trompeur) d'essayer de rafraîchir le token dans ce cas : le refresh échouera lui aussi
    // (voir CustomTokenRefreshView), donc autant déconnecter tout de suite en affichant le
    // vrai message du serveur plutôt qu'un "session expirée" générique après un aller-retour
    // réseau pour rien. La requête de login elle-même est exclue : LoginPage affiche déjà
    // l'erreur inline via `extractErrorMessage`, pas besoin d'un toast en plus ni de déconnexion
    // (il n'y a pas encore de session à cette étape).
    const errorCode = (error.response?.data as { code?: string } | undefined)?.code;
    const isLoginRequest = originalRequest?.url?.includes("/auth/login");
    if (error.response?.status === 401 && !isLoginRequest && (errorCode === "maintenance" || errorCode === "ecole_inactive")) {
      const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
      tokenStorage.clear();
      emitToast("warning", detail || "L'accès à la plateforme est actuellement bloqué.");
      window.location.href = "/login";
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !originalRequest.url?.includes("/auth/login")) {
      const refresh = tokenStorage.getRefresh();
      if (!refresh) {
        tokenStorage.clear();
        emitToast("warning", "Votre session a expiré. Merci de vous reconnecter.");
        window.location.href = "/login";
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({
            resolve: (token: string) => {
              if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;
      try {
        const { data } = await axios.post(`${BASE_URL}/auth/refresh/`, { refresh });
        tokenStorage.setAccess(data.access);
        // SIMPLE_JWT["ROTATE_REFRESH_TOKENS"] est actif côté backend : chaque rafraîchissement
        // renvoie aussi un NOUVEAU refresh token. Avant ce correctif, on ne le stockait jamais
        // et on renvoyait indéfiniment l'ancien — ça fonctionnait encore (pas de blacklist
        // activée) mais ça plafonnait toute session "Se souvenir de moi" à exactement
        // REFRESH_TOKEN_LIFETIME (7 jours) depuis la connexion initiale, sans jamais se
        // prolonger avec l'usage. En le stockant, la session redevient glissante : elle se
        // prolonge de 7 jours à chaque rafraîchissement tant que l'utilisateur reste actif.
        if (data.refresh) tokenStorage.setRefresh(data.refresh);
        processQueue(null, data.access);
        if (originalRequest.headers) originalRequest.headers.Authorization = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        tokenStorage.clear();
        emitToast("warning", "Votre session a expiré. Merci de vous reconnecter.");
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Aucune réponse du tout (serveur injoignable, coupure réseau...) : un cas que
    // pratiquement aucune page ne gère spécifiquement, donc autant prévenir partout
    // plutôt que de laisser un formulaire échouer sans un mot d'explication.
    if (!error.response) {
      emitToast("error", "Impossible de contacter le serveur. Vérifiez votre connexion.");
    }

    return Promise.reject(error);
  }
);

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const firstKey = Object.keys(data)[0];
      const value = (data as Record<string, unknown>)[firstKey];
      if (Array.isArray(value)) return `${firstKey}: ${value[0]}`;
      if (typeof value === "string") return value;
      if (data.detail) return String(data.detail);
    }
    return error.message;
  }
  return "Une erreur inattendue est survenue.";
}

/**
 * Variante de `extractErrorMessage` pour les requêtes `responseType: "blob"` (aperçu/téléchargement
 * de PDF) : en cas d'erreur, le corps de la réponse arrive comme un `Blob` (pas du JSON déjà parsé),
 * donc `extractErrorMessage` seul afficherait un message inexploitable — on relit le blob en texte.
 */
export async function extractBlobErrorMessage(error: unknown): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const text = await error.response.data.text();
      const data = JSON.parse(text);
      const firstKey = Object.keys(data)[0];
      const value = data[firstKey];
      if (Array.isArray(value)) return `${firstKey}: ${value[0]}`;
      if (typeof value === "string") return value;
      if (data.detail) return String(data.detail);
    } catch {
      // Corps non-JSON (ex : page d'erreur HTML) — on retombe sur le message générique.
    }
  }
  return extractErrorMessage(error);
}
