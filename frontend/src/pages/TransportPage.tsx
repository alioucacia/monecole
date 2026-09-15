import { useEffect, useState, type FormEvent } from "react";

import { affectationsTransportApi, elevesApi, ticketsBusApi, trajetsApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, DeleteButton, EditButton, EmptyState, Input, Modal, PageHeader, RowActions, Select, Spinner, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { usePaginated } from "../hooks/usePaginated";
import type { AffectationTransport, EleveProfile, TicketBus, Trajet } from "../types";

function money(value: number | string) {
  return `${Number(value).toLocaleString("fr-FR")} GNF`;
}

const emptyTrajetForm = {
  nom: "", chauffeur_nom: "", chauffeur_telephone: "", vehicule_immatriculation: "", capacite: 30,
  heure_depart: "", heure_retour: "", description: "",
};
const emptyAffectationForm = { eleve: "", trajet: "", point_montee: "" };
const emptyTicketForm = { affectation: "", mois: new Date().toISOString().slice(0, 7), montant: "" };

export default function TransportPage() {
  const { user } = useAuth();
  const confirmer = useConfirm();
  const isAdmin = user?.role === "admin";
  const peutGererTickets = user?.role === "admin" || user?.role === "comptabilite";

  const [trajets, setTrajets] = useState<Trajet[]>([]);
  const [tickets, setTickets] = useState<TicketBus[]>([]);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketForm, setTicketForm] = useState(emptyTicketForm);
  const [ticketError, setTicketError] = useState("");
  const [ticketSaving, setTicketSaving] = useState(false);
  const [copiedTrajetId, setCopiedTrajetId] = useState<number | null>(null);
  const [loadingTrajets, setLoadingTrajets] = useState(true);
  const [trajetModalOpen, setTrajetModalOpen] = useState(false);
  const [editingTrajet, setEditingTrajet] = useState<Trajet | null>(null);
  const [trajetForm, setTrajetForm] = useState(emptyTrajetForm);
  const [trajetError, setTrajetError] = useState("");
  const [trajetSaving, setTrajetSaving] = useState(false);

  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [affectationModalOpen, setAffectationModalOpen] = useState(false);
  const [affectationForm, setAffectationForm] = useState(emptyAffectationForm);
  const [affectationError, setAffectationError] = useState("");
  const [affectationSaving, setAffectationSaving] = useState(false);

  const { items: affectations, loading: loadingAffectations, reload: reloadAffectations } = usePaginated<AffectationTransport>(
    () => affectationsTransportApi.list({ page_size: 200 }), []
  );

  const loadTrajets = () => {
    setLoadingTrajets(true);
    trajetsApi.list({ page_size: 100 }).then(({ data }) => setTrajets(unwrapList(data))).finally(() => setLoadingTrajets(false));
  };

  const loadTickets = () => {
    if (!peutGererTickets) return;
    ticketsBusApi.list({ page_size: 200 }).then(({ data }) => setTickets(unwrapList(data)));
  };

  useEffect(loadTrajets, []);
  useEffect(() => {
    if (isAdmin) elevesApi.list({ page_size: 500 }).then(({ data }) => setEleves(unwrapList(data)));
  }, [isAdmin]);
  useEffect(loadTickets, [peutGererTickets]);

  const handleCopyLien = (trajet: Trajet) => {
    if (!trajet.lien_chauffeur) return;
    navigator.clipboard?.writeText(trajet.lien_chauffeur).then(() => {
      setCopiedTrajetId(trajet.id);
      setTimeout(() => setCopiedTrajetId(null), 2000);
    });
  };

  const handleRegenererLien = async (trajet: Trajet) => {
    if (!(await confirmer("L'ancien lien chauffeur cessera de fonctionner. Continuer ?"))) return;
    await trajetsApi.regenererLienChauffeur(trajet.id);
    loadTrajets();
  };

  const openTicketModal = (affectation?: AffectationTransport) => {
    setTicketForm({ ...emptyTicketForm, affectation: affectation ? String(affectation.id) : "" });
    setTicketError("");
    setTicketModalOpen(true);
  };

  const handleTicketSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTicketSaving(true);
    setTicketError("");
    try {
      await ticketsBusApi.create({
        affectation: Number(ticketForm.affectation), mois: `${ticketForm.mois}-01`, montant: ticketForm.montant,
      });
      setTicketModalOpen(false);
      loadTickets();
    } catch (err) {
      setTicketError(extractErrorMessage(err));
    } finally {
      setTicketSaving(false);
    }
  };

  const handleMarquerPaye = async (ticket: TicketBus) => {
    await ticketsBusApi.marquerPaye(ticket.id);
    loadTickets();
  };

  const openCreateTrajet = () => {
    setEditingTrajet(null);
    setTrajetForm(emptyTrajetForm);
    setTrajetError("");
    setTrajetModalOpen(true);
  };

  const openEditTrajet = (trajet: Trajet) => {
    setEditingTrajet(trajet);
    setTrajetForm({
      nom: trajet.nom, chauffeur_nom: trajet.chauffeur_nom, chauffeur_telephone: trajet.chauffeur_telephone,
      vehicule_immatriculation: trajet.vehicule_immatriculation,
      capacite: trajet.capacite, heure_depart: trajet.heure_depart || "", heure_retour: trajet.heure_retour || "",
      description: trajet.description,
    });
    setTrajetError("");
    setTrajetModalOpen(true);
  };

  const handleTrajetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTrajetSaving(true);
    setTrajetError("");
    try {
      const payload = { ...trajetForm, heure_depart: trajetForm.heure_depart || null, heure_retour: trajetForm.heure_retour || null };
      if (editingTrajet) await trajetsApi.update(editingTrajet.id, payload);
      else await trajetsApi.create(payload);
      setTrajetModalOpen(false);
      loadTrajets();
    } catch (err) {
      setTrajetError(extractErrorMessage(err));
    } finally {
      setTrajetSaving(false);
    }
  };

  const handleDeleteTrajet = async (trajet: Trajet) => {
    if (!(await confirmer(`Supprimer le trajet "${trajet.nom}" ?`, { danger: true }))) return;
    await trajetsApi.remove(trajet.id);
    loadTrajets();
  };

  const openAffectationModal = (trajet?: Trajet) => {
    setAffectationForm({ ...emptyAffectationForm, trajet: trajet ? String(trajet.id) : "" });
    setAffectationError("");
    setAffectationModalOpen(true);
  };

  const handleAffectationSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAffectationSaving(true);
    setAffectationError("");
    try {
      await affectationsTransportApi.create({
        eleve: Number(affectationForm.eleve), trajet: Number(affectationForm.trajet),
        point_montee: affectationForm.point_montee,
      });
      setAffectationModalOpen(false);
      loadTrajets();
      reloadAffectations();
    } catch (err) {
      setAffectationError(extractErrorMessage(err));
    } finally {
      setAffectationSaving(false);
    }
  };

  const handleRemoveAffectation = async (affectation: AffectationTransport) => {
    if (!(await confirmer(`Retirer ${affectation.eleve_nom} de ce trajet ?`))) return;
    await affectationsTransportApi.remove(affectation.id);
    loadTrajets();
    reloadAffectations();
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Transport scolaire"
        description="Gestion des lignes de bus et des affectations des élèves."
        actions={isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openAffectationModal()}>+ Affecter un élève</Button>
            <Button onClick={openCreateTrajet}>+ Nouveau trajet</Button>
          </div>
        ) : undefined}
      />

      <div>
        <h3 className="font-bold text-ink-900 mb-3">{isAdmin ? "Lignes de bus" : "Ma ligne de bus"}</h3>
        {loadingTrajets ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : trajets.length === 0 ? (
          <EmptyState
            title={isAdmin ? "Aucun trajet défini" : "Vous n'êtes affecté à aucune ligne de bus"}
            description={isAdmin ? undefined : "Contactez l'administration de votre établissement."}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trajets.map((trajet) => (
              <div key={trajet.id} className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-bold text-ink-900">{trajet.nom}</h4>
                  <Badge color={trajet.effectif >= trajet.capacite ? "rose" : "green"}>{trajet.effectif}/{trajet.capacite}</Badge>
                </div>
                <p className="text-sm text-slate-500">
                  🧑‍✈️ {trajet.chauffeur_nom || "—"}
                  {trajet.chauffeur_telephone && (
                    <> · <a href={`tel:${trajet.chauffeur_telephone}`} className="text-brand-600 hover:underline">{trajet.chauffeur_telephone}</a></>
                  )}
                </p>
                <p className="text-sm text-slate-500">🚌 {trajet.vehicule_immatriculation || "—"}</p>
                {(trajet.heure_depart || trajet.heure_retour) && (
                  <p className="text-sm text-slate-500">🕐 {trajet.heure_depart?.slice(0, 5)} — {trajet.heure_retour?.slice(0, 5)}</p>
                )}
                {trajet.description && <p className="text-xs text-slate-400 mt-2">{trajet.description}</p>}

                {trajet.position_maj_le && (
                  <p className="text-xs text-slate-400 mt-2">
                    📍 Position à {new Date(trajet.position_maj_le).toLocaleTimeString("fr-FR")}
                    {trajet.derniere_latitude && trajet.derniere_longitude && (
                      <>
                        {" · "}
                        <a
                          className="text-brand-600 hover:underline"
                          target="_blank" rel="noreferrer"
                          href={`https://www.google.com/maps?q=${trajet.derniere_latitude},${trajet.derniere_longitude}`}
                        >
                          voir sur la carte
                        </a>
                      </>
                    )}
                  </p>
                )}

                {isAdmin && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => handleCopyLien(trajet)} className="font-semibold text-brand-600 hover:underline">
                        {copiedTrajetId === trajet.id ? "✓ Lien copié" : "🔗 Copier le lien chauffeur"}
                      </button>
                      <button onClick={() => handleRegenererLien(trajet)} className="font-semibold text-slate-500 hover:underline">
                        🔄 Régénérer
                      </button>
                    </div>
                    <RowActions>
                      <EditButton onClick={() => openEditTrajet(trajet)} />
                      <DeleteButton onClick={() => handleDeleteTrajet(trajet)} />
                    </RowActions>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-bold text-ink-900 mb-3">{isAdmin ? "Élèves affectés" : "Mon transport"}</h3>
        {loadingAffectations ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : affectations.length === 0 ? (
          <EmptyState title="Aucune affectation enregistrée" />
        ) : (
          <Table headers={["Élève", "Classe", "Trajet", "Point de montée", ...(isAdmin || peutGererTickets ? ["Actions"] : [])]}>
            {affectations.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-medium text-slate-700">{a.eleve_nom}</td>
                <td className="px-4 py-3">{a.classe_nom || "—"}</td>
                <td className="px-4 py-3">{a.trajet_nom}</td>
                <td className="px-4 py-3 text-slate-500">{a.point_montee || "—"}</td>
                {(isAdmin || peutGererTickets) && (
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      {peutGererTickets && (
                        <button onClick={() => openTicketModal(a)} className="text-brand-600 hover:underline text-sm">🎫 Ticket</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => handleRemoveAffectation(a)} className="text-rose-600 hover:underline text-sm">Retirer</button>
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
            <h3 className="font-bold text-ink-900">Tickets de bus</h3>
            <Button variant="secondary" onClick={() => openTicketModal()}>+ Nouveau ticket</Button>
          </div>
          {tickets.length === 0 ? (
            <EmptyState title="Aucun ticket émis" />
          ) : (
            <Table headers={["Élève", "Trajet", "Mois", "Montant", "Statut", "Actions"]}>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium text-slate-700">{t.eleve_nom}</td>
                  <td className="px-4 py-3">{t.trajet_nom}</td>
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

      <Modal open={trajetModalOpen} onClose={() => setTrajetModalOpen(false)} title={editingTrajet ? "Modifier le trajet" : "Nouveau trajet"}>
        <form onSubmit={handleTrajetSubmit} className="space-y-4">
          <Input label="Nom du trajet" required value={trajetForm.nom} onChange={(e) => setTrajetForm({ ...trajetForm, nom: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Chauffeur" value={trajetForm.chauffeur_nom} onChange={(e) => setTrajetForm({ ...trajetForm, chauffeur_nom: e.target.value })} />
            <Input
              label="Téléphone du chauffeur" value={trajetForm.chauffeur_telephone}
              onChange={(e) => setTrajetForm({ ...trajetForm, chauffeur_telephone: e.target.value })}
              placeholder="Visible par les élèves/parents affectés"
            />
          </div>
          <Input label="Immatriculation" value={trajetForm.vehicule_immatriculation} onChange={(e) => setTrajetForm({ ...trajetForm, vehicule_immatriculation: e.target.value })} />
          <Input label="Capacité" type="number" min={1} required value={trajetForm.capacite} onChange={(e) => setTrajetForm({ ...trajetForm, capacite: Number(e.target.value) })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Heure de départ" type="time" value={trajetForm.heure_depart} onChange={(e) => setTrajetForm({ ...trajetForm, heure_depart: e.target.value })} />
            <Input label="Heure de retour" type="time" value={trajetForm.heure_retour} onChange={(e) => setTrajetForm({ ...trajetForm, heure_retour: e.target.value })} />
          </div>
          <Input label="Description" value={trajetForm.description} onChange={(e) => setTrajetForm({ ...trajetForm, description: e.target.value })} />

          {trajetError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{trajetError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setTrajetModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={trajetSaving}>{trajetSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={affectationModalOpen} onClose={() => setAffectationModalOpen(false)} title="Affecter un élève à un trajet">
        <form onSubmit={handleAffectationSubmit} className="space-y-4">
          <Select label="Élève" required value={affectationForm.eleve} onChange={(e) => setAffectationForm({ ...affectationForm, eleve: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {eleves.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
          </Select>
          <Select label="Trajet" required value={affectationForm.trajet} onChange={(e) => setAffectationForm({ ...affectationForm, trajet: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {trajets.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </Select>
          <Input label="Point de montée" value={affectationForm.point_montee} onChange={(e) => setAffectationForm({ ...affectationForm, point_montee: e.target.value })} />

          {affectationError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{affectationError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setAffectationModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={affectationSaving}>{affectationSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={ticketModalOpen} onClose={() => setTicketModalOpen(false)} title="Nouveau ticket de bus">
        <form onSubmit={handleTicketSubmit} className="space-y-4">
          <Select label="Élève affecté" required value={ticketForm.affectation} onChange={(e) => setTicketForm({ ...ticketForm, affectation: e.target.value })}>
            <option value="">— Sélectionner —</option>
            {affectations.map((a) => <option key={a.id} value={a.id}>{a.eleve_nom} — {a.trajet_nom}</option>)}
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
