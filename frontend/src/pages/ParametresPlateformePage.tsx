import { useEffect, useState, type FormEvent } from "react";

import { parametresPlateformeApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { useToast } from "../context/ToastContext";

export default function ParametresPlateformePage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    nom_plateforme: "", email_expediteur_nom: "", support_email: "", support_telephone: "",
    sms_actif: true, maintenance_active: false, maintenance_message: "",
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    parametresPlateformeApi.get()
      .then(({ data }) => {
        setForm({
          nom_plateforme: data.nom_plateforme, email_expediteur_nom: data.email_expediteur_nom,
          support_email: data.support_email, support_telephone: data.support_telephone,
          sms_actif: data.sms_actif, maintenance_active: data.maintenance_active,
          maintenance_message: data.maintenance_message,
        });
        setLogoPreview(data.logo);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogoChange = (file: File | null) => {
    setLogo(file);
    setLogoPreview(file ? URL.createObjectURL(file) : logoPreview);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (logo) payload.logo = logo;
      const { data } = await parametresPlateformeApi.update(payload);
      setLogo(null);
      setLogoPreview(data.logo);
      toast.success("Paramètres de la plateforme enregistrés.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const [messageSaving, setMessageSaving] = useState(false);
  // Remplace l'ancien `confirm()` natif (infobulle système du navigateur, pas stylable) par une
  // vraie popup de l'app — seule l'ACTIVATION est destructrice pour tout le monde et mérite
  // cette confirmation ; désactiver reste immédiat, comme avant.
  const [confirmActivationOuvert, setConfirmActivationOuvert] = useState(false);
  const [activationEnCours, setActivationEnCours] = useState(false);

  const appliquerBasculeMaintenance = async (activer: boolean) => {
    setForm({ ...form, maintenance_active: activer });
    try {
      // Envoie aussi le message actuellement saisi : sans ça, le modifier puis cliquer
      // « Activer » l'aurait silencieusement ignoré (seul `maintenance_active` était envoyé).
      await parametresPlateformeApi.update({ maintenance_active: activer, maintenance_message: form.maintenance_message });
      toast.success(activer ? "Mode maintenance activé — la plateforme est maintenant bloquée pour tout le monde." : "Mode maintenance désactivé.");
    } catch (err) {
      setForm({ ...form, maintenance_active: !activer });
      toast.error(extractErrorMessage(err));
    }
  };

  const handleToggleMaintenance = () => {
    if (form.maintenance_active) {
      appliquerBasculeMaintenance(false);
      return;
    }
    setConfirmActivationOuvert(true);
  };

  const handleConfirmerActivation = async () => {
    setActivationEnCours(true);
    await appliquerBasculeMaintenance(true);
    setActivationEnCours(false);
    setConfirmActivationOuvert(false);
  };

  const handleSaveMessage = async () => {
    setMessageSaving(true);
    try {
      await parametresPlateformeApi.update({ maintenance_message: form.maintenance_message });
      toast.success("Message de maintenance enregistré.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setMessageSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Paramètres plateforme"
        description="Réglages globaux, réservés au Super Admin — s'appliquent à toutes les écoles."
      />

      <Card className="mb-6 border-2 border-amber-200 bg-amber-50/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-ink-900 mb-1">Mode maintenance</h3>
            <p className="text-sm text-slate-500">
              Bloque immédiatement l'accès à l'application pour tout le monde, sauf le Super Admin.
            </p>
          </div>
          <Badge color={form.maintenance_active ? "rose" : "green"}>
            {form.maintenance_active ? "Activée" : "Désactivée"}
          </Badge>
        </div>
        <div className="mt-4 flex items-end gap-2">
          <Input
            label="Message affiché aux utilisateurs bloqués" className="flex-1"
            value={form.maintenance_message}
            onChange={(e) => setForm({ ...form, maintenance_message: e.target.value })}
          />
          <Button type="button" variant="secondary" disabled={messageSaving} onClick={handleSaveMessage}>
            {messageSaving ? "…" : "Enregistrer le message"}
          </Button>
        </div>
        <Button
          type="button"
          variant={form.maintenance_active ? "secondary" : "danger"}
          className="mt-4"
          onClick={handleToggleMaintenance}
        >
          {form.maintenance_active ? "Désactiver la maintenance" : "Activer la maintenance"}
        </Button>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <h3 className="font-bold text-ink-900 mb-4">Général</h3>
          <div className="flex items-center gap-4 mb-5">
            {logoPreview ? (
              <img src={logoPreview} alt="" className="h-16 w-16 rounded-2xl object-cover border-2 border-brand-100 shrink-0" />
            ) : (
              <div className="h-16 w-16 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center text-2xl shrink-0">
                🏫
              </div>
            )}
            <label className="block">
              <span className="block text-sm font-semibold text-slate-600 mb-1.5">Logo de la plateforme</span>
              <input type="file" accept="image/*" onChange={(e) => handleLogoChange(e.target.files?.[0] || null)} className="text-sm" />
              <span className="block text-xs text-slate-400 mt-1">Affiché sur la page de connexion et dans la barre latérale de toute l'app.</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Nom de la plateforme" required value={form.nom_plateforme}
              onChange={(e) => setForm({ ...form, nom_plateforme: e.target.value })}
            />
            <Input
              label="Nom affiché comme expéditeur des e-mails" value={form.email_expediteur_nom}
              onChange={(e) => setForm({ ...form, email_expediteur_nom: e.target.value })}
            />
            <Input
              label="E-mail de support" type="email" value={form.support_email}
              onChange={(e) => setForm({ ...form, support_email: e.target.value })}
            />
            <Input
              label="Téléphone de support" value={form.support_telephone}
              onChange={(e) => setForm({ ...form, support_telephone: e.target.value })}
            />
          </div>
        </Card>

        <Card>
          <h3 className="font-bold text-ink-900 mb-1">Notifications</h3>
          <p className="text-xs text-slate-500 mb-4">
            Les identifiants d'envoi (SMTP, fournisseur SMS) restent configurés côté serveur —
            ce coupe-circuit permet de désactiver rapidement l'envoi de SMS sans y toucher.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox" checked={form.sms_actif}
              onChange={(e) => setForm({ ...form, sms_actif: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
            />
            Envoi de SMS actif sur la plateforme
          </label>
        </Card>

        <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer les paramètres"}</Button>
      </form>

      <Modal open={confirmActivationOuvert} onClose={() => setConfirmActivationOuvert(false)} title="🛠️ Activer le mode maintenance ?">
        <div className="space-y-5">
          <p className="text-sm text-slate-600 leading-relaxed">
            Plus personne (sauf le Super Admin) ne pourra utiliser la plateforme tant qu'il ne sera pas désactivé.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmActivationOuvert(false)} disabled={activationEnCours}>
              Annuler
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmerActivation} disabled={activationEnCours}>
              {activationEnCours ? "Activation…" : "Activer la maintenance"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
