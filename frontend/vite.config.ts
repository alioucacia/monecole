import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-192.png", "pwa-512.png", "pwa-512-maskable.png"],
      manifest: {
        name: "Taly-School",
        short_name: "Taly-School",
        description: "Gestion scolaire complète — élèves, notes, présences, paiements.",
        lang: "fr",
        theme_color: "#6d28d9",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Coquille de l'application (JS/CSS/HTML) mise en cache pour un chargement hors-ligne ;
        // les appels API restent en "network first" pour ne jamais servir des données périmées
        // par erreur, avec repli sur le cache si le réseau est indisponible.
        // Pas de `networkTimeoutSeconds` : avec un délai (6 s auparavant), toute réponse plus
        // lente — la Caisse sur une semaine, un mois ou une année, une connexion lente — était
        // abandonnée au profit du cache ; sans entrée en cache pour ces paramètres, la requête
        // échouait sans réponse (« Connexion impossible »). Le cache ne sert plus qu'en cas
        // d'échec réel du réseau (hors-ligne).
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
  },
});
