import { useEffect, useState, type FormEvent } from "react";

import { abonnementDjomyApi, anneesApi, modelesMessageApi, parametresEcoleApi, periodesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import type { AnneeScolaire, Ecole, ModeleMessage, Periode, TransactionAbonnement } from "../types";

// Statuts pour lesquels un paiement est effectivement dû — masque le bouton quand l'abonnement
// est déjà à jour ou suspendu (le Super Admin doit alors réactiver l'école lui-même).
const STATUTS_ABONNEMENT_PAYABLES = new Set(["en_attente", "en_retard", "bloque"]);

/** Paiement en ligne de l'abonnement (self-service) via la passerelle Mobile Money Djomy —
 * initie une transaction (POST payer-abonnement), ouvre la page de paiement Djomy renvoyée
 * (`redirect_url`) dans un nouvel onglet, puis vérifie périodiquement son statut jusqu'à
 * confirmation : Djomy ne confirme jamais de façon synchrone (voir PayerAbonnementDjomyView
 * côté backend), donc `onPaye` n'est appelé qu'une fois le paiement réellement confirmé. */
function PayerAbonnementDjomySection({ ecole, onPaye }: { ecole: Ecole; onPaye: () => void }) {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [payerNumber, setPayerNumber] = useState("");
  const [periode, setPeriode] = useState<"mensuel" | "annuel">("mensuel");
  const [error, setError] = useState("");
  const [initiating, setInitiating] = useState(false);
  const [transaction, setTransaction] = useState<TransactionAbonnement | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!transaction || transaction.statut !== "en_attente") return;
    const interval = setInterval(async () => {
      try {
        const { data } = await abonnementDjomyApi.verifier(transaction.transaction_id);
        setTransaction(data);
        if (data.statut === "reussi") {
          toast.success("Paiement confirmé — abonnement mis à jour.");
          setModalOpen(false);
          onPaye();
        } else if (data.statut === "echoue") {
          toast.error("Le paiement Djomy a échoué ou a été annulé.");
        }
      } catch {
        // Erreur réseau/API ponctuelle — on retente simplement au prochain intervalle.
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [transaction, toast, onPaye]);

  const openModal = () => {
    setPayerNumber("");
    setPeriode("mensuel");
    setError("");
    setTransaction(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setInitiating(true);
    setError("");
    try {
      const { data } = await abonnementDjomyApi.payer(payerNumber, periode);
      setTransaction(data);
      if (data.redirect_url) window.open(data.redirect_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setInitiating(false);
    }
  };

  const handleVerifierMaintenant = async () => {
    if (!transaction) return;
    setVerifying(true);
    try {
      const { data } = await abonnementDjomyApi.verifier(transaction.transaction_id);
      setTransaction(data);
      if (data.statut === "reussi") {
        toast.success("Paiement confirmé — abonnement mis à jour.");
        setModalOpen(false);
        onPaye();
      } else if (data.statut === "echoue") {
        toast.error("Le paiement Djomy a échoué ou a été annulé.");
      } else {
        toast.info("Paiement toujours en attente de confirmation.");
      }
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setVerifying(false);
    }
  };

  if (!STATUTS_ABONNEMENT_PAYABLES.has(ecole.statut_abonnement)) return null;

  return (
    <>
      <Button type="button" variant="secondary" onClick={openModal} className="mt-3 w-full">
        Payer mon abonnement
      </Button>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Payer l'abonnement — Djomy">
        {!transaction ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="text-sm font-medium text-ink-900 mb-2">Période à régler</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPeriode("mensuel")}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    periode === "mensuel" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  Mensuel
                </button>
                <button
                  type="button"
                  onClick={() => setPeriode("annuel")}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    periode === "annuel" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  Annuel
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-500">
              Montant à régler :{" "}
              <span className="font-semibold text-ink-900">
                {(Number(ecole.abonnement_mensuel) * (periode === "annuel" ? 12 : 1)).toLocaleString("fr-FR")} GNF
              </span>
              {periode === "annuel" && <span className="text-slate-400"> (12 mois)</span>}
            </p>
            <Input
              label="Numéro Mobile Money (payeur)" required placeholder="622000000"
              value={payerNumber} onChange={(e) => setPayerNumber(e.target.value)}
            />
            {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={initiating}>{initiating ? "Initialisation…" : "Payer"}</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {transaction.statut === "en_attente" && "Une demande de paiement a été envoyée. Finalisez-la sur la page Djomy ouverte dans un nouvel onglet, puis revenez ici — la vérification se fait automatiquement."}
              {transaction.statut === "reussi" && "✅ Paiement confirmé."}
              {transaction.statut === "echoue" && "❌ Le paiement a échoué ou a été annulé."}
            </p>
            {transaction.redirect_url && transaction.statut === "en_attente" && (
              <a href={transaction.redirect_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-600 hover:underline">
                🔗 Rouvrir la page de paiement Djomy
              </a>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Fermer</Button>
              {transaction.statut === "en_attente" && (
                <Button type="button" onClick={handleVerifierMaintenant} disabled={verifying}>
                  {verifying ? "Vérification…" : "🔄 Vérifier le paiement"}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Textarea({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-slate-600 mb-1.5">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 transition focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
      />
    </label>
  );
}

/** Logo de l'école — sauvegardé indépendamment du reste du profil (son propre PATCH multipart,
 * voir `parametresEcoleApi.updateLogo`) : le formulaire principal envoie du JSON (le champ
 * `parametres` imbriqué ne survivrait pas à un aller-retour multipart), donc jamais les deux
 * dans la même requête. `refreshUser()` ensuite pour que la sidebar (logo affiché à côté du nom
 * de l'école, voir Layout.tsx) reflète le nouveau logo sans attendre une reconnexion. */
function LogoEcoleSection({ ecole, onUpdated }: { ecole: Ecole | null; onUpdated: (ecole: Ecole) => void }) {
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [apercu, setApercu] = useState<string | null>(null);

  const handleChange = async (file: File | null) => {
    if (!file) return;
    setApercu(URL.createObjectURL(file));
    setSaving(true);
    try {
      const { data } = await parametresEcoleApi.updateLogo(file);
      onUpdated(data);
      await refreshUser();
      toast.success("Logo mis à jour.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const logoAffiche = apercu || ecole?.logo || null;

  return (
    <Card>
      <h3 className="font-bold text-ink-900 mb-1">Logo de l'école</h3>
      <p className="text-xs text-slate-500 mb-4">
        Affiché dans la barre latérale de tous les comptes de l'école, et sur les documents (bulletins, reçus, badges...).
      </p>
      <div className="flex items-center gap-4">
        {logoAffiche ? (
          <img src={logoAffiche} alt="Logo de l'école" className="h-16 w-16 rounded-xl object-cover border border-slate-200 shrink-0" />
        ) : (
          <div className="h-16 w-16 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center text-2xl font-bold shrink-0">
            {(ecole?.nom?.[0] || "?").toUpperCase()}
          </div>
        )}
        <label className="block">
          <span className="inline-block cursor-pointer text-sm font-semibold text-brand-600 hover:underline">
            {saving ? "Envoi…" : "Choisir une image…"}
          </span>
          <input
            type="file" accept="image/*" className="hidden" disabled={saving}
            onChange={(e) => handleChange(e.target.files?.[0] || null)}
          />
        </label>
      </div>
    </Card>
  );
}

/** Les 5 messages automatiques (création de compte, mensualité impayée, absence, réunion des
 * parents, résultats disponibles) sont personnalisables mais sauvegardés indépendamment les uns
 * des autres (un PATCH par modèle) — un bloc autonome plutôt qu'intégré au <form> principal de
 * la page, pour ne pas mélanger deux logiques de sauvegarde différentes. */
function ModelesMessageSection() {
  const [modeles, setModeles] = useState<ModeleMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<Record<string, { sujet: string; contenu: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [ouvert, setOuvert] = useState<string | null>(null);

  useEffect(() => {
    modelesMessageApi.list().then(({ data }) => {
      const liste = unwrapList(data);
      setModeles(liste);
      setForms(Object.fromEntries(liste.map((m) => [m.cle, { sujet: m.sujet, contenu: m.contenu }])));
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async (cle: string) => {
    setSaving(cle);
    setFeedback((f) => ({ ...f, [cle]: "" }));
    try {
      const { data } = await modelesMessageApi.update(cle, forms[cle]);
      setModeles((prev) => prev.map((m) => (m.cle === cle ? data : m)));
      setFeedback((f) => ({ ...f, [cle]: "✓ Enregistré." }));
    } catch (err) {
      setFeedback((f) => ({ ...f, [cle]: extractErrorMessage(err) }));
    } finally {
      setSaving(null);
    }
  };

  const handleReinitialiser = (cle: string) => {
    setForms((f) => ({ ...f, [cle]: { sujet: "", contenu: "" } }));
  };

  if (loading) return null;

  return (
    <Card>
      <h3 className="font-bold text-ink-900 mb-1">Messages automatiques</h3>
      <p className="text-xs text-slate-500 mb-4">
        Personnalisez le texte envoyé par e-mail/SMS pour chaque événement. Laissez vide pour garder le texte par défaut.
      </p>
      <div className="divide-y divide-slate-100">
        {modeles.map((m) => {
          const form = forms[m.cle] ?? { sujet: "", contenu: "" };
          const estOuvert = ouvert === m.cle;
          return (
            <div key={m.cle} className="py-3">
              <button
                type="button"
                onClick={() => setOuvert(estOuvert ? null : m.cle)}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-700">{m.label}</p>
                  <p className="text-xs text-slate-400">{m.description}</p>
                </div>
                <span className="text-slate-400 text-xs shrink-0 ml-2">{estOuvert ? "▲" : "▼"}</span>
              </button>

              {estOuvert && (
                <div className="mt-3 space-y-3">
                  {m.jetons.length > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Jetons disponibles : {m.jetons.map((j) => <code key={j} className="mx-0.5 px-1 py-0.5 bg-slate-100 rounded text-slate-600">{j}</code>)}
                    </p>
                  )}
                  <Input
                    label="Sujet (e-mail)"
                    placeholder="Laisser vide pour le sujet par défaut"
                    value={form.sujet}
                    onChange={(e) => setForms((f) => ({ ...f, [m.cle]: { ...form, sujet: e.target.value } }))}
                  />
                  <Textarea
                    label="Contenu"
                    rows={4}
                    value={form.contenu}
                    onChange={(v) => setForms((f) => ({ ...f, [m.cle]: { ...form, contenu: v } }))}
                  />
                  {feedback[m.cle] && (
                    <p className={`text-xs ${feedback[m.cle].startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{feedback[m.cle]}</p>
                  )}
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" disabled={saving === m.cle} onClick={() => handleSave(m.cle)}>
                      {saving === m.cle ? "Enregistrement…" : "Enregistrer"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => handleReinitialiser(m.cle)}>
                      Réinitialiser au texte par défaut
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function ParametresEcolePage() {
  const { user } = useAuth();
  // Page réservée jusqu'ici à l'admin exclusivement — le Directeur Général (accès lecture
  // seule, voir TeachersPage.tsx) y accède désormais aussi : tout le contenu du formulaire est
  // désactivé d'un coup via <fieldset disabled> plutôt que bouton par bouton (page dense, avec
  // plusieurs sous-formulaires — logo, profil, en-tête bulletin, année scolaire, périodes,
  // modèles de message).
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const confirmer = useConfirm();
  const [ecole, setEcole] = useState<Ecole | null>(null);
  const [annees, setAnnees] = useState<AnneeScolaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    nom: "", adresse: "", telephone: "", email: "",
    ire: "", dpe: "", dsee: "",
    entete_ministere_1: "", entete_ministere_2: "", entete_republique: "", entete_devise: "",
    devise: "GNF", bareme_notation: 20, moyenne_admission: "10.00",
    heure_limite_ponctualite: "08:15", message_bienvenue: "", reglement_interieur: "",
  });

  const [anneeForm, setAnneeForm] = useState({ libelle: "", date_debut: "", date_fin: "" });
  const [anneeSaving, setAnneeSaving] = useState(false);
  const [anneeError, setAnneeError] = useState("");

  // Périodes (trimestres/semestres) de l'année scolaire sélectionnée — libres en nom et en
  // nombre : rien n'impose 2 ou 3 périodes, l'admin crée ce dont son établissement a besoin
  // (ex: "Trimestre 1"/"Trimestre 2" ou "Semestre 1"/"Semestre 2").
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [periodeAnneeId, setPeriodeAnneeId] = useState<number | "">("");
  const [periodeForm, setPeriodeForm] = useState({ nom: "", date_debut: "", date_fin: "" });
  const [editingPeriodeId, setEditingPeriodeId] = useState<number | null>(null);
  const [periodeSaving, setPeriodeSaving] = useState(false);
  const [periodeError, setPeriodeError] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([parametresEcoleApi.get(), anneesApi.list()])
      .then(([{ data }, anneesRes]) => {
        setEcole(data);
        const listeAnnees = unwrapList(anneesRes.data);
        setAnnees(listeAnnees);
        setPeriodeAnneeId((prev) => {
          if (prev && listeAnnees.some((a) => a.id === prev)) return prev;
          return listeAnnees.find((a) => a.active)?.id ?? listeAnnees[0]?.id ?? "";
        });
        setForm({
          nom: data.nom, adresse: data.adresse, telephone: data.telephone, email: data.email,
          ire: data.ire ?? "", dpe: data.dpe ?? "", dsee: data.dsee ?? "",
          entete_ministere_1: data.entete_ministere_1 ?? "", entete_ministere_2: data.entete_ministere_2 ?? "",
          entete_republique: data.entete_republique ?? "", entete_devise: data.entete_devise ?? "",
          devise: data.parametres?.devise ?? "GNF",
          bareme_notation: data.parametres?.bareme_notation ?? 20,
          moyenne_admission: data.parametres?.moyenne_admission ?? "10.00",
          heure_limite_ponctualite: data.parametres?.heure_limite_ponctualite?.slice(0, 5) ?? "08:15",
          message_bienvenue: data.parametres?.message_bienvenue ?? "",
          reglement_interieur: data.parametres?.reglement_interieur ?? "",
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const loadPeriodes = (anneeId: number | "") => {
    if (!anneeId) { setPeriodes([]); return; }
    periodesApi.list({ annee_scolaire: anneeId }).then(({ data }) => setPeriodes(unwrapList(data)));
  };

  useEffect(() => { loadPeriodes(periodeAnneeId); }, [periodeAnneeId]);

  const openCreerPeriode = () => {
    setEditingPeriodeId(null);
    setPeriodeForm({ nom: "", date_debut: "", date_fin: "" });
    setPeriodeError("");
  };

  const openEditPeriode = (p: Periode) => {
    setEditingPeriodeId(p.id);
    setPeriodeForm({ nom: p.nom, date_debut: p.date_debut, date_fin: p.date_fin });
    setPeriodeError("");
  };

  const handleSubmitPeriode = async (e: FormEvent) => {
    e.preventDefault();
    if (!periodeAnneeId) return;
    setPeriodeSaving(true);
    setPeriodeError("");
    try {
      if (editingPeriodeId) {
        await periodesApi.update(editingPeriodeId, periodeForm);
      } else {
        await periodesApi.create({ ...periodeForm, annee_scolaire: periodeAnneeId });
      }
      openCreerPeriode();
      loadPeriodes(periodeAnneeId);
    } catch (err) {
      setPeriodeError(extractErrorMessage(err));
    } finally {
      setPeriodeSaving(false);
    }
  };

  const handleSupprimerPeriode = async (p: Periode) => {
    if (!(await confirmer(`Supprimer « ${p.nom} » ?`, { danger: true }))) return;
    try {
      await periodesApi.remove(p.id);
      loadPeriodes(periodeAnneeId);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { data } = await parametresEcoleApi.update({
        nom: form.nom, adresse: form.adresse, telephone: form.telephone, email: form.email,
        ire: form.ire, dpe: form.dpe, dsee: form.dsee,
        entete_ministere_1: form.entete_ministere_1, entete_ministere_2: form.entete_ministere_2,
        entete_republique: form.entete_republique, entete_devise: form.entete_devise,
        parametres: {
          devise: form.devise, bareme_notation: form.bareme_notation, moyenne_admission: form.moyenne_admission,
          heure_limite_ponctualite: form.heure_limite_ponctualite, message_bienvenue: form.message_bienvenue,
          reglement_interieur: form.reglement_interieur,
        },
      });
      setEcole(data);
      setMessage("Paramètres enregistrés avec succès.");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const activerAnnee = async (annee: AnneeScolaire) => {
    if (!(await confirmer(`Définir "${annee.libelle}" comme année scolaire active ? Toute la plateforme basculera sur cette année.`))) return;
    await anneesApi.update(annee.id, { active: true });
    load();
  };

  const handleCreerAnnee = async (e: FormEvent) => {
    e.preventDefault();
    setAnneeSaving(true);
    setAnneeError("");
    try {
      await anneesApi.create(anneeForm);
      setAnneeForm({ libelle: "", date_debut: "", date_fin: "" });
      load();
    } catch (err) {
      setAnneeError(extractErrorMessage(err));
    } finally {
      setAnneeSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageHeader
        title="Paramètres de l'école"
        description="Profil, notation et année scolaire active — propres à votre établissement."
      />

      {!isAdmin && (
        <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5 mb-4">
          Accès en lecture seule — la modification des paramètres reste réservée à l'administrateur.
        </p>
      )}

      {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 mb-4">{error}</p>}
      {message && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5 mb-4">{message}</p>}

      <fieldset disabled={!isAdmin} className="border-0 p-0 m-0 min-w-0">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="lg:col-span-2 space-y-6">
          <LogoEcoleSection ecole={ecole} onUpdated={setEcole} />

          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Profil de l'établissement</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Nom de l'école" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} className="sm:col-span-2" />
              <Input label="Adresse" value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} className="sm:col-span-2" />
              <Input label="Téléphone" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
              <Input label="Email de contact" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-ink-900 mb-1">En-tête du bulletin</h3>
            <p className="text-xs text-slate-400 mb-4">
              Libellés institutionnels affichés en haut du bulletin (modèle « Officiel », réglé par le Super Admin dans Personnalisation).
              Préremplis avec les intitulés guinéens usuels — modifiables librement.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Input
                label="Ministère (ligne 1)" value={form.entete_ministere_1}
                onChange={(e) => setForm({ ...form, entete_ministere_1: e.target.value })}
                placeholder="Ministère de l'Éducation Nationale"
              />
              <Input
                label="Ministère (ligne 2)" value={form.entete_ministere_2}
                onChange={(e) => setForm({ ...form, entete_ministere_2: e.target.value })}
                placeholder="Ministère de l'Enseignement Pré-Universitaire (laisser vide pour la masquer)"
              />
              <Input
                label="Pays" value={form.entete_republique}
                onChange={(e) => setForm({ ...form, entete_republique: e.target.value })}
                placeholder="République de Guinée"
              />
              <Input
                label="Devise nationale" value={form.entete_devise}
                onChange={(e) => setForm({ ...form, entete_devise: e.target.value })}
                placeholder="Travail - Justice - Solidarité"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label="IRE" value={form.ire} onChange={(e) => setForm({ ...form, ire: e.target.value })} placeholder="Inspection Régionale de l'Éducation" />
              <Input label="DPE" value={form.dpe} onChange={(e) => setForm({ ...form, dpe: e.target.value })} placeholder="Direction Préfectorale de l'Éducation" />
              <Input label="DSEE" value={form.dsee} onChange={(e) => setForm({ ...form, dsee: e.target.value })} />
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Notation & ponctualité</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label="Devise" value={form.devise} onChange={(e) => setForm({ ...form, devise: e.target.value })} />
              <Input label="Barème de notation" type="number" min={10} max={100} value={form.bareme_notation} onChange={(e) => setForm({ ...form, bareme_notation: Number(e.target.value) })} />
              <Input label="Moyenne de passage" type="number" step="0.01" min={0} value={form.moyenne_admission} onChange={(e) => setForm({ ...form, moyenne_admission: e.target.value })} />
              <Input label="Heure limite de ponctualité" type="time" value={form.heure_limite_ponctualite} onChange={(e) => setForm({ ...form, heure_limite_ponctualite: e.target.value })} className="sm:col-span-1" />
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Portail élèves / parents</h3>
            <div className="space-y-4">
              <Input label="Message de bienvenue" value={form.message_bienvenue} onChange={(e) => setForm({ ...form, message_bienvenue: e.target.value })} />
              <Textarea label="Règlement intérieur (optionnel)" rows={5} value={form.reglement_interieur} onChange={(v) => setForm({ ...form, reglement_interieur: v })} />
            </div>
          </Card>

          <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer les paramètres"}</Button>
        </form>

        {/* Colonne de droite (1/3) : auparavant, "Modèles de message" occupait à tort 2
            colonnes juste après le formulaire (span-2 sur une grille qui n'a que 1 colonne
            libre à cet endroit) — la grille le renvoyait alors à la ligne suivante, laissant
            toute la 1ère ligne de cette colonne vide à côté du logo/profil. Regroupées dans un
            seul conteneur pleine hauteur, "Années scolaires" et les cartes qui suivent
            remontent naturellement combler cet espace ; "Modèles de message" (qui a vraiment
            besoin de toute la largeur) est sorti de la grille, en pleine largeur plus bas. */}
        <div className="space-y-6">
        <Card>
          <h3 className="font-bold text-ink-900 mb-1">Années scolaires</h3>
          <p className="text-xs text-slate-500 mb-4">Toute la plateforme (classes, notes, frais...) se règle sur l'année active.</p>
          <ul className="divide-y divide-slate-100">
            {annees.map((a) => (
              <li key={a.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{a.libelle}</p>
                  <p className="text-xs text-slate-400">{new Date(a.date_debut).toLocaleDateString("fr-FR")} — {new Date(a.date_fin).toLocaleDateString("fr-FR")}</p>
                </div>
                {a.active ? (
                  <Badge color="green">Active</Badge>
                ) : (
                  <button onClick={() => activerAnnee(a)} className="text-xs font-semibold text-brand-600 hover:underline">Activer</button>
                )}
              </li>
            ))}
          </ul>

          <form onSubmit={handleCreerAnnee} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nouvelle année scolaire</p>
            <Input
              label="Libellé" placeholder="Ex : 2027-2028" required
              value={anneeForm.libelle} onChange={(e) => setAnneeForm({ ...anneeForm, libelle: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Début" type="date" required
                value={anneeForm.date_debut} onChange={(e) => setAnneeForm({ ...anneeForm, date_debut: e.target.value })}
              />
              <Input
                label="Fin" type="date" required
                value={anneeForm.date_fin} onChange={(e) => setAnneeForm({ ...anneeForm, date_fin: e.target.value })}
              />
            </div>
            {anneeError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{anneeError}</p>}
            <Button type="submit" variant="secondary" disabled={anneeSaving} className="w-full">
              {anneeSaving ? "Création…" : "+ Créer l'année scolaire"}
            </Button>
            <p className="text-[11px] text-slate-400">
              Elle sera créée inactive — cliquez « Activer » ci-dessus une fois vos classes prêtes pour cette année.
            </p>
          </form>
        </Card>

        <Card>
          <h3 className="font-bold text-ink-900 mb-1">Périodes (trimestres / semestres)</h3>
          <p className="text-xs text-slate-500 mb-4">
            Utilisées pour la saisie des notes et la génération des bulletins — libre à vous d'en créer 2, 3 ou plus.
          </p>

          <Select
            label="Année scolaire"
            value={periodeAnneeId}
            onChange={(e) => setPeriodeAnneeId(e.target.value ? Number(e.target.value) : "")}
            className="mb-4"
          >
            <option value="">— Choisir —</option>
            {annees.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
          </Select>

          {periodeAnneeId && (
            <>
              {periodes.length === 0 ? (
                <p className="text-sm text-slate-400 mb-4">Aucune période créée pour cette année scolaire.</p>
              ) : (
                <ul className="divide-y divide-slate-100 mb-4">
                  {periodes.map((p) => (
                    <li key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{p.nom}</p>
                        <p className="text-xs text-slate-400">
                          {new Date(p.date_debut).toLocaleDateString("fr-FR")} — {new Date(p.date_fin).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => openEditPeriode(p)} className="text-xs font-semibold text-brand-600 hover:underline">Modifier</button>
                        <button onClick={() => handleSupprimerPeriode(p)} className="text-xs font-semibold text-rose-600 hover:underline">Supprimer</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleSubmitPeriode} className="pt-4 border-t border-slate-100 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {editingPeriodeId ? "Modifier la période" : "Nouvelle période"}
                </p>
                <Input
                  label="Nom" placeholder="Ex : Trimestre 1" required
                  value={periodeForm.nom} onChange={(e) => setPeriodeForm({ ...periodeForm, nom: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Début" type="date" required
                    value={periodeForm.date_debut} onChange={(e) => setPeriodeForm({ ...periodeForm, date_debut: e.target.value })}
                  />
                  <Input
                    label="Fin" type="date" required
                    value={periodeForm.date_fin} onChange={(e) => setPeriodeForm({ ...periodeForm, date_fin: e.target.value })}
                  />
                </div>
                {periodeError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{periodeError}</p>}
                <div className="flex gap-2">
                  <Button type="submit" variant="secondary" disabled={periodeSaving} className="flex-1">
                    {periodeSaving ? "Enregistrement…" : editingPeriodeId ? "Enregistrer" : "+ Créer la période"}
                  </Button>
                  {editingPeriodeId && (
                    <Button type="button" variant="ghost" onClick={openCreerPeriode}>Annuler</Button>
                  )}
                </div>
              </form>
            </>
          )}
        </Card>

        <Card>
          {ecole && (
            <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400">
              Abonnement plateforme : <Badge color={ecole.statut_abonnement === "paye" ? "green" : "amber"}>{ecole.statut_abonnement}</Badge>
              {ecole.statut_abonnement === "en_attente" && ecole.jours_avant_echeance !== null && (
                <p className="mt-2 text-slate-500">
                  {ecole.jours_avant_echeance > 0
                    ? `Échéance de paiement dans ${ecole.jours_avant_echeance} jour${ecole.jours_avant_echeance > 1 ? "s" : ""}.`
                    : "Échéance de paiement aujourd'hui."}
                </p>
              )}
              {ecole.statut_abonnement === "en_retard" && ecole.jours_avant_blocage !== null && (
                <p className="mt-2 text-amber-600 font-semibold">
                  ⚠️ {ecole.jours_avant_blocage > 0
                    ? `Accès bloqué dans ${ecole.jours_avant_blocage} jour${ecole.jours_avant_blocage > 1 ? "s" : ""} si l'abonnement n'est pas régularisé.`
                    : "Blocage imminent — l'abonnement n'a pas été régularisé."}
                </p>
              )}
              {ecole.statut_abonnement === "bloque" && (
                <p className="mt-2 text-rose-600 font-semibold">🚫 Accès bloqué — contactez l'administrateur de la plateforme pour régulariser.</p>
              )}
              <p className="mt-2">Ces champs sont gérés par le Super Admin de la plateforme.</p>
              <PayerAbonnementDjomySection ecole={ecole} onPaye={load} />
            </div>
          )}
        </Card>
        </div>
      </div>

      <div className="mt-6">
        <ModelesMessageSection />
      </div>
      </fieldset>
    </div>
  );
}
