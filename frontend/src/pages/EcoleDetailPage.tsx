import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ecolesApi, fonctionnalitesApi, paiementsEcolesApi, unwrapList } from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { usePrompt } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, StatCard, Table } from "../components/ui";
import type { Ecole, EcoleStatsDetail, EcoleUtilisateur, Fonctionnalite, PaiementEcole } from "../types";

const STATUT_LABELS: Record<string, { label: string; color: "green" | "amber" | "rose" | "slate" }> = {
  paye: { label: "À jour", color: "green" },
  en_attente: { label: "En attente", color: "slate" },
  en_retard: { label: "En retard", color: "amber" },
  bloque: { label: "Bloquée", color: "rose" },
  suspendu: { label: "Suspendue", color: "rose" },
};

const ROLE_LABELS: Record<string, "brand" | "teal" | "amber" | "rose" | "slate"> = {
  admin: "brand", teacher: "teal", student: "amber", parent: "rose", comptabilite: "teal", surveillance: "slate",
};

const MODE_PAIEMENT_LABELS: Record<string, string> = {
  especes: "Espèces", virement: "Virement", cheque: "Chèque", carte_bancaire: "Carte bancaire",
  mobile_money: "Mobile Money (autre)", orange_money: "Orange Money", mtn_money: "MTN Mobile Money", moov_money: "Moov Money",
};

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

export default function EcoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ecoleId = Number(id);
  const navigate = useNavigate();
  const { impersonate } = useAuth();
  const toast = useToast();
  const demander = usePrompt();

  const [ecole, setEcole] = useState<Ecole | null>(null);
  const [stats, setStats] = useState<EcoleStatsDetail | null>(null);
  const [utilisateurs, setUtilisateurs] = useState<EcoleUtilisateur[]>([]);
  const [paiements, setPaiements] = useState<PaiementEcole[]>([]);
  const [tab, setTab] = useState<"apercu" | "utilisateurs" | "paiements" | "personnalisation">("apercu");
  const [loading, setLoading] = useState(true);
  const [connexionSupport, setConnexionSupport] = useState(false);
  const [suppression, setSuppression] = useState(false);

  // Personnalisation des documents PDF (bulletins, badges, fiches de paie) et fonctionnalités
  // désactivées pour cette école (onglet « Personnalisation ») — édition locale avant envoi.
  const [fonctionnalites, setFonctionnalites] = useState<Fonctionnalite[]>([]);
  const [couleurPrincipale, setCouleurPrincipale] = useState("#14304f");
  const [couleurSecondaire, setCouleurSecondaire] = useState("#b8860b");
  const [desactivees, setDesactivees] = useState<Set<string>>(new Set());
  const [savingCouleurs, setSavingCouleurs] = useState(false);
  const [savingFonctionnalites, setSavingFonctionnalites] = useState(false);

  // Création d'un compte Administrateur supplémentaire pour cette école (onglet Utilisateurs) —
  // la création de l'école elle-même n'en crée qu'un seul au départ.
  const [creerAdminOuvert, setCreerAdminOuvert] = useState(false);
  const [creerAdminForm, setCreerAdminForm] = useState({ username: "", first_name: "", last_name: "", email: "", phone: "", password: "" });
  const [creerAdminError, setCreerAdminError] = useState("");
  const [creerAdminSaving, setCreerAdminSaving] = useState(false);

  useEffect(() => {
    if (!ecoleId) return;
    setLoading(true);
    Promise.all([
      ecolesApi.get(ecoleId),
      ecolesApi.statsDetail(ecoleId),
      ecolesApi.utilisateurs(ecoleId),
      paiementsEcolesApi.list({ ecole: ecoleId, page_size: 100 }),
      fonctionnalitesApi.list(),
    ]).then(([ecoleRes, statsRes, usersRes, paiementsRes, fonctionnalitesRes]) => {
      setEcole(ecoleRes.data);
      setStats(statsRes.data);
      setUtilisateurs(usersRes.data);
      setPaiements(unwrapList(paiementsRes.data));
      setFonctionnalites(fonctionnalitesRes.data);
      setCouleurPrincipale(ecoleRes.data.couleur_principale || "#14304f");
      setCouleurSecondaire(ecoleRes.data.couleur_secondaire || "#b8860b");
      setDesactivees(new Set(ecoleRes.data.fonctionnalites_desactivees || []));
    }).finally(() => setLoading(false));
  }, [ecoleId]);

  const handleSaveCouleurs = async () => {
    if (!ecole) return;
    setSavingCouleurs(true);
    try {
      const { data } = await ecolesApi.update(ecole.id, {
        couleur_principale: couleurPrincipale, couleur_secondaire: couleurSecondaire,
      });
      setEcole(data);
      toast.success("Couleurs des documents mises à jour.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSavingCouleurs(false);
    }
  };

  const toggleFonctionnalite = (cle: string) => {
    setDesactivees((prev) => {
      const next = new Set(prev);
      if (next.has(cle)) next.delete(cle);
      else next.add(cle);
      return next;
    });
  };

  const handleSaveFonctionnalites = async () => {
    if (!ecole) return;
    setSavingFonctionnalites(true);
    try {
      const { data } = await ecolesApi.update(ecole.id, { fonctionnalites_desactivees: [...desactivees] });
      setEcole(data);
      toast.success("Fonctionnalités mises à jour.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSavingFonctionnalites(false);
    }
  };

  const openCreerAdmin = () => {
    setCreerAdminForm({ username: "", first_name: "", last_name: "", email: "", phone: "", password: "" });
    setCreerAdminError("");
    setCreerAdminOuvert(true);
  };

  const handleSubmitCreerAdmin = async (e: FormEvent) => {
    e.preventDefault();
    if (!ecole) return;
    setCreerAdminSaving(true);
    setCreerAdminError("");
    try {
      await ecolesApi.creerAdmin(ecole.id, creerAdminForm);
      const { data } = await ecolesApi.utilisateurs(ecole.id);
      setUtilisateurs(data);
      setCreerAdminOuvert(false);
      toast.success("Compte Administrateur créé.");
    } catch (err) {
      setCreerAdminError(extractErrorMessage(err));
    } finally {
      setCreerAdminSaving(false);
    }
  };

  const handleSeConnecterCommeAdmin = async () => {
    if (!ecole) return;
    setConnexionSupport(true);
    try {
      const { data } = await ecolesApi.seConnecterCommeAdmin(ecole.id);
      impersonate(data.access, data.refresh, data.user);
      navigate("/");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setConnexionSupport(false);
    }
  };

  const handleSupprimer = async () => {
    if (!ecole) return;
    const saisie = await demander(
      `Cette action est irréversible et supprimera TOUTES les données de « ${ecole.nom} » (élèves, notes, paiements...).`,
      { title: "Suppression définitive", label: "Tapez le nom de l'école pour confirmer", placeholder: ecole.nom, confirmLabel: "Supprimer" }
    );
    if (saisie !== ecole.nom) {
      if (saisie !== null) toast.warning("Le nom saisi ne correspond pas — suppression annulée.");
      return;
    }
    const code = await demander(
      "Deuxième vérification : saisissez votre code secret de suppression (défini depuis votre profil).",
      { title: "Code de suppression", label: "Code secret", confirmLabel: "Supprimer définitivement", inputType: "password", required: true }
    );
    if (code === null) return;
    setSuppression(true);
    try {
      await ecolesApi.remove(ecole.id, code);
      navigate("/ecoles");
    } catch (err) {
      toast.error(extractErrorMessage(err));
      setSuppression(false);
    }
  };

  const handleDownloadFacture = async (paiementId: number, filename: string) => {
    try {
      await paiementsEcolesApi.facture(paiementId, filename);
    } catch (err) {
      // Sans ce catch, un échec restait invisible (bouton "mort") — voir le même correctif
      // sur les fiches de paiement/badges.
      toast.error(await extractBlobErrorMessage(err));
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!ecole) return <EmptyState title="École introuvable" />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        {ecole.logo ? (
          <img src={ecole.logo} alt="" className="h-12 w-12 rounded-xl object-cover shrink-0" />
        ) : (
          <div className="h-12 w-12 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-bold shrink-0">
            {ecole.nom[0]?.toUpperCase()}
          </div>
        )}
        <PageHeader
          title={ecole.nom}
          description={ecole.adresse || "—"}
          actions={<Link to="/ecoles" className="text-sm text-brand-600 font-medium hover:underline">← Retour aux établissements</Link>}
        />
      </div>

      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Badge color={STATUT_LABELS[ecole.statut_abonnement]?.color || "slate"}>
            {STATUT_LABELS[ecole.statut_abonnement]?.label || ecole.statut_abonnement}
          </Badge>
          {ecole.jours_avant_prochaine_echeance !== null && (
            <span className="text-sm text-slate-500">
              {ecole.jours_avant_prochaine_echeance}j restant{ecole.jours_avant_prochaine_echeance > 1 ? "s" : ""} ({ecole.periodicite_abonnement_display})
            </span>
          )}
          <span className="text-sm text-slate-500">{ecole.email || "—"} · {ecole.telephone || "—"}</span>
          <span className="text-sm text-slate-400">Créée le {new Date(ecole.date_creation).toLocaleDateString("fr-FR")}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={openCreerAdmin}>+ Créer un compte admin</Button>
          <Button variant="secondary" onClick={handleSeConnecterCommeAdmin} disabled={connexionSupport}>
            {connexionSupport ? "Connexion…" : "🛠️ Se connecter en tant qu'admin"}
          </Button>
          <button
            onClick={handleSupprimer}
            disabled={suppression}
            className="text-sm font-semibold text-rose-600 hover:underline disabled:opacity-50"
          >
            {suppression ? "Suppression…" : "🗑️ Supprimer définitivement"}
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <StatCard label="Élèves" value={stats.total_eleves} icon="🎓" accent="brand" />
          <StatCard label="Enseignants" value={stats.total_enseignants} icon="🧑‍🏫" accent="teal" />
          <StatCard label="Classes" value={stats.total_classes} icon="🏫" accent="amber" />
          <StatCard label="Frais attendus (interne)" value={money(stats.total_frais_attendu)} icon="🏦" accent="rose" />
          <StatCard label="Frais encaissés (interne)" value={money(stats.total_frais_encaisse)} icon="💰" accent="green" />
        </div>
      )}

      <div className="flex gap-2 mb-6">
        {[
          { key: "apercu", label: "Aperçu" },
          { key: "utilisateurs", label: `Utilisateurs (${utilisateurs.length})` },
          { key: "paiements", label: `Paiements plateforme (${paiements.length})` },
          { key: "personnalisation", label: "Personnalisation" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === t.key ? "bg-brand-600 text-white shadow-soft" : "bg-white text-slate-600 border border-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "apercu" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h3 className="font-bold text-ink-900 mb-4">Abonnement plateforme</h3>
            <div className="space-y-2 text-sm">
              {ecole.plan_nom && (
                <div className="flex justify-between"><span className="text-slate-500">Plan</span><span className="font-semibold">{ecole.plan_nom}</span></div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Périodicité</span><span className="font-semibold">{ecole.periodicite_abonnement_display}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Montant mensuel</span><span className="font-semibold">{money(ecole.abonnement_mensuel)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Jour d'échéance</span><span className="font-semibold">{ecole.jour_echeance}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Jours de grâce</span><span className="font-semibold">{ecole.jours_grace}</span></div>
              {ecole.jours_avant_prochaine_echeance !== null && (
                <div className="flex justify-between"><span className="text-slate-500">Prochaine échéance</span><span className="font-semibold">dans {ecole.jours_avant_prochaine_echeance} jour{ecole.jours_avant_prochaine_echeance > 1 ? "s" : ""}</span></div>
              )}
              {ecole.dernier_paiement && (
                <div className="flex justify-between"><span className="text-slate-500">Dernier paiement</span><span className="font-semibold">{new Date(ecole.dernier_paiement.mois).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span></div>
              )}
            </div>
          </Card>
          {ecole.plan_limite_eleves && stats && (
            <Card>
              <h3 className="font-bold text-ink-900 mb-4">Utilisation du plan</h3>
              {(() => {
                const pct = Math.min(100, Math.round((stats.total_eleves / ecole.plan_limite_eleves) * 100));
                const proche = pct >= 90;
                return (
                  <>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-slate-500">Élèves inscrits</span>
                      <span className={`font-semibold ${proche ? "text-rose-600" : "text-ink-900"}`}>{stats.total_eleves} / {ecole.plan_limite_eleves}</span>
                    </div>
                    <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${proche ? "bg-rose-500" : "bg-brand-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {proche && <p className="text-xs text-rose-600 mt-2">⚠️ L'école approche de la limite de son plan.</p>}
                  </>
                );
              })()}
            </Card>
          )}
          {ecole.parametres && (
            <Card>
              <h3 className="font-bold text-ink-900 mb-4">Paramètres pédagogiques</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Devise</span><span className="font-semibold">{ecole.parametres.devise}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Barème de notation</span><span className="font-semibold">/{ecole.parametres.bareme_notation}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Moyenne de passage</span><span className="font-semibold">{ecole.parametres.moyenne_admission}</span></div>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "utilisateurs" && (
        utilisateurs.length === 0 ? <EmptyState title="Aucun utilisateur" /> : (
          <Table headers={["Nom", "Identifiant", "Rôle", "Statut", "Inscrit le", "Dernière connexion"]}>
            {utilisateurs.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{u.full_name}</td>
                <td className="px-4 py-3 text-xs font-mono text-slate-500">{u.username}</td>
                <td className="px-4 py-3"><Badge color={ROLE_LABELS[u.role] || "slate"}>{u.role_display}</Badge></td>
                <td className="px-4 py-3"><Badge color={u.is_active ? "green" : "rose"}>{u.is_active ? "Actif" : "Désactivé"}</Badge></td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(u.date_joined).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {u.en_ligne && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold mr-2" title="En ligne actuellement">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                      En ligne
                    </span>
                  )}
                  {u.last_login ? new Date(u.last_login).toLocaleString("fr-FR") : "Jamais connecté"}
                </td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === "paiements" && (
        paiements.length === 0 ? <EmptyState title="Aucun paiement enregistré" /> : (
          <Table headers={["Mois", "Montant", "Mode", "Référence", "Encaissé le", "Enregistré par", "Facture"]}>
            {paiements.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">{new Date(p.mois).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
                <td className="px-4 py-3 font-semibold">{money(p.montant)}</td>
                <td className="px-4 py-3 text-slate-500">{MODE_PAIEMENT_LABELS[p.mode_paiement] ?? p.mode_paiement}</td>
                <td className="px-4 py-3 text-xs font-mono text-slate-400">{p.reference || "—"}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(p.date_paiement).toLocaleDateString("fr-FR")}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{p.enregistre_par_nom || "—"}</td>
                <td className="px-4 py-3">
                  <button
                    className="text-xs font-semibold text-brand-600 hover:underline"
                    onClick={() => handleDownloadFacture(p.id, `facture_${ecole.slug}_${p.mois.slice(0, 7)}.pdf`)}
                  >
                    🧾 PDF
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )
      )}

      {tab === "personnalisation" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h3 className="font-bold text-ink-900 mb-1">Couleurs des documents</h3>
            <p className="text-sm text-slate-500 mb-4">
              Utilisées sur les bulletins, badges élève et fiches de paie générés pour cette école.
            </p>
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-slate-600">Couleur principale</span>
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={couleurPrincipale}
                    onChange={(e) => setCouleurPrincipale(e.target.value)}
                    className="h-9 w-14 rounded-lg border border-slate-200 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-400">{couleurPrincipale}</span>
                </span>
              </label>
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-slate-600">Couleur secondaire</span>
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={couleurSecondaire}
                    onChange={(e) => setCouleurSecondaire(e.target.value)}
                    className="h-9 w-14 rounded-lg border border-slate-200 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-400">{couleurSecondaire}</span>
                </span>
              </label>

              <div
                className="rounded-xl overflow-hidden border border-slate-200"
                style={{ fontFamily: "Helvetica, Arial, sans-serif" }}
              >
                <div className="px-3 py-2 text-white text-xs font-bold uppercase tracking-wide" style={{ backgroundColor: couleurPrincipale }}>
                  {ecole.nom}
                </div>
                <div className="px-3 py-1.5 text-white text-[11px] font-semibold uppercase tracking-wide" style={{ backgroundColor: couleurSecondaire }}>
                  Aperçu du bandeau
                </div>
              </div>

              <Button onClick={handleSaveCouleurs} disabled={savingCouleurs}>
                {savingCouleurs ? "Enregistrement…" : "Enregistrer les couleurs"}
              </Button>
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-ink-900 mb-1">Fonctionnalités</h3>
            <p className="text-sm text-slate-500 mb-4">
              Décochez un module pour le désactiver immédiatement pour tous les comptes de cette école
              (menu masqué, accès à l'API bloqué).
            </p>
            {fonctionnalites.length === 0 ? (
              <p className="text-sm text-slate-400">Chargement…</p>
            ) : (
              <div className="space-y-2">
                {fonctionnalites.map((f) => {
                  const active = !desactivees.has(f.cle);
                  return (
                    <label
                      key={f.cle}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50"
                    >
                      <span className={`text-sm font-medium ${active ? "text-ink-900" : "text-slate-400 line-through"}`}>{f.label}</span>
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleFonctionnalite(f.cle)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                    </label>
                  );
                })}
                <Button onClick={handleSaveFonctionnalites} disabled={savingFonctionnalites} className="mt-2">
                  {savingFonctionnalites ? "Enregistrement…" : "Enregistrer les fonctionnalités"}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal open={creerAdminOuvert} onClose={() => setCreerAdminOuvert(false)} title={`Créer un compte admin — ${ecole.nom}`}>
        <form onSubmit={handleSubmitCreerAdmin} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Prénom" required value={creerAdminForm.first_name} onChange={(e) => setCreerAdminForm({ ...creerAdminForm, first_name: e.target.value })} />
            <Input label="Nom" required value={creerAdminForm.last_name} onChange={(e) => setCreerAdminForm({ ...creerAdminForm, last_name: e.target.value })} />
          </div>
          <Input label="Identifiant" required value={creerAdminForm.username} onChange={(e) => setCreerAdminForm({ ...creerAdminForm, username: e.target.value })} />
          <Input label="Email (optionnel)" type="email" value={creerAdminForm.email} onChange={(e) => setCreerAdminForm({ ...creerAdminForm, email: e.target.value })} />
          <Input label="Téléphone (optionnel)" value={creerAdminForm.phone} onChange={(e) => setCreerAdminForm({ ...creerAdminForm, phone: e.target.value })} />
          <Input
            label="Mot de passe temporaire" type="text" required
            value={creerAdminForm.password} onChange={(e) => setCreerAdminForm({ ...creerAdminForm, password: e.target.value })}
          />
          <p className="text-xs text-slate-400 -mt-2">Le nouvel administrateur devra le changer à sa première connexion.</p>
          {creerAdminError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{creerAdminError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreerAdminOuvert(false)}>Annuler</Button>
            <Button type="submit" disabled={creerAdminSaving}>{creerAdminSaving ? "Création…" : "Créer le compte"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
