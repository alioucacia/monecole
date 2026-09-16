import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { authApi, elevesApi, unwrapList } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Badge, Button, Card, Input, OtpBoxInput, PageHeader, Select } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import type { EleveProfile, JournalUtilisateurEntry } from "../types";

const CATEGORIE_LABELS: Record<JournalUtilisateurEntry["categorie"], "brand" | "teal" | "amber" | "rose" | "slate"> = {
  connexion: "slate", compte: "rose", eleve: "amber", enseignant: "teal", note: "brand", paiement: "teal",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const confirmer = useConfirm();
  const [form, setForm] = useState({
    first_name: user?.first_name || "", last_name: user?.last_name || "",
    email: user?.email || "", phone: user?.phone || "", address: user?.address || "",
  });
  const [saving, setSaving] = useState(false);

  const [pwdForm, setPwdForm] = useState({ old_password: "", new_password: "" });
  const [pwdSaving, setPwdSaving] = useState(false);

  // Double authentification (2FA) + vérification e-mail/téléphone (voir User.otp_actif/
  // email_verifie/telephone_verifie côté backend) — les deux OTP par e-mail/SMS.
  const [otpToggling, setOtpToggling] = useState(false);
  const [verifCanalOuvert, setVerifCanalOuvert] = useState<"email" | "telephone" | null>(null);
  const [verifCode, setVerifCode] = useState("");
  const [verifEnvoi, setVerifEnvoi] = useState(false);
  const [verifConfirmation, setVerifConfirmation] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);

  // Historique d'activité du compte connecté (self-service) — voir MonActiviteView côté backend.
  const [activite, setActivite] = useState<JournalUtilisateurEntry[] | null>(null);
  const [activiteLoading, setActiviteLoading] = useState(true);

  // Certificat de scolarité : self-service pour l'élève (son propre dossier) et le parent (un
  // sélecteur si plusieurs enfants) — l'admin le génère plutôt depuis la fiche élève.
  const [enfants, setEnfants] = useState<EleveProfile[]>([]);
  const [eleveChoisiId, setEleveChoisiId] = useState("");
  const [certificatLoading, setCertificatLoading] = useState(false);

  useEffect(() => {
    if (user?.role === "student") {
      elevesApi.list({ page_size: 1 }).then(({ data }) => {
        const own = unwrapList(data)[0];
        if (own) setEleveChoisiId(String(own.id));
      });
    }
    if (user?.role === "parent") {
      elevesApi.list({ page_size: 50 }).then(({ data }) => {
        const liste = unwrapList(data);
        setEnfants(liste);
        if (liste[0]) setEleveChoisiId(String(liste[0].id));
      });
    }
  }, [user]);

  useEffect(() => {
    authApi.monActivite().then(({ data }) => setActivite(data)).finally(() => setActiviteLoading(false));
  }, []);

  if (!user) return null;

  const peutTelechargerCertificat = user.role === "student" || user.role === "parent";

  const handleCertificat = async () => {
    if (!eleveChoisiId) return;
    setCertificatLoading(true);
    try {
      await elevesApi.certificatScolarite(Number(eleveChoisiId), "certificat_scolarite.pdf");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setCertificatLoading(false);
    }
  };

  const handlePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      await authApi.uploadPhoto(file);
      await refreshUser();
      toast.success("Photo de profil mise à jour.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSupprimerPhoto = async () => {
    if (!(await confirmer("Retirer votre photo de profil ?"))) return;
    setRemovingPhoto(true);
    try {
      await authApi.supprimerPhoto();
      await refreshUser();
      toast.success("Photo de profil retirée.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setRemovingPhoto(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await authApi.updateMe(form);
      await refreshUser();
      toast.success("Profil mis à jour avec succès.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPwdSaving(true);
    try {
      await authApi.changePassword(pwdForm.old_password, pwdForm.new_password);
      setPwdForm({ old_password: "", new_password: "" });
      toast.success("Mot de passe modifié avec succès.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setPwdSaving(false);
    }
  };

  const handleToggleOtp = async () => {
    setOtpToggling(true);
    try {
      await authApi.updateMe({ otp_actif: !user.otp_actif });
      await refreshUser();
      toast.success(user.otp_actif ? "Double authentification désactivée." : "Double authentification activée.");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setOtpToggling(false);
    }
  };

  const handleDemanderVerification = async (canal: "email" | "telephone") => {
    setVerifEnvoi(true);
    try {
      const { data } = await authApi.demanderVerification(canal);
      toast.success(data.detail);
      setVerifCanalOuvert(canal);
      setVerifCode("");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setVerifEnvoi(false);
    }
  };

  const confirmerVerification = async (canal: "email" | "telephone", code: string) => {
    setVerifConfirmation(true);
    try {
      await authApi.confirmerVerification(canal, code);
      await refreshUser();
      toast.success(canal === "email" ? "E-mail vérifié." : "Téléphone vérifié.");
      setVerifCanalOuvert(null);
      setVerifCode("");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setVerifConfirmation(false);
    }
  };

  const handleConfirmerVerification = (e: FormEvent) => {
    e.preventDefault();
    if (!verifCanalOuvert) return;
    confirmerVerification(verifCanalOuvert, verifCode.trim());
  };

  // Confirmation automatique dès les 6 chiffres saisis, même logique que les autres écrans OTP
  // (connexion, réinitialisation de mot de passe) — pas besoin de cliquer sur « Confirmer ».
  useEffect(() => {
    if (verifCanalOuvert && verifCode.length === 6 && !verifConfirmation) {
      confirmerVerification(verifCanalOuvert, verifCode.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifCode, verifCanalOuvert]);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Mon profil" description="Gérez vos informations personnelles." />

      <Card className="mb-6">
        <h3 className="font-bold text-ink-900 mb-4">Photo de profil</h3>
        <p className="text-sm text-slate-500 mb-4">
          Utilisée sur votre badge (avec le code QR) et dans l'application.
        </p>
        <div className="flex items-center gap-4">
          {user.photo ? (
            <img src={user.photo} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-brand-100" />
          ) : (
            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white flex items-center justify-center text-2xl font-bold">
              {initials(user.full_name || user.username)}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
            <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}>
              {uploadingPhoto ? "Envoi…" : "📷 Changer la photo"}
            </Button>
            {user.photo && (
              <Button type="button" variant="ghost" onClick={handleSupprimerPhoto} disabled={removingPhoto}>
                {removingPhoto ? "…" : "🗑️ Retirer"}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <h3 className="font-bold text-ink-900 mb-4">Informations personnelles</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Prénom" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <Input label="Nom" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Téléphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Adresse" className="sm:col-span-2" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />

          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </div>
        </form>
      </Card>

      {peutTelechargerCertificat && (
        <Card className="mb-6">
          <h3 className="font-bold text-ink-900 mb-1">Certificat de scolarité</h3>
          <p className="text-sm text-slate-500 mb-4">
            {user.role === "student"
              ? "Téléchargez votre certificat de scolarité pour l'année scolaire en cours."
              : "Téléchargez le certificat de scolarité de votre enfant pour l'année scolaire en cours."}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {user.role === "parent" && enfants.length > 1 && (
              <Select label="Enfant" value={eleveChoisiId} onChange={(e) => setEleveChoisiId(e.target.value)} className="max-w-xs">
                {enfants.map((el) => <option key={el.id} value={el.id}>{el.user.first_name} {el.user.last_name}</option>)}
              </Select>
            )}
            <Button variant="secondary" onClick={handleCertificat} disabled={!eleveChoisiId || certificatLoading}>
              {certificatLoading ? "…" : user.role === "student" ? "🎓 Télécharger mon certificat" : "🎓 Télécharger le certificat"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <h3 className="font-bold text-ink-900 mb-4">Changer de mot de passe</h3>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <Input label="Mot de passe actuel" type="password" required value={pwdForm.old_password} onChange={(e) => setPwdForm({ ...pwdForm, old_password: e.target.value })} />
          <Input label="Nouveau mot de passe" type="password" required value={pwdForm.new_password} onChange={(e) => setPwdForm({ ...pwdForm, new_password: e.target.value })} />

          <div className="flex justify-end">
            <Button type="submit" disabled={pwdSaving}>{pwdSaving ? "Modification…" : "Modifier le mot de passe"}</Button>
          </div>
        </form>
      </Card>

      <Card>
        <h3 className="font-bold text-ink-900 mb-1">Sécurité</h3>
        <p className="text-sm text-slate-500 mb-4">
          Vérifiez votre e-mail/téléphone, et activez la double authentification par code à usage unique.
        </p>

        <div className="space-y-4">
          {(["email", "telephone"] as const).map((canal) => {
            const valeur = canal === "email" ? user.email : user.phone;
            const verifie = canal === "email" ? user.email_verifie : user.telephone_verifie;
            return (
              <div key={canal} className="rounded-xl border border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {canal === "email" ? "E-mail" : "Téléphone"} {valeur ? `— ${valeur}` : <span className="text-slate-400 font-normal">(non renseigné)</span>}
                    </p>
                    {valeur && (
                      verifie
                        ? <p className="text-xs text-emerald-600 font-semibold mt-0.5">✓ Vérifié</p>
                        : <p className="text-xs text-slate-400 mt-0.5">Non vérifié</p>
                    )}
                  </div>
                  {valeur && !verifie && verifCanalOuvert !== canal && (
                    <Button type="button" variant="secondary" disabled={verifEnvoi} onClick={() => handleDemanderVerification(canal)}>
                      {verifEnvoi ? "Envoi…" : "Vérifier"}
                    </Button>
                  )}
                </div>
                {verifCanalOuvert === canal && (
                  <form onSubmit={handleConfirmerVerification} className="mt-3 space-y-3">
                    <OtpBoxInput value={verifCode} onChange={setVerifCode} autoFocus disabled={verifConfirmation} />
                    <div className="flex items-center justify-center gap-2">
                      <Button type="submit" disabled={verifConfirmation || verifCode.length !== 6}>
                        {verifConfirmation ? "…" : "Confirmer"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setVerifCanalOuvert(null)}>Annuler</Button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}

          <div className="rounded-xl border border-slate-100 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-slate-700">Double authentification</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Un code à usage unique (e-mail/SMS) sera demandé à chaque connexion, en plus du mot de passe.
              </p>
            </div>
            <Button type="button" variant={user.otp_actif ? "secondary" : "primary"} disabled={otpToggling} onClick={handleToggleOtp}>
              {otpToggling ? "…" : user.otp_actif ? "Désactiver" : "Activer"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <h3 className="font-bold text-ink-900 mb-1">Mon activité récente</h3>
        <p className="text-sm text-slate-500 mb-4">Vos dernières connexions et actions sur votre compte.</p>
        {activiteLoading ? (
          <p className="text-sm text-slate-400 py-4 text-center">Chargement…</p>
        ) : !activite || activite.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Aucune activité enregistrée pour l'instant.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 -mx-1">
            {activite.map((entree) => (
              <li key={entree.id} className="flex items-start justify-between gap-3 px-1 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700">{entree.description}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(entree.horodatage).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                    {entree.appareil && ` · ${entree.appareil}`}
                  </p>
                </div>
                <Badge color={CATEGORIE_LABELS[entree.categorie]}>{entree.categorie_display}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
