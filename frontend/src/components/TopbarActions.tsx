import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { annoncesApi, ecolesApi, messagesApi, unwrapList } from "../api/services";
import { useAuth } from "../context/AuthContext";
import type { Annonce } from "../types";

const VU_LE_KEY = "annonces_vues_le";
const VU_LE_KEY_SA = "ecoles_surveillees_vues_le";

interface NotifItem {
  id: number | string;
  titre: string;
  detail: string;
  onClick: () => void;
}

export function TopbarActions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nonLus, setNonLus] = useState(0);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [notifOuvert, setNotifOuvert] = useState(false);
  const [nouvelleActivite, setNouvelleActivite] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = user?.role === "superadmin";
  const peutMessager = user && !isSuperAdmin;

  useEffect(() => {
    if (!peutMessager) return;
    const charger = () => messagesApi.nonLus().then(({ data }) => setNonLus(data.non_lus)).catch(() => {});
    charger();
    const id = setInterval(charger, 30000);
    return () => clearInterval(id);
  }, [peutMessager]);

  useEffect(() => {
    if (peutMessager) {
      annoncesApi.list({ page_size: 5 }).then(({ data }) => {
        const annonces = unwrapList(data) as Annonce[];
        setItems(annonces.map((a) => ({
          id: a.id, titre: a.titre,
          detail: new Date(a.date_publication).toLocaleDateString("fr-FR"),
          onClick: () => navigate("/annonces"),
        })));
        const vuLe = localStorage.getItem(VU_LE_KEY);
        if (annonces[0] && (!vuLe || new Date(annonces[0].date_publication) > new Date(vuLe))) {
          setNouvelleActivite(true);
        }
      }).catch(() => {});
    } else if (isSuperAdmin) {
      ecolesApi.stats().then(({ data }) => {
        const alertes = data.ecoles_a_surveiller;
        setItems(alertes.map((e) => ({
          id: e.id, titre: e.nom,
          detail: `${e.jours_avant_blocage} jour${e.jours_avant_blocage > 1 ? "s" : ""} avant blocage`,
          onClick: () => navigate(`/ecoles/${e.id}`),
        })));
        const vuLe = localStorage.getItem(VU_LE_KEY_SA);
        if (alertes.length > 0 && (!vuLe || alertes.length !== Number(vuLe))) {
          setNouvelleActivite(true);
        }
      }).catch(() => {});
    }
  }, [peutMessager, isSuperAdmin, navigate]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setNotifOuvert(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleNotifs = () => {
    setNotifOuvert((v) => !v);
    if (!notifOuvert) {
      setNouvelleActivite(false);
      if (isSuperAdmin) localStorage.setItem(VU_LE_KEY_SA, String(items.length));
      else localStorage.setItem(VU_LE_KEY, new Date().toISOString());
    }
  };

  if (!user) return null;
  const peutNotifier = peutMessager || isSuperAdmin;

  return (
    <div className="flex items-center gap-1.5">
      {peutMessager && (
        <Link
          to="/messagerie"
          className="relative h-10 w-10 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-brand-700 transition"
          title="Messagerie"
        >
          <span className="text-lg">✉️</span>
          {nonLus > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
              {nonLus > 9 ? "9+" : nonLus}
            </span>
          )}
        </Link>
      )}

      {peutNotifier && (
        <div className="relative" ref={panelRef}>
          <button
            onClick={toggleNotifs}
            className="relative h-10 w-10 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-brand-700 transition"
            title="Notifications"
          >
            <span className="text-lg">🔔</span>
            {nouvelleActivite && <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-rose-500" />}
          </button>
          {notifOuvert && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden animate-pop-in">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="font-bold text-ink-900 text-sm">{isSuperAdmin ? "Écoles à surveiller" : "Annonces récentes"}</p>
              </div>
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">{isSuperAdmin ? "Aucune école en retard 🎉" : "Aucune annonce pour le moment"}</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                  {items.map((it) => (
                    <li
                      key={it.id}
                      className="px-4 py-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => { setNotifOuvert(false); it.onClick(); }}
                    >
                      <p className="text-sm font-semibold text-slate-700 truncate">{it.titre}</p>
                      <p className="text-xs text-slate-400">{it.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => { setNotifOuvert(false); navigate(isSuperAdmin ? "/ecoles" : "/annonces"); }}
                className="w-full text-center text-xs font-semibold text-brand-600 py-2.5 hover:bg-brand-50 border-t border-slate-100"
              >
                {isSuperAdmin ? "Voir tous les établissements" : "Voir toutes les annonces"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
