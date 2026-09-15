import { useEffect, useState, type FormEvent } from "react";

import { annoncesApi, classesApi, modelesMessageApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, DeleteButton, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { ClasseOptions } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import type { Annonce, Classe, ModeleMessage } from "../types";

const CIBLE_LABELS: Record<string, string> = {
  all: "Tout le monde", admin: "Administrateurs", teacher: "Enseignants", student: "Élèves", parent: "Parents",
};

/** Deux des 5 modèles personnalisables (voir Paramètres de l'école) n'ont pas de déclencheur
 * automatique dédié — "réunion des parents" et "résultats disponibles" sont de simples annonces
 * ponctuelles décidées par l'admin. Plutôt que construire un second système d'envoi, on les
 * propose ici comme pré-remplissage rapide du formulaire d'annonce (déjà capable d'e-mail/SMS). */
const MODELES_PRESETS: { cle: string; icone: string }[] = [
  { cle: "reunion_parents", icone: "📅" },
  { cle: "resultats_disponibles", icone: "🏆" },
];

const emptyForm = {
  titre: "", contenu: "", cible_role: "all", classe: "", epingle: false,
  envoyer_email: false, envoyer_sms: false,
};

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmer = useConfirm();
  const canPost = user?.role === "admin" || user?.role === "teacher";

  const [classes, setClasses] = useState<Classe[]>([]);
  const [modeles, setModeles] = useState<ModeleMessage[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { items, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<Annonce>(() => annoncesApi.list(), []);

  useEffect(() => {
    if (canPost) {
      classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
      modelesMessageApi.list().then(({ data }) => setModeles(unwrapList(data)));
    }
  }, [canPost]);

  const appliquerModele = (cle: string) => {
    const modele = modeles.find((m) => m.cle === cle);
    if (!modele) return;
    setForm((f) => ({
      ...f,
      titre: modele.sujet || modele.label,
      contenu: modele.contenu || f.contenu,
      cible_role: "parent",
      envoyer_email: true, envoyer_sms: true,
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await annoncesApi.create({
        ...form,
        cible_role: form.cible_role as Annonce["cible_role"],
        classe: form.classe ? Number(form.classe) : null,
      });
      setModalOpen(false);
      setForm(emptyForm);
      reload();
      if (data.resultat_envoi && (form.envoyer_email || form.envoyer_sms)) {
        const { emails_envoyes, sms_envoyes } = data.resultat_envoi;
        const parts = [];
        if (form.envoyer_email) parts.push(`${emails_envoyes} e-mail${emails_envoyes > 1 ? "s" : ""}`);
        if (form.envoyer_sms) parts.push(`${sms_envoyes} SMS`);
        toast.success(`Annonce publiée — envoyée à ${parts.join(" et ")}.`);
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (annonce: Annonce) => {
    if (!(await confirmer(`Supprimer l'annonce "${annonce.titre}" ?`, { danger: true }))) return;
    await annoncesApi.remove(annonce.id);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Annonces"
        description="Communications de l'établissement."
        actions={canPost ? <Button onClick={() => setModalOpen(true)}>+ Nouvelle annonce</Button> : undefined}
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucune annonce publiée" />
      ) : (
        <>
          <div className="space-y-4">
            {items.map((a) => (
              <Card key={a.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {a.epingle && <span title="Épinglé">📌</span>}
                      <h3 className="font-bold text-ink-900">{a.titre}</h3>
                      {a.envoyer_email && <span title="Envoyée par e-mail" className="text-xs">✉️</span>}
                      {a.envoyer_sms && <span title="Envoyée par SMS" className="text-xs">💬</span>}
                    </div>
                    <p className="text-slate-600 text-sm whitespace-pre-wrap">{a.contenu}</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                      <span>{a.auteur_nom || "Administration"}</span>
                      <span>·</span>
                      <span>{new Date(a.date_publication).toLocaleDateString("fr-FR")}</span>
                      {a.classe_nom && (<><span>·</span><span>{a.classe_nom}</span></>)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge color="brand">{CIBLE_LABELS[a.cible_role]}</Badge>
                    {canPost && <DeleteButton onClick={() => handleDelete(a)} size="sm" />}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" disabled={!hasPrevious} onClick={goPrevious}>← Précédent</Button>
            <Button variant="secondary" disabled={!hasNext} onClick={goNext}>Suivant →</Button>
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle annonce">
        <form onSubmit={handleSubmit} className="space-y-4">
          {modeles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {MODELES_PRESETS.map(({ cle, icone }) => {
                const modele = modeles.find((m) => m.cle === cle);
                if (!modele) return null;
                return (
                  <button
                    key={cle} type="button" onClick={() => appliquerModele(cle)}
                    className="text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-full px-3 py-1.5 transition"
                  >
                    {icone} Pré-remplir « {modele.label} »
                  </button>
                );
              })}
            </div>
          )}
          <Input label="Titre" required value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} />
          <label className="block">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Contenu</span>
            <textarea
              required rows={4} value={form.contenu} onChange={(e) => setForm({ ...form, contenu: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
            />
          </label>
          <Select label="Destinataires" value={form.cible_role} onChange={(e) => setForm({ ...form, cible_role: e.target.value })}>
            {Object.entries(CIBLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select label="Classe spécifique (optionnel)" value={form.classe} onChange={(e) => setForm({ ...form, classe: e.target.value })}>
            <option value="">— Toutes —</option>
            <ClasseOptions classes={classes} />
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.epingle} onChange={(e) => setForm({ ...form, epingle: e.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
            Épingler cette annonce
          </label>

          <div className="border-t border-slate-100 pt-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notifier aussi par</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox" checked={form.envoyer_email}
                onChange={(e) => setForm({ ...form, envoyer_email: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              />
              ✉️ E-mail
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox" checked={form.envoyer_sms}
                onChange={(e) => setForm({ ...form, envoyer_sms: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              />
              💬 SMS
            </label>
            <p className="text-xs text-slate-400">
              Envoyé immédiatement à tous les destinataires ciblés ci-dessus qui ont un e-mail/numéro enregistré.
            </p>
          </div>

          {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{error}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Publication…" : "Publier"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
