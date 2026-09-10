import { useEffect, useState, type FormEvent } from "react";

import { formulesApi, elevesApi, inscriptionsCantineApi, ticketsCantineApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { usePaginated } from "../hooks/usePaginated";
import type { EleveProfile, Formule, InscriptionCantine, TicketCantine } from "../types";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

const emptyFormuleForm = {
  nom: "", responsable_nom: "", responsable_telephone: "", prix: "", capacite: 100, heure_service: "", description: "",
};
const emptyInscriptionForm = { eleve: "", formule: "" };
const emptyTicketForm = { inscription: "", mois: new Date().toISOString().slice(0, 7), montant: "" };

export default function CantinePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const peutGererTickets = user?.role === "admin" || user?.role === "comptabilite";

  const [formules, setFormules] = useState<Formule[]>([]);
  const [tickets, setTickets] = useState<TicketCantine[]>([]);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketForm, setTicketForm] = useState(emptyTicketForm);
  const [ticketError, setTicketError] = useState("");
  const [ticketSaving, setTicketSaving] = useState(false);
  const [copiedFormuleId, setCopiedFormuleId] = useState<number | null>(null);
  const [loadingFormules, setLoadingFormules] = useState(true);
  const [formuleModalOpen, setFormuleModalOpen] = useState(false);
  const [editingFormule, setEditingFormule] = useState<Formule | null>(null);
  const [formuleForm, setFormuleForm] = useState(emptyFormuleForm);
  const [formuleError, setFormuleError] = useState("");
  const [formuleSaving, setFormuleSaving] = useState(false);

  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [inscriptionModalOpen, setInscriptionModalOpen] = useState(false);
  const [inscriptionForm, setInscriptionForm] = useState(emptyInscriptionForm);
  const [inscriptionError, setInscriptionError] = useState("");
  const [inscriptionSaving, setInscriptionSaving] = useState(false);

  const { items: inscriptions, loading: loadingInscriptions, reload: reloadInscriptions } = usePaginated<InscriptionCantine>(
    () => inscriptionsCantineApi.list({ page_size: 200 }), []
  );

  const loadFormules = () => {
    setLoadingFormules(true);
    formulesApi.list({ page_size: 100 }).then(({ data }) => setFormules(unwrapList(data))).finally(() => setLoadingFormules(false));
  };

  const loadTickets = () => {
    if (!peutGererTickets) return;
    ticketsCantineApi.list({ page_size: 200 }).then(({ data }) => setTickets(unwrapList(data)));
  };

  useEffect(loadFormules, []);
  useEffect(() => {
    if (isAdmin) elevesApi.list({ page_size: 500 }).then(({ data }) => setEleves(unwrapList(data)));
  }, [isAdmin]);
  useEffect(loadTickets, [peutGererTickets]);

  const handleCopyLien = (formule: Formule) => {
    if (!formule.lien_agent) return;
    navigator.clipboard?.writeText(formule.lien_agent).then(() => {
      setCopiedFormuleId(formule.id);
      setTimeout(() => setCopiedFormuleId(null), 2000);
    });
  };

  const handleRegenererLien = async (formule: Formule) => {
    if (!confirm("L'ancien lien agent cessera de fonctionner. Continuer ?")) return;
    await formulesApi.regenererLienAgent(formule.id);
    loadFormules();
  };

  const openTicketModal = (inscription?: InscriptionCantine) => {
    setTicketForm({ ...emptyTicketForm, inscription: inscription ? String(inscription.id) : "" });
    setTicketError("");
    setTicketModalOpen(true);
  };

  const handleTicketSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTicketSaving(true);
    setTicketError("");
    try {
      await ticketsCantineApi.create({
        inscription: Number(ticketForm.inscription), mois: `${ticketForm.mois}-01`, montant: ticketForm.montant,
      });
      setTicketModalOpen(false);
      loadTickets();
    } catch (err) {
      setTicketError(extractErrorMessage(err));
    } finally {
      setTicketSaving(false);
    }
  };

  const handleMarquerPaye = async (ticket: TicketCantine) => {
    await ticketsCantineApi.marquerPaye(ticket.id);
    loadTickets();
  };

  const openCreateFormule = () => {
    setEditingFormule(null);
    setFormuleForm(emptyFormuleForm);
    setFormuleError("");
    setFormuleModalOpen(true);
  };

  const openEditFormule = (formule: Formule) => {
    setEditingFormule(formule);
    setFormuleForm({
      nom: formule.nom, responsable_nom: formule.responsable_nom, responsable_telephone: formule.responsable_telephone,
      prix: formule.prix, capacite: formule.capacite, heure_service: formule.heure_service || "",
      description: formule.description,
    });
    setFormuleError("");
    setFormuleModalOpen(true);
  };

  const handleFormuleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormuleSaving(true);
    setFormuleError("");
    try {
      const payload = { ...formuleForm, heure_service: formuleForm.heure_service || null };
      if (editingFormule) await formulesApi.update(editingFormule.id, payload);
      else await formulesApi.create(payload);
      setFormuleModalOpen(false);
      loadFormules();
    } catch (err) {
      setFormuleError(extractErrorMessage(err));
    } finally {
      setFormuleSaving(false);
    }
  };

  const handleDeleteFormule = async (formule: Formule) => {
    if (!confirm(`Supprimer la formule "${formule.nom}" ?`)) return;
    await formulesApi.remove(formule.id);
    loadFormules();
  };

  const openInscriptionModal = (formule?: Formule) => {
    setInscriptionForm({ ...emptyInscriptionForm, formule: formule ? String(formule.id) : "" });
    setInscriptionError("");
    setInscriptionModalOpen(true);
  };

  const handleInscriptionSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setInscriptionSaving(true);
    setInscriptionError("");
    try {
      await inscriptionsCantineApi.create({
        eleve: Number(inscriptionForm.eleve), formule: Number(inscriptionForm.formule),
      });
      setInscriptionModalOpen(false);
      loadFormules();
      reloadInscriptions();
    } catch (err) {
      setInscriptionError(extractErrorMessage(err));
    } finally {
      setInscriptionSaving(false);
    }
  };

  const handleRemoveInscription = async (inscription: InscriptionCantine) => {
    if (!confirm(`Retirer ${inscription.eleve_nom} de cette formule ?`)) return;
    await inscriptionsCantineApi.remove(inscription.id);
    loadFormules();
    reloadInscriptions();
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Cantine scolaire"
        description="Gestion des formules de repas et des inscriptions des élèves."
        actions={isAdmin ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => openInscriptionModal()}>+ Inscrire un élève</Button>
            <Button onClick={openCreateFormule}>+ Nouvelle formule</Button>
          </div>
        ) : undefined}
      />

      <div>
        <h3 className="font-bold text-ink-900 mb-3">{isAdmin ? "Formules de repas" : "Ma formule"}</h3>
        {loadingFormules ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : formules.length === 0 ? (
          <EmptyState
            title={isAdmin ? "Aucune formule définie" : "Vous n'êtes inscrit à aucune formule de cantine"}
            description={isAdmin ? undefined : "Contactez l'administration de votre établissement."}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {formules.map((formule) => (
              <div key={formule.id} className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-bold text-ink-900">{formule.nom}</h4>
                  <Badge color={formule.effectif >= formule.capacite ? "rose" : "green"}>{formule.effectif}/{formule.capacite}</Badge>
                </div>
                <p className="text-sm text-slate-500">
                  🧑‍🍳 {formule.responsable_nom || "—"}
                  {formule.responsable_telephone && (
                    <> · <a href={`tel:${formule.responsable_telephone}`} className="text-brand-600 hover:underline">{formule.responsable_telephone}</a></>
                  )}
                </p>
                <p className="text-sm text-slate-500">💰 {money(formule.prix)}</p>
                {formule.heure_service && (
                  <p className="text-sm text-slate-500">🕐 {formule.heure_service.slice(0, 5)}</p>
                )}
                {formule.description && <p className="text-xs text-slate-400 mt-2">{formule.description}</p>}

                {isAdmin && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => handleCopyLien(formule)} className="font-semibold text-brand-600 hover:underline">
                        {copiedFormuleId === formule.id ? "✓ Lien copié" : "🔗 Copier le lien agent"}
                      </button>
                      <button onClick={() => handleRegenererLien(formule)} className="font-semibold text-slate-500 hover:underline">
                        🔄 Régénérer
                      </button>
                    </div>
                    <RowActions>
                      <EditButton onClick={() => openEditFormule(formule)} />
                      <DeleteButton onClick={() => handleDeleteFormule(formule)} />
                    </RowActions>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-bold text-ink-900 mb-3">{isAdmin ? "Élèves inscrits" : "Ma cantine"}</h3>
        {loadingInscriptions ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : inscriptions.length === 0 ? (
          <EmptyState title="Aucune inscription enregistrée" />
        ) : (
          <Table headers={["Élève", "Classe", "Formule", ...(isAdmin || peutGererTickets ? ["Actions"] : [])]}>
            {inscriptions.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{i.eleve_nom}</td>
                <td className="px-4 py-3">{i.classe_nom || "—"}</td>
                <td className="px-4 py-3">{i.formule_nom}</td>
                {(isAdmin || peutGererTickets) && (
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      {peutGererTickets && (
                        <button onClick={() => openTicketModal(i)} className="text-brand-600 hover:underline text-sm">🎫 Ticket</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => handleRemoveInscription(i)} className="text-rose-600 hover:underline text-sm">Retirer</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </div>

      {peutGererTickets && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-ink-900">Tickets de cantine</h3>
            <Button variant="secondary" onClick={() => openTicketModal()}>+ Nouveau ticket</Button>
          </div>
          {tickets.length === 0 ? (
            <EmptyState title="Aucun ticket émis" />
          ) : (
            <Table headers={["Élève", "Formule", "Mois", "Montant", "Statut", "Actions"]}>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium text-slate-700">{t.eleve_nom}</td>
                  <td className="px-4 py-3">{t.formule_nom}</td>
                  <td className="px-4 py-3">{new Date(t.mois).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</td>
                  <td className="px-4 py-3">{money(t.montant)}</td>
                  <td className="px-4 py-3"><Badge color={t.paye ? "green" : "amber"}>{t.paye ? "Payé" : "En attente"}</Badge></td>
                  <td className="px-4 py-3">
                    {!t.paye && <button onClick={() => handleMarquerPaye(t)} className="text-xs font-semibold text-emerald-600 hover:underline">Marquer payé</button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}

      <Modal open={formuleModalOpen} onClose={() => setFormuleModalOpen(false)} title={editingFormule ? "Modifier la formule" : "Nouvelle formule"}>
        <form onSubmit={handleFormuleSubmit} className="space-y-4">
          <Input label="Nom de la formule" required value={formuleForm.nom} onChange={(e) => setFormuleForm({ ...formuleForm, nom: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Responsable" value={formuleForm.responsable_nom} onChange={(e) => setFormuleForm({ ...formuleForm, responsable_nom: e.target.value })} />
            <Input
              label="Téléphone du responsable" value={formuleForm.responsable_telephone}
              onChange={(e) => setFormuleForm({ ...formuleForm, responsable_telephone: e.target.value })}
              placeholder="Visible par les élèves/parents inscrits"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Prix (GNF)" type="number" min={0} required value={formuleForm.prix} onChange={(e) => setFormuleForm({ ...formuleForm, prix: e.target.value })} />
            <Input label="Capacité" type="number" min={1} required value={formuleForm.capacite} onChange={(e) => setFormuleForm({ ...formuleForm, capacite: Number(e.target.value) })} />
          </div>
          <Input label="Heure de service" type="time" value={formuleForm.heure_service} onChange={(e) => setFormuleForm({ ...formuleForm, heure_service: e.target.value })} />
          <Input label="Description" value={formuleForm.description} onChange={(e) => setFormuleForm({ ...formuleForm, description: e.target.value })} />

          {formuleError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{formuleError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setFormuleModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={formuleSaving}>{formuleSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={inscriptionModalOpen} onClose={() => setInscriptionModalOpen(false)} title="Inscrire un élève à une formule">
        <form onSubmit={handleInscriptionSubmit} className="space-y-4">
          <Select label="Élève" required value={inscriptionForm.eleve} onChange={(e) => setInscriptionForm({ ...inscriptionForm, eleve: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {eleves.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
          </Select>
          <Select label="Formule" required value={inscriptionForm.formule} onChange={(e) => setInscriptionForm({ ...inscriptionForm, formule: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {formules.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </Select>

          {inscriptionError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{inscriptionError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setInscriptionModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={inscriptionSaving}>{inscriptionSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={ticketModalOpen} onClose={() => setTicketModalOpen(false)} title="Nouveau ticket de cantine">
        <form onSubmit={handleTicketSubmit} className="space-y-4">
          <Select label="Élève inscrit" required value={ticketForm.inscription} onChange={(e) => setTicketForm({ ...ticketForm, inscription: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {inscriptions.map((i) => <option key={i.id} value={i.id}>{i.eleve_nom} — {i.formule_nom}</option>)}
          </Select>
          <Input label="Mois couvert" type="month" required value={ticketForm.mois} onChange={(e) => setTicketForm({ ...ticketForm, mois: e.target.value })} />
          <Input label="Montant (GNF)" type="number" min={0} required value={ticketForm.montant} onChange={(e) => setTicketForm({ ...ticketForm, montant: e.target.value })} />

          {ticketError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{ticketError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setTicketModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={ticketSaving}>{ticketSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
