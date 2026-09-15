import { useEffect, useState, type FormEvent } from "react";

import { usersApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import type { JournalUtilisateurEntry, Role, User } from "../types";

const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Super Admin", admin: "Administrateur", teacher: "Enseignant", student: "Élève",
  parent: "Parent", comptabilite: "Comptabilité", surveillance: "Surveillance",
};

const ROLE_COLORS: Record<Role, "brand" | "teal" | "amber" | "rose" | "slate"> = {
  superadmin: "brand", admin: "brand", teacher: "teal", student: "amber", parent: "rose",
  comptabilite: "teal", surveillance: "slate",
};

const CATEGORIE_LABELS: Record<JournalUtilisateurEntry["categorie"], "brand" | "teal" | "amber" | "rose" | "slate"> = {
  connexion: "slate", compte: "rose", eleve: "amber", enseignant: "teal", note: "brand", paiement: "teal",
};

// Intervalle de rafraîchissement automatique de la modale Historique, tant qu'elle est
// ouverte — donne un suivi « en temps réel » des mouvements d'un compte sans WebSocket (le
// projet n'a aujourd'hui aucune infra temps réel, voir backend/DEPLOYMENT.md).
const HISTORIQUE_REFRESH_MS = 8000;

/** Annuaire des comptes de l'établissement de l'Administrateur connecté (tous rôles
 * confondus) — permet notamment de réinitialiser le mot de passe de n'importe quel
 * utilisateur de son école, sans passer par chaque page de gestion dédiée. */
export default function ComptesEcolePage() {
  const toast = useToast();
  const confirmer = useConfirm();
  const { user: moi } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statutFilter, setStatutFilter] = useState("");

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ mot_de_passe: string; email_envoye: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // Modification des coordonnées d'un compte (utile notamment pour corriger les infos d'un
  // parent après coup — création d'un nouveau compte parent depuis la fiche élève ne permet
  // de les saisir qu'une fois, à la création). Passe par le même endpoint DRF (`/auth/users/`,
  // `UserViewSet`) que le reste de la plateforme, réservé à l'admin de l'école concernée.
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ first_name: "", last_name: "", email: "", phone: "", address: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Historique d'un compte (connexions + actions clés) — voir handlers plus bas.
  const [historiqueTarget, setHistoriqueTarget] = useState<User | null>(null);
  const [historiqueEntries, setHistoriqueEntries] = useState<JournalUtilisateurEntry[]>([]);
  const [historiqueLoading, setHistoriqueLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const { items, count, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<User>(
    () => usersApi.list({
      search: search || undefined,
      role: roleFilter || undefined,
      is_active: statutFilter || undefined,
      ordering: "-date_joined",
    }),
    [search, roleFilter, statutFilter]
  );

  const openEdit = (u: User) => {
    setEditTarget(u);
    setEditForm({
      first_name: u.first_name, last_name: u.last_name,
      email: u.email, phone: u.phone, address: u.address,
    });
    setEditError("");
  };

  const handleSubmitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    setEditError("");
    try {
      await usersApi.update(editTarget.id, editForm);
      setEditTarget(null);
      toast.success("Coordonnées mises à jour.");
      reload();
    } catch (err) {
      setEditError(extractErrorMessage(err));
    } finally {
      setEditSaving(false);
    }
  };

  const openReset = (u: User) => {
    setResetTarget(u);
    setResetResult(null);
    setCopied(false);
  };

  const handleConfirmReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const { data } = await usersApi.reinitialiserMotDePasse(resetTarget.id);
      setResetResult({ mot_de_passe: data.nouveau_mot_de_passe, email_envoye: data.email_envoye });
    } catch (err) {
      toast.error(extractErrorMessage(err));
      setResetTarget(null);
    } finally {
      setResetting(false);
    }
  };

  const handleCopy = async () => {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.mot_de_passe);
      setCopied(true);
      toast.success("Mot de passe copié.");
    } catch {
      toast.error("Impossible de copier automatiquement — sélectionnez-le manuellement.");
    }
  };

  // Tous les rôles sauf élève : un élève se supprime depuis sa page dédiée (StudentsPage), qui
  // affiche le contexte propre à cette suppression (dossier scolaire, frais, notes...) — les
  // parents, eux, n'ont pas de page de gestion dédiée (ils sont créés en marge d'un élève, mais
  // gérés comme n'importe quel autre compte ensuite) : c'est ici, et seulement ici, qu'un admin
  // peut supprimer un compte parent.
  const ROLES_SUPPRIMABLES_ICI: Role[] = ["admin", "teacher", "comptabilite", "surveillance", "parent"];
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (u: User) => {
    const avertissementParent = u.role === "parent" ? " (le dossier de ses enfants n'est pas affecté, seul son propre accès au portail l'est)" : "";
    if (!(await confirmer(`Supprimer définitivement le compte de ${u.full_name || u.username} (${ROLE_LABELS[u.role]})${avertissementParent} ? Cette action est irréversible.`, { danger: true }))) return;
    setDeletingId(u.id);
    try {
      await usersApi.remove(u.id);
      toast.success("Compte supprimé.");
      reload();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActif = async (u: User) => {
    setTogglingId(u.id);
    try {
      await usersApi.update(u.id, { is_active: !u.is_active });
      toast.success(u.is_active ? "Compte désactivé." : "Compte réactivé.");
      reload();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  };

  const openHistorique = (u: User) => {
    setHistoriqueEntries([]);
    setHistoriqueTarget(u);
  };

  // Rafraîchissement automatique tant que la modale est ouverte (voir HISTORIQUE_REFRESH_MS) —
  // c'est le suivi « en temps réel » des mouvements d'un compte. Le premier chargement affiche
  // le spinner ; les rafraîchissements suivants remplacent la liste sans clignoter.
  useEffect(() => {
    if (!historiqueTarget) return;
    let annule = false;
    const charger = (premierChargement: boolean) => {
      if (premierChargement) setHistoriqueLoading(true);
      usersApi.journal(historiqueTarget.id, { page_size: 50 })
        .then(({ data }) => { if (!annule) setHistoriqueEntries(data.results); })
        .finally(() => { if (!annule && premierChargement) setHistoriqueLoading(false); });
    };
    charger(true);
    const intervalId = setInterval(() => charger(false), HISTORIQUE_REFRESH_MS);
    return () => { annule = true; clearInterval(intervalId); };
  }, [historiqueTarget]);

  return (
    <div>
      <PageHeader
        title="Comptes de l'établissement"
        description={`Tous les comptes de votre école, tous rôles confondus${count !== null ? ` (${count})` : ""}.`}
      />

      <div className="flex flex-wrap gap-3 mb-5">
        <Input
          placeholder="Rechercher un nom, e-mail, identifiant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px]"
        />
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-auto">
          <option value="">Tous les rôles</option>
          {Object.entries(ROLE_LABELS).filter(([v]) => v !== "superadmin").map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} className="w-auto">
          <option value="">Tous les statuts</option>
          <option value="true">Actif</option>
          <option value="false">Désactivé</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun compte trouvé" description="Essayez d'élargir vos filtres." />
      ) : (
        <>
          <Table headers={["Nom", "Identifiant", "Rôle", "E-mail", "Statut", "Dernière connexion", "Actions"]}>
            {items.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{u.full_name || u.username}</td>
                <td className="px-4 py-3 text-xs font-mono text-slate-400">{u.username}</td>
                <td className="px-4 py-3"><Badge color={ROLE_COLORS[u.role]}>{u.role_display}</Badge></td>
                <td className="px-4 py-3 text-slate-500 text-xs">{u.email || "—"}</td>
                <td className="px-4 py-3">
                  <Badge color={u.is_active ? "green" : "slate"}>{u.is_active ? "Actif" : "Désactivé"}</Badge>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {u.en_ligne && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold mr-2" title="En ligne actuellement">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                      En ligne
                    </span>
                  )}
                  {u.last_login ? new Date(u.last_login).toLocaleString("fr-FR") : "Jamais connecté"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => openEdit(u)} className="text-xs font-semibold text-brand-600 hover:underline whitespace-nowrap">
                      ✏️ Modifier
                    </button>
                    <button onClick={() => openReset(u)} className="text-xs font-semibold text-brand-600 hover:underline whitespace-nowrap">
                      🔑 Réinitialiser
                    </button>
                    <button onClick={() => openHistorique(u)} className="text-xs font-semibold text-brand-600 hover:underline whitespace-nowrap">
                      🕘 Historique
                    </button>
                    {u.id !== moi?.id && (
                      <button
                        onClick={() => handleToggleActif(u)}
                        disabled={togglingId === u.id}
                        className={`text-xs font-semibold hover:underline whitespace-nowrap disabled:opacity-50 ${u.is_active ? "text-rose-600" : "text-emerald-600"}`}
                      >
                        {togglingId === u.id ? "…" : u.is_active ? "🚫 Désactiver" : "✓ Réactiver"}
                      </button>
                    )}
                    {u.id !== moi?.id && ROLES_SUPPRIMABLES_ICI.includes(u.role) && (
                      <button
                        onClick={() => handleDelete(u)}
                        disabled={deletingId === u.id}
                        className="text-xs font-semibold text-rose-600 hover:underline whitespace-nowrap disabled:opacity-50"
                      >
                        {deletingId === u.id ? "…" : "🗑️ Supprimer"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>

          <div className="flex justify-end gap-2 mt-4">
            <button
              disabled={!hasPrevious} onClick={goPrevious}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 disabled:opacity-40"
            >
              ← Précédent
            </button>
            <button
              disabled={!hasNext} onClick={goNext}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 disabled:opacity-40"
            >
              Suivant →
            </button>
          </div>
        </>
      )}

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={resetResult ? "Mot de passe réinitialisé" : "Réinitialiser le mot de passe"}
      >
        {resetTarget && !resetResult && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Générer un nouveau mot de passe temporaire pour{" "}
              <span className="font-semibold text-slate-800">{resetTarget.full_name || resetTarget.username}</span>
              {" "}({ROLE_LABELS[resetTarget.role]}) ? L'ancien mot de passe cessera immédiatement de fonctionner.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>Annuler</Button>
              <Button type="button" onClick={handleConfirmReset} disabled={resetting}>
                {resetting ? "Génération…" : "Réinitialiser"}
              </Button>
            </div>
          </div>
        )}

        {resetTarget && resetResult && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Nouveau mot de passe pour <span className="font-semibold text-slate-800">{resetTarget.full_name || resetTarget.username}</span> :
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-mono text-ink-900 select-all">
                {resetResult.mot_de_passe}
              </code>
              <Button type="button" variant="secondary" onClick={handleCopy}>{copied ? "✓ Copié" : "Copier"}</Button>
            </div>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5">
              ⚠️ Ce mot de passe ne sera plus jamais affiché — notez-le maintenant.
              {resetResult.email_envoye
                ? " Il a aussi été envoyé par e-mail à cet utilisateur."
                : " L'envoi par e-mail a échoué ou aucune adresse n'est enregistrée : transmettez-le vous-même."}
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setResetTarget(null)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Modifier les coordonnées">
        {editTarget && (
          <form onSubmit={handleSubmitEdit} className="space-y-4">
            <p className="text-sm text-slate-500">
              {editTarget.full_name || editTarget.username} — <span className="font-medium">{ROLE_LABELS[editTarget.role]}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Prénom" required value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
              <Input label="Nom" required value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
            </div>
            <Input label="Email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <Input label="Téléphone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            <Input label="Adresse" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            {editError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{editError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={editSaving}>{editSaving ? "Enregistrement…" : "Enregistrer"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!historiqueTarget}
        onClose={() => setHistoriqueTarget(null)}
        title={historiqueTarget ? `Historique — ${historiqueTarget.full_name || historiqueTarget.username}` : "Historique"}
      >
        {historiqueTarget && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Connexions et actions clés de ce compte — mis à jour automatiquement toutes les {HISTORIQUE_REFRESH_MS / 1000} secondes.
            </p>
            {historiqueLoading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : historiqueEntries.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">Aucune activité enregistrée pour ce compte.</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100 -mx-1">
                {historiqueEntries.map((entree) => (
                  <li key={entree.id} className="flex items-start justify-between gap-3 px-1 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700">{entree.description}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(entree.horodatage).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                        {entree.adresse_ip && ` · ${entree.adresse_ip}`}
                        {entree.appareil && ` · ${entree.appareil}`}
                      </p>
                    </div>
                    <Badge color={CATEGORIE_LABELS[entree.categorie]}>{entree.categorie_display}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end pt-2">
              <Button type="button" variant="secondary" onClick={() => setHistoriqueTarget(null)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
