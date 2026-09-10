import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { authApi } from "../api/services";
import { extractErrorMessage } from "../api/client";
import { Button, Card, Input, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    first_name: user?.first_name || "", last_name: user?.last_name || "",
    email: user?.email || "", phone: user?.phone || "", address: user?.address || "",
  });
  const [saving, setSaving] = useState(false);

  const [pwdForm, setPwdForm] = useState({ old_password: "", new_password: "" });
  const [pwdSaving, setPwdSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  if (!user) return null;

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
          <div>
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

      <Card>
        <h3 className="font-bold text-ink-900 mb-4">Changer de mot de passe</h3>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <Input label="Mot de passe actuel" type="password" required value={pwdForm.old_password} onChange={(e) => setPwdForm({ ...pwdForm, old_password: e.target.value })} />
          <Input label="Nouveau mot de passe" type="password" required value={pwdForm.new_password} onChange={(e) => setPwdForm({ ...pwdForm, new_password: e.target.value })} />

          <div className="flex justify-end">
            <Button type="submit" disabled={pwdSaving}>{pwdSaving ? "Modification…" : "Modifier le mot de passe"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
