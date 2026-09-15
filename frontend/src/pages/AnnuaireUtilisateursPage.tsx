import { useEffect, useState } from "react";

import { annuaireUtilisateursApi, ecolesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import type { Ecole, EleveProfile, Role, User } from "../types";

const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Super Admin", admin: "Administrateur", teacher: "Enseignant", student: "Élève",
  parent: "Parent", comptabilite: "Comptabilité", surveillance: "Surveillance",
};

const ROLE_COLORS: Record<Role, "brand" | "teal" | "amber" | "rose" | "slate"> = {
  superadmin: "brand", admin: "brand", teacher: "teal", student: "amber", parent: "rose",
  comptabilite: "teal", surveillance: "slate",
};

export default function AnnuaireUtilisateursPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [ecoleFilter, setEcoleFilter] = useState("");
  const [statutFilter, setStatutFilter] = useState("");
  const [enLigneSeulement, setEnLigneSeulement] = useState(false);
  const [ecoles, setEcoles] = useState<Ecole[]>([]);

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ mot_de_passe: string; email_envoye: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // Élèves rattachés à un parent (voir AnnuaireUtilisateursViewSet.enfants côté backend) — le
  // parent se retrouve typiquement via la recherche par téléphone (search_fields inclut "phone").
  const [enfantsTarget, setEnfantsTarget] = useState<User | null>(null);
  const [enfants, setEnfants] = useState<EleveProfile[]>([]);
  const [enfantsLoading, setEnfantsLoading] = useState(false);

  useEffect(() => {
    ecolesApi.list({ page_size: 500 }).then(({ data }) => setEcoles(unwrapList(data)));
  }, []);

  const { items, count, loading, hasNext, hasPrevious, goNext, goPrevious } = usePaginated<User>(
    () => annuaireUtilisateursApi.list({
      search: search || undefined,
      role: roleFilter || undefined,
      ecole: ecoleFilter || undefined,
      is_active: statutFilter || undefined,
      en_ligne: enLigneSeulement ? "true" : undefined,
      ordering: "-date_joined",
    }),
    [search, roleFilter, ecoleFilter, statutFilter, enLigneSeulement]
  );

  const openReset = (u: User) => {
    setResetTarget(u);
    setResetResult(null);
    setCopied(false);
  };

  const handleConfirmReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const { data } = await annuaireUtilisateursApi.reinitialiserMotDePasse(resetTarget.id);
      setResetResult({ mot_de_passe: data.nouveau_mot_de_passe, email_envoye: data.email_envoye });
    } catch (err) {
      toast.error(extractErrorMessage(err));
      setResetTarget(null);
    } finally {
      setResetting(false);
    }
  };

  const openEnfants = async (u: User) => {
    setEnfantsTarget(u);
    setEnfantsLoading(true);
    try {
      const { data } = await annuaireUtilisateursApi.enfants(u.id);
      setEnfants(data);
    } catch (err) {
      toast.error(extractErrorMessage(err));
      setEnfantsTarget(null);
    } finally {
      setEnfantsLoading(false);
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

  return (
    <div>
      <PageHeader
        title="Annuaire des utilisateurs"
        description={`Tous les comptes de la plateforme, toutes écoles confondues${count !== null ? ` (${count})` : ""}.`}
      />

      <div className="flex flex-wrap gap-3 mb-5">
        <Input
          placeholder="Rechercher un nom, e-mail, identifiant, téléphone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px]"
        />
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-auto">
          <option value="">Tous les rôles</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select value={ecoleFilter} onChange={(e) => setEcoleFilter(e.target.value)} className="w-auto">
          <option value="">Toutes les écoles</option>
          {ecoles.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </Select>
        <Select value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)} className="w-auto">
          <option value="">Tous les statuts</option>
          <option value="true">Actif</option>
          <option value="false">Désactivé</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white cursor-pointer">
          <input
            type="checkbox" checked={enLigneSeulement}
            onChange={(e) => setEnLigneSeulement(e.target.checked)}
            className="rounded border-slate-300 accent-emerald-600"
          />
          🟢 En ligne seulement
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucun utilisateur trouvé" description="Essayez d'élargir vos filtres." />
      ) : (
        <>
          <Table headers={["Nom", "Identifiant", "Rôle", "École", "E-mail", "Statut", "Dernière connexion", "Actions"]}>
            {items.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{u.full_name || u.username}</td>
                <td className="px-4 py-3 text-xs font-mono text-slate-400">{u.username}</td>
                <td className="px-4 py-3"><Badge color={ROLE_COLORS[u.role]}>{u.role_display}</Badge></td>
                <td className="px-4 py-3 text-slate-500">{u.ecole_nom || "—"}</td>
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
                  <div className="flex flex-col items-start gap-1">
                    <button onClick={() => openReset(u)} className="text-xs font-semibold text-brand-600 hover:underline whitespace-nowrap">
                      🔑 Réinitialiser
                    </button>
                    {u.role === "parent" && (
                      <button onClick={() => openEnfants(u)} className="text-xs font-semibold text-teal-600 hover:underline whitespace-nowrap">
                        👶 Voir les enfants
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
              {" "}({ROLE_LABELS[resetTarget.role]}{resetTarget.ecole_nom ? ` — ${resetTarget.ecole_nom}` : ""}) ?
              L'ancien mot de passe cessera immédiatement de fonctionner.
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

      <Modal
        open={!!enfantsTarget}
        onClose={() => setEnfantsTarget(null)}
        title={`Enfants de ${enfantsTarget?.full_name || enfantsTarget?.username || ""}`}
      >
        {enfantsLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : enfants.length === 0 ? (
          <EmptyState title="Aucun élève rattaché" description="Ce compte parent n'est relié à aucun dossier élève." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {enfants.map((el) => (
              <li key={el.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{el.user.first_name} {el.user.last_name}</p>
                  <p className="text-xs text-slate-400 font-mono">{el.matricule}</p>
                </div>
                <Badge color={el.actif ? "green" : "slate"}>{el.classe_nom || "Sans classe"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
