/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
          950: "#2e1065",
        },
        accent: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
        ink: {
          950: "#0f0b1f",
          900: "#171227",
          800: "#241b3d",
        },
      },
      boxShadow: {
        soft: "0 2px 10px -2px rgb(124 58 237 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.06)",
        card: "0 8px 24px -8px rgb(76 29 149 / 0.12)",
        glow: "0 0 0 1px rgb(139 92 246 / 0.15), 0 8px 30px -8px rgb(139 92 246 / 0.45)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-6px)" },
          "40%, 80%": { transform: "translateX(6px)" },
        },
        "pulse-soft": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.15)", opacity: "0.85" },
        },
        "wiggle": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-8deg)" },
          "75%": { transform: "rotate(8deg)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.4s ease-out both",
        "pop-in": "pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        shake: "shake 0.4s ease-in-out",
        // Badges/pastilles de notification (nombre à relancer, cloche non lue...) — un pouls
        // discret et continu pour attirer l'œil sans être agressif comme `animate-ping`/`pulse`
        // de Tailwind (qui font disparaître complètement l'élément à chaque cycle).
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        wiggle: "wiggle 0.5s ease-in-out",
      },
    },
  },
  plugins: [],
};
