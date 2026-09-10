import { useEffect, useState, type FormEvent } from "react";

import {
  alertesParentsApi, badgesApi, classesApi, elevesApi, enseignantBadgesApi, enseignantsApi,
  groupesRevisionApi, matieresApi, pointagesEnseignantsApi, unwrapList,
} from "../api/services";
import { extractBlobErrorMessage, extractErrorMessage } from "../api/client";
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { ClasseOptions } from "../components/CycleSelect";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type {
  AlerteParent, Classe, EleveBadge, EleveProfile, EnseignantBadge, EnseignantProfile,
  GroupeRevision, Matiere, PointageEnseignant,
} from "../types";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function BadgeCard({
  photo, nom, detail, onShowQr, onDownload, onDownloadPvc, onExtra, extraLabel,
}: {
  photo: string | null; nom: string; detail: string; onShowQr: () => void; onDownload: () => void;
  onDownloadPvc?: () => void; onExtra?: () => void; extraLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-0">
      {photo ? (
        <img src={photo} alt="" className="h-12 w-12 rounded-full object-cover shrink-0" />
      ) : (
        <div className="h-12 w-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
          {initials(nom)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-700 truncate">{nom}</p>
        <p className="text-xs text-slate-400 truncate">{detail}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={onShowQr}>QR</button>
        <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={onDownload}>Badge PDF</button>
        {onDownloadPvc && (
          <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={onDownloadPvc} title="Format carte PVC CR80 (85,6×54mm), taille exacte">
            💳 Format PVC
          </button>
        )}
        {onExtra && <button className="text-xs font-semibold text-amber-700 hover:underline" onClick={onExtra}>{extraLabel}</button>}
      </div>
    </div>
  );
}

const emptyGroupForm = { nom: "", description: "", matiere: "", classe: "", eleves: [] as number[], lien: "" };

export default function SchoolLifePage() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isTeacher = user?.role === "teacher";

  const [badges, setBadges] = useState<EleveBadge[]>([]);
  const [enseignantBadges, setEnseignantBadges] = useState<EnseignantBadge[]>([]);
  const [groups, setGroups] = useState<GroupeRevision[]>([]);
  const [alerts, setAlerts] = useState<AlerteParent[]>([]);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Émission de badge (admin)
  const [eleves, setEleves] = useState<EleveProfile[]>([]);
  const [enseignants, setEnseignants] = useState<EnseignantProfile[]>([]);
  const [newBadgeEleve, setNewBadgeEleve] = useState("");
  const [newBadgeEnseignant, setNewBadgeEnseignant] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [classeBadges, setClasseBadges] = useState("");
  const [generatingBadgesClasse, setGeneratingBadgesClasse] = useState(false);

  // Pointage (enseignant)
  const [pointage, setPointage] = useState<PointageEnseignant | null>(null);
  const [pointageLoading, setPointageLoading] = useState(false);

  // Groupes de révision (enseignant)
  const [classes, setClasses] = useState<Classe[]>([]);
  const [matieres, setMatieres] = useState<Matiere[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupeRevision | null>(null);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [groupError, setGroupError] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const [eleveSearch, setEleveSearch] = useState("");
  const [groupesDeplies, setGroupesDeplies] = useState<Set<number>>(new Set());

  const toggleGroupeDeplie = (id: number) => {
    setGroupesDeplies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const loadAll = () => {
    setLoading(true);
    // Chaque source est isolée par son propre .catch() : si le Super Admin a désactivé les
    // groupes de révision pour cette école (403), ça ne doit pas empêcher badges/alertes de
    // s'afficher — un Promise.all sans isolation aurait fait échouer toute la page au premier
    // module désactivé.
    Promise.all([
      badgesApi.list().then(({ data }) => unwrapList(data)).catch(() => []),
      enseignantBadgesApi.list().then(({ data }) => unwrapList(data)).catch(() => []),
      groupesRevisionApi.list().then(({ data }) => unwrapList(data)).catch(() => []),
      alertesParentsApi.list().then(({ data }) => unwrapList(data)).catch(() => []),
    ]).then(([badgeItems, ensBadgeItems, groupItems, alertItems]) => {
      setBadges(badgeItems);
      setEnseignantBadges(ensBadgeItems);
      setGroups(groupItems);
      setAlerts(alertItems);
    }).finally(() => setLoading(false));
  };

  useEffect(loadAll, []);

  useEffect(() => {
    if (isAdmin) {
      enseignantsApi.list({ page_size: 200 }).then(({ data }) => setEnseignants(unwrapList(data)));
    }
    if (isAdmin || isTeacher) {
      // Les enseignants en ont aussi besoin pour composer leurs groupes de révision.
      elevesApi.list({ page_size: 500 }).then(({ data }) => setEleves(unwrapList(data)));
      classesApi.list().then(({ data }) => setClasses(unwrapList(data)));
      matieresApi.list().then(({ data }) => setMatieres(unwrapList(data)));
    }
  }, [isAdmin, isTeacher]);

  useEffect(() => {
    if (!isTeacher) return;
    setPointageLoading(true);
    pointagesEnseignantsApi.today().then(({ data }) => setPointage(data)).finally(() => setPointageLoading(false));
  }, [isTeacher]);

  const showQr = async (kind: "eleve" | "enseignant", id: number) => {
    const { data } = kind === "eleve" ? await badgesApi.qr(id) : await enseignantBadgesApi.qr(id);
    setQrPreview(URL.createObjectURL(data));
  };

  const downloadBadge = (kind: "eleve" | "enseignant", id: number, nom: string) => {
    const filename = `badge_${nom.replace(/\s+/g, "_")}.pdf`;
    return kind === "eleve" ? badgesApi.pdf(id, filename) : enseignantBadgesApi.pdf(id, filename);
  };

  const handleIssueEleveBadge = async () => {
    if (!newBadgeEleve) return;
    setIssuing(true);
    try {
      await badgesApi.create(Number(newBadgeEleve));
      setNewBadgeEleve("");
      loadAll();
    } finally {
      setIssuing(false);
    }
  };

  const handleIssueEnseignantBadge = async () => {
    if (!newBadgeEnseignant) return;
    setIssuing(true);
    try {
      await enseignantBadgesApi.create(Number(newBadgeEnseignant));
      setNewBadgeEnseignant("");
      loadAll();
    } finally {
      setIssuing(false);
    }
  };

  /** Émet (au besoin) et télécharge en un seul PDF les badges de tous les élèves actifs
   * de la classe sélectionnée — une carte par page, prête à imprimer/découper. */
  const handleGenererBadgesClasse = async () => {
    if (!classeBadges) return;
    const classe = classes.find((c) => String(c.id) === classeBadges);
    setGeneratingBadgesClasse(true);
    try {
      await badgesApi.pdfClasse(Number(classeBadges), `badges_${(classe?.nom || "classe").replace(/\s+/g, "_")}.pdf`);
      loadAll();
    } catch (err) {
      toast.error(await extractBlobErrorMessage(err));
    } finally {
      setGeneratingBadgesClasse(false);
    }
  };

  const handleCheckIn = async () => {
    setPointageLoading(true);
    try {
      const { data } = await pointagesEnseignantsApi.checkIn();
      setPointage(data);
    } finally {
      setPointageLoading(false);
    }
  };

  const handleCheckOut = async () => {
    setPointageLoading(true);
    try {
      const { data } = await pointagesEnseignantsApi.checkOut();
      setPointage(data);
    } finally {
      setPointageLoading(false);
    }
  };

  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm(emptyGroupForm);
    setGroupError("");
    setEleveSearch("");
    setGroupModalOpen(true);
  };

  const openEditGroup = (group: GroupeRevision) => {
    setEditingGroup(group);
    setGroupForm({
      nom: group.nom, description: group.description,
      matiere: group.matiere ? String(group.matiere) : "", classe: group.classe ? String(group.classe) : "",
      eleves: group.eleves, lien: group.lien,
    });
    setGroupError("");
    setEleveSearch("");
    setGroupModalOpen(true);
  };

  const toggleEleveDansGroupe = (eleveId: number) => {
    setGroupForm((f) => ({
      ...f,
      eleves: f.eleves.includes(eleveId) ? f.eleves.filter((id) => id !== eleveId) : [...f.eleves, eleveId],
    }));
  };

  const handleGroupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGroupSaving(true);
    setGroupError("");
    try {
      const payload = {
        nom: groupForm.nom, description: groupForm.description,
        matiere: groupForm.matiere ? Number(groupForm.matiere) : null,
        classe: groupForm.classe ? Number(groupForm.classe) : null,
        eleves: groupForm.eleves, lien: groupForm.lien,
      };
      if (editingGroup) await groupesRevisionApi.update(editingGroup.id, payload);
      else await groupesRevisionApi.create(payload);
      setGroupModalOpen(false);
      loadAll();
    } catch (err) {
      setGroupError(extractErrorMessage(err));
    } finally {
      setGroupSaving(false);
    }
  };

  const handleToggleActif = async (group: GroupeRevision) => {
    await groupesRevisionApi.update(group.id, { actif: !group.actif });
    loadAll();
  };

  const canManageGroups = isAdmin || isTeacher;

  return (
    <div>
      <PageHeader title="Vie scolaire" description="Badges, groupes de révision et alertes de présence." />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Pointage enseignant */}
          {isTeacher && (
            <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 shadow-soft">
              <h2 className="font-bold text-ink-900 mb-4">Mon pointage du jour</h2>
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-sm text-slate-600">
                  {pointage ? (
                    <>
                      <p>Arrivée : <span className="font-semibold">{pointage.heure_arrivee?.slice(0, 5) || "—"}</span>{" "}
                        {pointage.statut === "retard" && <Badge color="amber">Retard</Badge>}
                      </p>
                      <p>Départ : <span className="font-semibold">{pointage.heure_depart?.slice(0, 5) || "—"}</span></p>
                    </>
                  ) : (
                    <p className="text-slate-400">Aucun pointage aujourd'hui.</p>
                  )}
                </div>
                <div className="flex gap-2 ml-auto">
                  <Button onClick={handleCheckIn} disabled={pointageLoading || !!pointage?.heure_arrivee}>
                    ⏱️ Pointer l'arrivée
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleCheckOut}
                    disabled={pointageLoading || !pointage?.heure_arrivee || !!pointage?.heure_depart}
                  >
                    🚪 Pointer le départ
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Badges élèves */}
          <section className="bg-white rounded-2xl border border-slate-100 p-5 shadow-soft">
            <h2 className="font-bold text-ink-900 mb-4">Badges élèves</h2>
            {isAdmin && (
              <div className="space-y-2 mb-4">
                <div className="flex gap-2">
                  <Select value={newBadgeEleve} onChange={(e) => setNewBadgeEleve(e.target.value)} className="flex-1">
                    <option value="">— Choisir un élève —</option>
                    {eleves.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
                  </Select>
                  <Button type="button" onClick={handleIssueEleveBadge} disabled={issuing || !newBadgeEleve}>+ Émettre</Button>
                </div>
                <div className="flex gap-2">
                  <Select value={classeBadges} onChange={(e) => setClasseBadges(e.target.value)} className="flex-1">
                    <option value="">— Toute une classe —</option>
                    <ClasseOptions classes={classes} />
                  </Select>
                  <Button
                    type="button" variant="secondary" onClick={handleGenererBadgesClasse}
                    disabled={generatingBadgesClasse || !classeBadges}
                  >
                    {generatingBadgesClasse ? "Génération…" : "🖨️ Générer toute la classe"}
                  </Button>
                </div>
              </div>
            )}
            {badges.length === 0 ? <EmptyState title="Aucun badge émis" /> : badges.map((badge) => (
              <BadgeCard
                key={badge.id}
                photo={badge.photo}
                nom={badge.eleve_nom}
                detail={`Élève · émis le ${new Date(badge.emis_le).toLocaleDateString("fr-FR")}`}
                onShowQr={() => showQr("eleve", badge.id)}
                onDownload={() => downloadBadge("eleve", badge.id, badge.eleve_nom)}
                onDownloadPvc={() => badgesApi.pdfPvc(badge.id, `badge_pvc_${badge.eleve_nom.replace(/\s+/g, "_")}.pdf`)}
                extraLabel="🎒 Autorisation"
                onExtra={() =>
                  badgesApi
                    .autorisationRecuperation(badge.id, `autorisation_recuperation_${badge.eleve_nom.replace(/\s+/g, "_")}.pdf`)
                    .catch(() => toast.warning("Cette autorisation est réservée aux élèves du préscolaire/maternelle."))
                }
              />
            ))}
          </section>

          {/* Badges enseignants */}
          <section className="bg-white rounded-2xl border border-slate-100 p-5 shadow-soft">
            <h2 className="font-bold text-ink-900 mb-4">Badges enseignants</h2>
            {isAdmin && (
              <div className="flex gap-2 mb-4">
                <Select value={newBadgeEnseignant} onChange={(e) => setNewBadgeEnseignant(e.target.value)} className="flex-1">
                  <option value="">— Choisir un enseignant —</option>
                  {enseignants.map((ens) => <option key={ens.id} value={ens.id}>{ens.user.first_name} {ens.user.last_name}</option>)}
                </Select>
                <Button type="button" onClick={handleIssueEnseignantBadge} disabled={issuing || !newBadgeEnseignant}>+ Émettre</Button>
              </div>
            )}
            {enseignantBadges.length === 0 ? <EmptyState title="Aucun badge émis" /> : enseignantBadges.map((badge) => (
              <BadgeCard
                key={badge.id}
                photo={badge.photo}
                nom={badge.enseignant_nom}
                detail={`Enseignant · émis le ${new Date(badge.emis_le).toLocaleDateString("fr-FR")}`}
                onShowQr={() => showQr("enseignant", badge.id)}
                onDownload={() => downloadBadge("enseignant", badge.id, badge.enseignant_nom)}
              />
            ))}
          </section>

          {qrPreview && (
            <div className="lg:col-span-2 flex justify-center">
              <img src={qrPreview} alt="Code QR du badge" className="h-40 w-40 border border-slate-100 rounded-xl shadow-soft" />
            </div>
          )}

          {/* Groupes de révision */}
          <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5 shadow-soft">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-ink-900">Groupes de révision</h2>
              {isTeacher && <Button onClick={openCreateGroup}>+ Nouveau groupe</Button>}
            </div>
            {groups.length === 0 ? <EmptyState title="Aucun groupe disponible" /> : groups.map((group) => (
              <article key={group.id} className="border-b border-slate-100 py-3 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-700">{group.nom}</h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={group.actif ? "green" : "slate"}>{group.actif ? "Actif" : "Archivé"}</Badge>
                    {canManageGroups && (isAdmin || group.enseignant === user?.id) && (
                      <>
                        <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => openEditGroup(group)}>Modifier</button>
                        <button className="text-xs font-semibold text-slate-500 hover:underline" onClick={() => handleToggleActif(group)}>
                          {group.actif ? "Archiver" : "Réactiver"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-500 mt-1">{group.description || `Animé par ${group.enseignant_nom}`}</p>
                {group.eleves_noms.length === 0 ? (
                  <p className="text-xs text-slate-400 mt-1">Aucun élève inscrit</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroupeDeplie(group.id)}
                    className="text-xs font-semibold text-brand-600 hover:underline mt-1"
                  >
                    {group.eleves_noms.length} élève{group.eleves_noms.length > 1 ? "s" : ""} inscrit{group.eleves_noms.length > 1 ? "s" : ""}
                    {groupesDeplies.has(group.id) ? " ▴" : " ▾"}
                  </button>
                )}
                {groupesDeplies.has(group.id) && group.eleves_noms.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {group.eleves_noms.map((nom, i) => (
                      <li key={i} className="text-xs bg-slate-50 border border-slate-100 rounded-full px-2.5 py-1 text-slate-600">{nom}</li>
                    ))}
                  </ul>
                )}
                {group.lien && <a className="text-sm text-brand-700 font-semibold block mt-1.5" href={group.lien} target="_blank" rel="noreferrer">Accéder au groupe →</a>}
              </article>
            ))}
          </section>

          {alerts.length > 0 && (
            <section className="lg:col-span-2 bg-rose-50 border border-rose-100 rounded-2xl p-5">
              <h2 className="font-bold text-rose-900 mb-3">Alertes d'absences répétées</h2>
              {alerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between gap-3 text-sm text-rose-800 py-1">
                  <span>{alert.message}</span>
                  <Badge color={alert.sms_envoye ? "green" : "slate"}>{alert.sms_envoye ? "SMS envoyé" : "SMS non envoyé"}</Badge>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      <Modal open={groupModalOpen} onClose={() => setGroupModalOpen(false)} title={editingGroup ? "Modifier le groupe" : "Nouveau groupe de révision"}>
        <form onSubmit={handleGroupSubmit} className="space-y-4">
          <Input label="Nom du groupe" required value={groupForm.nom} onChange={(e) => setGroupForm({ ...groupForm, nom: e.target.value })} placeholder="Ex: Soutien Maths 3ème" />
          <label className="block">
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">Description</span>
            <textarea
              rows={3} value={groupForm.description} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-400"
            />
          </label>
          <Select label="Matière (optionnel)" value={groupForm.matiere} onChange={(e) => setGroupForm({ ...groupForm, matiere: e.target.value })}>
            <option value="">— Aucune —</option>
            {matieres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </Select>
          <Select
            label="Classe (optionnel — tous les élèves de la classe y auront accès)"
            value={groupForm.classe}
            onChange={(e) => setGroupForm({ ...groupForm, classe: e.target.value })}
          >
            <option value="">— Aucune —</option>
            <ClasseOptions classes={classes} />
          </Select>

          <div>
            <span className="block text-sm font-semibold text-slate-600 mb-1.5">
              Élèves individuels {groupForm.eleves.length > 0 && `(${groupForm.eleves.length} sélectionné${groupForm.eleves.length > 1 ? "s" : ""})`}
            </span>
            <p className="text-xs text-slate-400 mb-1.5">
              À ajouter en plus (ou à la place) de la classe ci-dessus — utile pour un groupe qui mélange des élèves de classes différentes.
            </p>
            <Input
              placeholder="Rechercher un élève…" value={eleveSearch} onChange={(e) => setEleveSearch(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-50">
              {eleves.length === 0 ? (
                <p className="text-sm text-slate-400 px-3.5 py-3">Chargement des élèves…</p>
              ) : (
                eleves
                  .filter((el) => `${el.user.first_name} ${el.user.last_name}`.toLowerCase().includes(eleveSearch.toLowerCase()))
                  .map((el) => (
                    <label key={el.id} className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={groupForm.eleves.includes(el.id)}
                        onChange={() => toggleEleveDansGroupe(el.id)}
                        className="h-4 w-4 rounded border-slate-300 accent-brand-600 shrink-0"
                      />
                      <span className="truncate">{el.user.first_name} {el.user.last_name}</span>
                      {el.classe_nom && <span className="text-xs text-slate-400 shrink-0">({el.classe_nom})</span>}
                    </label>
                  ))
              )}
            </div>
          </div>

          <Input label="Lien de visioconférence (optionnel)" value={groupForm.lien} onChange={(e) => setGroupForm({ ...groupForm, lien: e.target.value })} placeholder="https://..." />

          {groupError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5">{groupError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="secondary" onClick={() => setGroupModalOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={groupSaving}>{groupSaving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
