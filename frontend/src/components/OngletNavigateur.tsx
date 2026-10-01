import { useEffect, useState } from "react";

import { plateformeBrandingApi } from "../api/services";
import { useAuth } from "../context/AuthContext";

const ICONE_PAR_DEFAUT = "/pwa-192.png";

function definirIcone(href: string) {
  for (const rel of ["icon", "apple-touch-icon"]) {
    let lien = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
    if (!lien) {
      lien = document.createElement("link");
      lien.rel = rel;
      document.head.appendChild(lien);
    }
    lien.href = href;
  }
}

/** Titre et icône de l'onglet du navigateur, dynamiques : nom et logo de l'école de
 * l'utilisateur connecté, sinon (page de connexion, Super Admin) ceux de la plateforme réglés
 * dans Paramètres de la plateforme. Rien n'est affiché en dur dans index.html. */
export function OngletNavigateur() {
  const { user } = useAuth();
  const [plateforme, setPlateforme] = useState<{ nom: string; logo: string | null } | null>(null);

  useEffect(() => {
    plateformeBrandingApi
      .get()
      .then(({ data }) => setPlateforme({ nom: data.nom_plateforme, logo: data.logo }))
      .catch(() => setPlateforme(null));
  }, []);

  useEffect(() => {
    const nom = user?.ecole_nom || plateforme?.nom;
    if (nom) document.title = nom;
    definirIcone(user?.ecole_logo || plateforme?.logo || ICONE_PAR_DEFAUT);
  }, [user?.ecole_nom, user?.ecole_logo, plateforme]);

  return null;
}
