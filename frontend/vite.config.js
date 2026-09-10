import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["pwa-192.png", "pwa-512.png"],
            manifest: {
                name: "École Manager",
                short_name: "École Manager",
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
                    { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
                ],
            },
            workbox: {
                // Coquille de l'application (JS/CSS/HTML) mise en cache pour un chargement hors-ligne ;
                // les appels API restent en "network first" pour ne jamais servir des données périmées
                // par erreur, avec repli sur le cache si le réseau est indisponible.
                navigateFallback: "/index.html",
                runtimeCaching: [
                    {
                        urlPattern: function (_a) {
                            var url = _a.url;
                            return url.pathname.startsWith("/api/");
                        },
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "api-cache",
                            networkTimeoutSeconds: 6,
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
