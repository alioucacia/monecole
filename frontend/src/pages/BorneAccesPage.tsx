import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { accesApi, unwrapList, type EquipementAcces, type ResultatScan } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Select } from "../components/ui";

/** Borne d'accès à ouvrir sur le PC / la tablette du portail, avec un lecteur QR ou RFID USB :
 * ces lecteurs « tapent » le code lu puis Entrée, dans le champ toujours actif ci-dessous.
 * Chaque passage s'affiche en grand : 🟢 entrée, 🔵 sortie, ⛔ refusé. */
export default function BorneAccesPage() {
  const [equipements, setEquipements] = useState<EquipementAcces[]>([]);
  const [equipement, setEquipement] = useState("");
  const [sens, setSens] = useState("");
  const [saisie, setSaisie] = useState("");
  const [dernier, setDernier] = useState<ResultatScan | null>(null);
  const [historique, setHistorique] = useState<ResultatScan[]>([]);
  const [erreur, setErreur] = useState("");
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    accesApi.equipements().then(({ data }) => setEquipements(unwrapList(data).filter((e) => e.actif))).catch(() => {});
  }, []);

  // Le champ de saisie garde toujours le focus : le lecteur USB écrit dedans à chaque scan.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.activeElement?.tagName !== "SELECT") champ.current?.focus();
    }, 800);
    return () => clearInterval(id);
  }, []);

  const scanner = async (e: FormEvent) => {
    e.preventDefault();
    const identifiant = saisie.trim();
    setSaisie("");
    if (!identifiant) return;
    setErreur("");
    try {
      const { data } = await accesApi.scanner({
        identifiant, equipement: equipement ? Number(equipement) : undefined, sens: sens || undefined,
      });
      setDernier(data);
      setHistorique((h) => [data, ...h.filter((x) => x.passage_id !== data.passage_id)].slice(0, 12));
    } catch (err) {
      setErreur(extractErrorMessage(err));
    }
  };

  const couleur = !dernier ? "bg-slate-50 border-slate-200"
    : !dernier.autorise ? "bg-rose-50 border-rose-300"
    : dernier.sens === "entree" ? "bg-emerald-50 border-emerald-300" : "bg-sky-50 border-sky-300";

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">Borne d'accès</h1>
          <p className="text-sm text-slate-500">Présentez la carte (QR code ou badge RFID) devant le lecteur.</p>
        </div>
        <div className="flex gap-3">
          <Select label="Équipement" value={equipement} onChange={(e) => setEquipement(e.target.value)} className="w-auto">
            <option value="">Borne (sans équipement)</option>
            {equipements.map((eq) => <option key={eq.id} value={eq.id}>{eq.nom}</option>)}
          </Select>
          <Select label="Sens" value={sens} onChange={(e) => setSens(e.target.value)} className="w-auto">
            <option value="">Automatique</option>
            <option value="entree">Entrée</option>
            <option value="sortie">Sortie</option>
          </Select>
        </div>
      </div>

      <form noValidate onSubmit={scanner}>
        <input
          ref={champ}
          autoFocus
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder="En attente d'un scan… (ou saisissez un matricule puis Entrée)"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm mb-5 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
        />
      </form>

      <div className={`rounded-3xl border-2 p-8 text-center transition-colors ${couleur}`}>
        {!dernier ? (
          <p className="text-slate-400 text-lg">📷 Prêt à scanner</p>
        ) : (
          <>
            {dernier.photo && <img src={dernier.photo} alt="" className="mx-auto mb-3 h-28 w-28 rounded-full object-cover border-4 border-white shadow" />}
            <p className="text-5xl mb-2">{!dernier.autorise ? "⛔" : dernier.sens === "entree" ? "🟢" : "🔵"}</p>
            <p className="text-3xl font-extrabold text-ink-900">{dernier.nom || "Badge inconnu"}</p>
            {dernier.classe && <p className="text-slate-500 font-semibold mt-1">{dernier.classe}</p>}
            <p className={`text-2xl font-bold mt-3 ${!dernier.autorise ? "text-rose-600" : dernier.sens === "entree" ? "text-emerald-600" : "text-sky-600"}`}>
              {!dernier.autorise ? `Accès refusé — ${dernier.motif_refus}` : `${dernier.sens === "entree" ? "Entrée" : "Sortie"} ${dernier.heure}`}
            </p>
          </>
        )}
      </div>
      {erreur && <p className="mt-3 text-sm text-rose-600">{erreur}</p>}

      {historique.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-100 bg-white rounded-2xl border border-slate-100">
          {historique.map((h) => <li key={h.passage_id} className="px-4 py-2 text-sm text-slate-700">{h.message}</li>)}
        </ul>
      )}
      <p className="mt-6 text-center"><Link to="/controle-acces" className="text-sm text-brand-600 hover:underline">← Retour au contrôle d'accès</Link></p>
    </div>
  );
}
