import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { rechercheGlobaleApi } from "../api/services";
import { Badge, EmptyState, Input, PageHeader, Spinner, Table } from "../components/ui";
import type { RechercheGlobaleResult } from "../types";

const ROLE_COLORS: Record<string, "brand" | "teal" | "amber" | "rose" | "slate"> = {
  admin: "brand", teacher: "teal", student: "amber", parent: "rose", comptabilite: "teal", surveillance: "slate",
};

export default function RechercheGlobalePage() {
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<RechercheGlobaleResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    try {
      const { data } = await rechercheGlobaleApi.chercher(q.trim());
      setResultats(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Recherche globale"
        description="Retrouvez un compte (élève, enseignant, parent, admin...) sur toutes les écoles de la plateforme."
      />

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6 max-w-xl">
        <Input
          placeholder="Nom, identifiant ou email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1"
        />
        <button type="submit" className="bg-brand-600 text-white font-semibold text-sm rounded-xl px-5 disabled:opacity-50" disabled={q.trim().length < 2}>
          Rechercher
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : resultats === null ? (
        <EmptyState title="Lancez une recherche" description="Au moins 2 caractères — nom, identifiant ou email." />
      ) : resultats.length === 0 ? (
        <EmptyState title="Aucun résultat" />
      ) : (
        <Table headers={["Nom", "Identifiant", "Email", "Rôle", "École", "Statut", "Dernière connexion"]}>
          {resultats.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 font-medium text-slate-700">{r.full_name}</td>
              <td className="px-4 py-3 text-xs font-mono text-slate-500">{r.username}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">{r.email || "—"}</td>
              <td className="px-4 py-3"><Badge color={ROLE_COLORS[r.role] || "slate"}>{r.role_display}</Badge></td>
              <td className="px-4 py-3">
                {r.ecole_id ? <Link to={`/ecoles/${r.ecole_id}`} className="text-brand-600 hover:underline">{r.ecole_nom}</Link> : "—"}
              </td>
              <td className="px-4 py-3"><Badge color={r.is_active ? "green" : "rose"}>{r.is_active ? "Actif" : "Désactivé"}</Badge></td>
              <td className="px-4 py-3 text-slate-500 text-xs">{r.last_login ? new Date(r.last_login).toLocaleString("fr-FR") : "Jamais connecté"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
