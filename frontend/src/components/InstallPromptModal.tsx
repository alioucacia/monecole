import { useEffect, useState } from "react";

import { useInstallPrompt } from "../pwa";
import { Button, Modal } from "./ui";

const CLE_REPORT = "pwa_install_reporte_le";
// Si l'utilisateur choisit "Plus tard", on ne le relance pas avant ce délai — évite de
// ré-afficher le popup à chaque ouverture de l'app pour quelqu'un qui a déjà dit non récemment.
const DELAI_REPORT_JOURS = 7;

function popupDejaReporteRecemment(): boolean {
  try {
    const valeur = localStorage.getItem(CLE_REPORT);
    if (!valeur) return false;
    return Date.now() - Number(valeur) < DELAI_REPORT_JOURS * 24 * 60 * 60 * 1000;
  } catch {
    return false; // stockage indisponible (navigation privée...) — tant pis, on propose à chaque fois
  }
}

/** Popup d'installation de l'application (PWA) — s'affiche quand le navigateur signale que
 * l'app est installable (voir useInstallPrompt) et que l'utilisateur ne l'a pas reportée
 * récemment. Explique aussi honnêtement les limites du mode hors-ligne : l'app n'a pas de vraie
 * synchronisation de données hors-ligne, seule la coquille + les dernières données déjà
 * chargées restent consultables sans réseau (voir PwaBanners pour le bandeau affiché si la
 * connexion tombe en cours d'usage). */
export function InstallPromptModal() {
  const { available, promptInstall } = useInstallPrompt();
  const [ouvert, setOuvert] = useState(false);
  const [installation, setInstallation] = useState(false);

  useEffect(() => {
    if (available && !popupDejaReporteRecemment()) {
      // Petit délai pour ne pas apparaître pile au chargement, par-dessus l'écran de connexion.
      const id = setTimeout(() => setOuvert(true), 1500);
      return () => clearTimeout(id);
    }
    setOuvert(false);
  }, [available]);

  const reporter = () => {
    try {
      localStorage.setItem(CLE_REPORT, String(Date.now()));
    } catch {
      // stockage indisponible — tant pis, pas bloquant
    }
    setOuvert(false);
  };

  const installer = async () => {
    setInstallation(true);
    try {
      await promptInstall();
    } finally {
      setInstallation(false);
      setOuvert(false);
    }
  };

  return (
    <Modal open={ouvert} onClose={reporter} title="Installer l'application">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Installez l'application sur cet ordinateur pour y accéder directement depuis le bureau
          ou la barre des tâches, sans passer par le navigateur — plus rapide, et dans sa propre fenêtre.
        </p>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          ℹ️ Une fois installée, l'application reste disponible hors connexion pour <strong>consulter</strong> les
          données déjà chargées. La saisie (notes, paiements, présences...) nécessite toujours une connexion
          internet pour être enregistrée.
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={reporter} disabled={installation}>Plus tard</Button>
          <Button type="button" onClick={installer} disabled={installation}>
            {installation ? "…" : "📥 Installer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
