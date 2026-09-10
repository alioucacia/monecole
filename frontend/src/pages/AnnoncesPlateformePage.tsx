import { useEffect, useState, type FormEvent } from "react";

import { annoncesPlateformeApi, ecolesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, DeleteButton, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { usePaginated } from "../hooks/usePaginated";
import type { Annonce, Ecole } from "../types";

const CIBLE_LABELS: Record<string, string> = {
  all: "Tout le monde", admin: "Administrateurs", teacher: "Enseignants", student: "Élèves", parent: "Parents",
};

const emptyForm = { titre: "", contenu: "", cible_role: "all", ecole: "", epingle: false, envoyer_email: false, envoyer_sms: false };

export default function AnnoncesPlateformePage() {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [ecoles, setEcoles] = useState<Ecole[]>([]);

  useEffect(() => {
    ecolesApi.list({ page_size: 500 }).then(({ data }) => setEcoles(unwrapList(data)));
  }, []);

  const { items, loading, hasNext, hasPrevious, goNext, goPrevious, reload } = usePaginated<Annonce>(() => annoncesPlateformeApi.list(), []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await annoncesPlateformeApi.create({
        ...form,
        cible_role: form.cible_role as Annonce["cible_role"],
        ecole: form.ecole ? Number(form.ecole) : null,
      });
      setModalOpen(false);
      setForm(emptyForm);
      reload();
      toast.success("Annonce publiée.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (annonce: Annonce) => {
    if (!confirm(`Supprimer l'annonce plateforme "${annonce.titre}" ?`)) return;
    try {
      await annoncesPlateformeApi.remove(annonce.id);
      reload();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Annonces plateforme"
        description="Diffusées à toutes les écoles clientes (ou à une seule, au choix), en plus de leurs propres annonces internes."
        actions={<Button onClick={() => setModalOpen(true)}>+ Nouvelle annonce</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Aucune annonce plateforme publiée" />
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
                    </div>
                    <p className="text-slate-600 text-sm whitespace-pre-wrap">{a.contenu}</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                      <span>{a.auteur_nom || "Super Admin"}</span>
                      <span>·</span>
                      <span>{new Date(a.date_publication).toLocaleDateString("fr-FR")}</span>
                      {(a.envoyer_email || a.envoyer_sms) && (
                        <>
                          <span>·</span>
                          <span>
                            Envoyé par {[a.envoyer_email && "e-mail", a.envoyer_sms && "SMS"].filter(Boolean).join(" + ")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge color={a.ecole_nom ? "amber" : "brand"}>{a.ecole_nom || "Toutes les écoles"}</Badge>
                    <Badge color="slate">{CIBLE_LABELS[a.cible_role]}</Badge>
                    <DeleteButton onClick={() => handleDelete(a)} size="sm" />
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle annonce plateforme">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Titre" required value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} />
          <label className="block">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Contenu</span>
            <textarea
              required rows={4} value={form.contenu} onChange={(e) => setForm({ ...form, contenu: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Destinataires (rôle)" value={form.cible_role} onChange={(e) => setForm({ ...form, cible_role: e.target.value })}>
              {Object.entries(CIBLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Select label="École ciblée" value={form.ecole} onChange={(e) => setForm({ ...form, ecole: e.target.value })}>
              <option value="">Toutes les écoles</option>
              {ecoles.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </Select>
          </div>

          <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Canaux additionnels</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.envoyer_email} onChange={(e) => setForm({ ...form, envoyer_email: e.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
              Envoyer aussi par e-mail
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.envoyer_sms} onChange={(e) => setForm({ ...form, envoyer_sms: e.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
              Envoyer aussi par SMS
            </label>
            {(form.envoyer_email || form.envoyer_sms) && (
              <p className="text-xs text-amber-600">
                ⚠️ L'envoi se fait immédiatement à la publication, à tous les destinataires concernés — irréversible.
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.epingle} onChange={(e) => setForm({ ...form, epingle: e.target.checked })} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
            Épingler cette annonce
          </label>

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Publication…" : "Publier"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
