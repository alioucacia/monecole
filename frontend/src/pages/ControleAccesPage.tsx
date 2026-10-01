import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  accesApi, unwrapList,
  type CarteAcces, type EquipementAcces, type PassageAcces, type TypeEquipement,
} from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, StatCard, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";

const TYPES: { value: TypeEquipement; label: string }[] = [
  { value: "qr", label: "Lecteur QR code" },
  { value: "rfid", label: "Lecteur RFID / badge" },
  { value: "biometrie", label: "Biométrie (empreinte, visage)" },
  { value: "camera", label: "Caméra (reconnaissance)" },
  { value: "porte", label: "Contrôleur de porte / tourniquet" },
  { value: "borne", label: "Borne navigateur (PC / tablette)" },
];

const URL_API = new URL(`${import.meta.env.VITE_API_URL || "/api"}/acces/equipement/passage/`, window.location.origin).href;

function heure(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Fil des passages du jour, rafraîchi toutes les 5 secondes. */
function EnDirect() {
  const [jour, setJour] = useState(new Date().toISOString().slice(0, 10));
  const [passages, setPassages] = useState<PassageAcces[]>([]);
  const [resume, setResume] = useState<{ entrees: number; sorties: number; refus: number; presents: number; eleves_presents: number; personnel_present: number } | null>(null);
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    let annule = false;
    const charger = () => {
      Promise.all([accesApi.passages({ date: jour, search: recherche || undefined }), accesApi.resume({ date: jour })]).then(([p, r]) => {
        if (annule) return;
        setPassages(unwrapList(p.data));
        setResume(r.data);
      }).catch(() => {});
    };
    charger();
    const id = setInterval(charger, 5000);
    return () => { annule = true; clearInterval(id); };
  }, [jour, recherche]);

  return (
    <div>
      {resume && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <StatCard label="Présents dans l'établissement" value={resume.presents} icon="🏫" accent="brand" />
          <StatCard label="Entrées" value={resume.entrees} icon="🟢" accent="teal" />
          <StatCard label="Sorties" value={resume.sorties} icon="🔵" accent="brand" />
          <StatCard label="Accès refusés" value={resume.refus} icon="⛔" accent="amber" />
        </div>
      )}
      <div className="flex flex-wrap gap-3 mb-4">
        <Input type="date" value={jour} onChange={(e) => setJour(e.target.value)} className="w-auto" />
        <Input placeholder="Rechercher un nom, une classe…" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="flex-1 min-w-[220px]" />
      </div>
      {passages.length === 0 ? (
        <EmptyState title="Aucun passage" description="Les entrées et sorties apparaîtront ici en temps réel." />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {passages.map((p) => (
              <li key={p.id} className="py-2.5 flex flex-wrap items-center gap-3">
                <span className="text-lg">{!p.autorise ? "⛔" : p.sens === "entree" ? "🟢" : "🔵"}</span>
                <span className="font-semibold text-slate-800">{p.nom_affiche || "Inconnu"}</span>
                {p.classe && <Badge color="slate">{p.classe}</Badge>}
                <span className="text-sm text-slate-500">
                  {p.autorise ? `${p.sens_display.toLowerCase()} ${heure(p.horodatage)}` : `refusé ${heure(p.horodatage)} — ${p.motif_refus}`}
                </span>
                <span className="ml-auto text-xs text-slate-400">{p.equipement_nom || "Borne"} · {p.methode_display}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Équipements connectés : ajout, clé secrète (affichée une seule fois), mode d'emploi API. */
function Equipements({ peutModifier }: { peutModifier: boolean }) {
  const toast = useToast();
  const confirmer = useConfirm();
  const [liste, setListe] = useState<EquipementAcces[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nom: "", type: "qr" as TypeEquipement, sens: "auto" });
  const [cleAffichee, setCleAffichee] = useState<EquipementAcces | null>(null);

  const charger = useCallback(() => {
    accesApi.equipements().then(({ data }) => setListe(unwrapList(data))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const ajouter = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await accesApi.creerEquipement(form as Partial<EquipementAcces>);
      setForm({ nom: "", type: "qr", sens: "auto" });
      setCleAffichee(data);
      charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const regenerer = async (eq: EquipementAcces) => {
    if (!(await confirmer(`Générer une nouvelle clé pour « ${eq.nom} » ? L'ancienne cessera de fonctionner immédiatement.`, { danger: true }))) return;
    try {
      const { data } = await accesApi.regenererCle(eq.id);
      setCleAffichee(data);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const basculer = async (eq: EquipementAcces) => {
    await accesApi.modifierEquipement(eq.id, { actif: !eq.actif });
    charger();
  };

  const supprimer = async (eq: EquipementAcces) => {
    if (!(await confirmer(`Supprimer l'équipement « ${eq.nom} » ? Son historique de passages est conservé.`, { danger: true }))) return;
    await accesApi.supprimerEquipement(eq.id);
    charger();
  };

  return (
    <div className="space-y-5">
      {peutModifier && (
        <Card>
          <h3 className="font-bold text-ink-900 mb-3">Ajouter un équipement</h3>
          <form noValidate onSubmit={ajouter} className="grid gap-3 sm:grid-cols-4 items-end">
            <Input label="Nom" required placeholder="Ex : Portail principal" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
            <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TypeEquipement })}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <Select label="Sens" value={form.sens} onChange={(e) => setForm({ ...form, sens: e.target.value })}>
              <option value="auto">Automatique (entrée puis sortie)</option>
              <option value="entree">Entrées uniquement</option>
              <option value="sortie">Sorties uniquement</option>
            </Select>
            <Button type="submit">+ Ajouter</Button>
          </form>
        </Card>
      )}

      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : liste.length === 0 ? (
        <EmptyState title="Aucun équipement" description="Ajoutez un lecteur, une borne ou un contrôleur de porte." />
      ) : (
        <Table headers={["Équipement", "Type", "Sens", "Dernière activité", "Statut", ""]}>
          {liste.map((eq) => (
            <tr key={eq.id}>
              <td className="px-4 py-3 font-medium text-slate-700">{eq.nom}</td>
              <td className="px-4 py-3 text-sm text-slate-500">{eq.type_display}</td>
              <td className="px-4 py-3 text-sm text-slate-500">{eq.sens_display}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{eq.derniere_activite ? new Date(eq.derniere_activite).toLocaleString("fr-FR") : "Jamais connecté"}</td>
              <td className="px-4 py-3"><Badge color={eq.actif ? "green" : "slate"}>{eq.actif ? "Actif" : "Désactivé"}</Badge></td>
              <td className="px-4 py-3">
                {peutModifier && (
                  <div className="flex flex-wrap gap-3 text-xs font-semibold">
                    <button onClick={() => regenerer(eq)} className="text-brand-600 hover:underline">🔑 Nouvelle clé</button>
                    <button onClick={() => basculer(eq)} className={eq.actif ? "text-rose-600 hover:underline" : "text-emerald-600 hover:underline"}>{eq.actif ? "Désactiver" : "Activer"}</button>
                    <button onClick={() => supprimer(eq)} className="text-rose-600 hover:underline">🗑️</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Card>
        <h3 className="font-bold text-ink-900 mb-2">Connecter un équipement (pour l'installateur)</h3>
        <div className="text-sm text-slate-600 space-y-2">
          <p><b>Lecteurs QR / RFID USB</b> (qui « tapent » le code comme un clavier) : aucune configuration — ouvrez la{" "}
            <Link to="/controle-acces/borne" className="text-brand-600 font-semibold hover:underline">borne d'accès</Link> sur le PC ou la tablette du portail.</p>
          <p><b>Équipements réseau</b> (lecteur IP, biométrie, caméra, contrôleur de porte, tourniquet) : à chaque lecture, l'équipement envoie :</p>
          <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 text-xs overflow-x-auto whitespace-pre">{`POST ${URL_API}
X-Cle-Equipement: <clé de l'équipement>
Content-Type: application/json

{"identifiant": "<contenu du QR, numéro RFID ou matricule>", "sens": "entree" | "sortie" (facultatif)}`}</pre>
          <p>Réponse : <code className="text-xs">{`{"ouvrir": true, "sens": "entree", "nom": "Mamadou Barry", "heure": "07:42", "message": "🟢 Mamadou Barry — entrée 07:42"}`}</code> — un contrôleur de porte déverrouille si <code>ouvrir</code> vaut <code>true</code>. Test de connexion : <code className="text-xs">GET …/acces/equipement/ping/</code> avec la même clé.</p>
          <p>Identifiants reconnus : le QR code de la carte élève ou enseignant, le numéro d'une carte RFID associée (onglet Cartes RFID), le matricule (biométrie, caméra).</p>
        </div>
      </Card>

      <Modal open={!!cleAffichee} onClose={() => setCleAffichee(null)} title={`Clé de « ${cleAffichee?.nom ?? ""} »`}>
        {cleAffichee && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Saisissez cette clé dans la configuration de l'équipement. <b>Elle ne sera plus affichée</b> : notez-la maintenant.</p>
            <code className="block break-all bg-slate-100 rounded-xl p-3 text-sm font-mono">{cleAffichee.cle}</code>
            <Button onClick={() => { navigator.clipboard?.writeText(cleAffichee.cle || ""); toast.success("Clé copiée."); }}>📋 Copier</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Cartes RFID : association numéro de carte → élève / membre du personnel. */
function Cartes({ peutModifier }: { peutModifier: boolean }) {
  const toast = useToast();
  const confirmer = useConfirm();
  const [liste, setListe] = useState<CarteAcces[]>([]);
  const [recherche, setRecherche] = useState("");
  const [personnes, setPersonnes] = useState<{ id: number; nom: string; role: string }[]>([]);
  const [personne, setPersonne] = useState("");
  const [uid, setUid] = useState("");

  const charger = useCallback(() => { accesApi.cartes().then(({ data }) => setListe(unwrapList(data))); }, []);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    if (recherche.trim().length < 2) { setPersonnes([]); return; }
    const id = setTimeout(() => {
      accesApi.personnes(recherche).then(({ data }) => setPersonnes(data)).catch(() => setPersonnes([]));
    }, 300);
    return () => clearTimeout(id);
  }, [recherche]);

  const associer = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await accesApi.creerCarte({ uid, personne: Number(personne) });
      toast.success("Carte associée.");
      setUid("");
      charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const supprimer = async (c: CarteAcces) => {
    if (!(await confirmer(`Retirer la carte ${c.uid} de ${c.personne_nom} ?`, { danger: true }))) return;
    await accesApi.supprimerCarte(c.id);
    charger();
  };

  return (
    <div className="space-y-5">
      {peutModifier && (
        <Card>
          <h3 className="font-bold text-ink-900 mb-1">Associer une carte RFID</h3>
          <p className="text-xs text-slate-500 mb-3">Le QR code des cartes élève/enseignant et le matricule fonctionnent sans association : seules les cartes RFID sont à enregistrer.</p>
          <form noValidate onSubmit={associer} className="grid gap-3 sm:grid-cols-3 items-end">
            <Input label="Rechercher la personne" placeholder="Nom, identifiant…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
            <Select label="Personne" required value={personne} onChange={(e) => setPersonne(e.target.value)}>
              <option value="">{recherche.length < 2 ? "— Tapez au moins 2 lettres —" : "— Choisir —"}</option>
              {personnes.map((u) => <option key={u.id} value={u.id}>{u.nom} ({u.role})</option>)}
            </Select>
            <Input label="Numéro de la carte (scannez-la)" required value={uid} onChange={(e) => setUid(e.target.value)} />
            <div className="sm:col-span-3"><Button type="submit">💳 Associer la carte</Button></div>
          </form>
        </Card>
      )}
      {liste.length === 0 ? <EmptyState title="Aucune carte RFID" description="Les cartes associées apparaîtront ici." /> : (
        <Table headers={["Carte", "Personne", "Rôle", "Associée le", ""]}>
          {liste.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-mono text-sm">{c.uid}</td>
              <td className="px-4 py-3 font-medium text-slate-700">{c.personne_nom}</td>
              <td className="px-4 py-3 text-sm text-slate-500">{c.personne_role}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{new Date(c.cree_le).toLocaleDateString("fr-FR")}</td>
              <td className="px-4 py-3">{peutModifier && <button onClick={() => supprimer(c)} className="text-xs font-semibold text-rose-600 hover:underline">Retirer</button>}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/** Contrôle d'accès : passages en direct, équipements connectés et cartes RFID. */
export default function ControleAccesPage() {
  const { user } = useAuth();
  const peutModifier = user?.role === "admin" || user?.role === "surveillance";
  const [onglet, setOnglet] = useState<"direct" | "equipements" | "cartes">("direct");

  return (
    <div>
      <PageHeader
        title="Contrôle d'accès"
        description="Entrées et sorties des élèves et du personnel, enregistrées par les lecteurs QR, RFID, la biométrie, les caméras ou la borne d'accès."
        actions={<Link to="/controle-acces/borne"><Button>📷 Ouvrir la borne d'accès</Button></Link>}
      />
      <div className="flex gap-2 mb-5 border-b border-slate-100">
        {([["direct", "🟢 En direct"], ["equipements", "📡 Équipements"], ["cartes", "💳 Cartes RFID"]] as const).map(([cle, label]) => (
          <button
            key={cle}
            onClick={() => setOnglet(cle)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${onglet === cle ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {onglet === "direct" && <EnDirect />}
      {onglet === "equipements" && <Equipements peutModifier={peutModifier} />}
      {onglet === "cartes" && <Cartes peutModifier={peutModifier} />}
    </div>
  );
}
