import { useCallback, useEffect, useState, type FormEvent } from "react";

import { extractErrorMessage } from "../api/client";
import { securiteApi } from "../api/services";
import { Badge, Button, Card, Modal, OtpBoxInput, PageHeader, Spinner, StatCard } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useConfirm, usePrompt } from "../context/ConfirmContext";
import { useToast } from "../context/ToastContext";
import type { AppareilConnu, EvenementSecurite, ResumeSecurite, SessionActive } from "../types";

const COULEUR_NIVEAU: Record<EvenementSecurite["niveau"], "slate" | "amber" | "rose"> = {
  info: "slate", avertissement: "amber", critique: "rose",
};

function dateHeure(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/** « il y a 3 min » — plus parlant qu'une date pour l'activité d'une session. */
function ilYa(iso: string) {
  const secondes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secondes < 90) return "à l'instant";
  if (secondes < 3600) return `il y a ${Math.round(secondes / 60)} min`;
  if (secondes < 86400) return `il y a ${Math.round(secondes / 3600)} h`;
  return `il y a ${Math.round(secondes / 86400)} j`;
}

function telechargerCodes(codes: string[]) {
  const contenu = [
    "Codes de secours — compte Super Admin",
    `Générés le ${new Date().toLocaleString("fr-FR")}`,
    "Chaque code ne peut servir qu'une seule fois. Conservez-les en lieu sûr.",
    "",
    ...codes,
  ].join("\n");
  const url = URL.createObjectURL(new Blob([contenu], { type: "text/plain" }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = "codes-de-secours.txt";
  lien.click();
  URL.revokeObjectURL(url);
}

/** Liste d'événements de sécurité paginée (« Charger plus ») — sert à l'historique des
 * connexions et au journal de sécurité, seuls les filtres changent. */
function useEvenements(charger: (params: Record<string, unknown>) => ReturnType<typeof securiteApi.journal>, filtres: Record<string, unknown>) {
  const [items, setItems] = useState<EvenementSecurite[]>([]);
  const [page, setPage] = useState(1);
  const [suivante, setSuivante] = useState(false);
  const [loading, setLoading] = useState(true);
  const cle = JSON.stringify(filtres);

  const recharger = useCallback(async (numero = 1) => {
    setLoading(true);
    try {
      const { data } = await charger({ ...filtres, page: numero, page_size: 15 });
      setItems((prec) => (numero === 1 ? data.results : [...prec, ...data.results]));
      setSuivante(!!data.next);
      setPage(numero);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  useEffect(() => { recharger(1); }, [recharger]);
  return { items, loading, suivante, chargerPlus: () => recharger(page + 1), recharger: () => recharger(1) };
}

function ListeEvenements({ items, loading, suivante, chargerPlus, vide }: {
  items: EvenementSecurite[]; loading: boolean; suivante: boolean; chargerPlus: () => void; vide: string;
}) {
  if (!loading && items.length === 0) return <p className="text-sm text-slate-400 py-6 text-center">{vide}</p>;
  return (
    <div>
      <ul className="divide-y divide-slate-100 -mx-1">
        {items.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 px-1 py-2.5">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">
                {!e.lu && e.niveau !== "info" && <span className="inline-block h-2 w-2 rounded-full bg-rose-500 mr-2 align-middle" />}
                {e.description}
              </p>
              <p className="text-xs text-slate-400">
                {dateHeure(e.horodatage)}
                {e.adresse_ip && ` · ${e.adresse_ip}`}
                {e.appareil && ` · ${e.appareil}`}
              </p>
            </div>
            <Badge color={COULEUR_NIVEAU[e.niveau]}>{e.type_display}</Badge>
          </li>
        ))}
      </ul>
      {loading ? (
        <div className="flex justify-center py-3"><Spinner /></div>
      ) : suivante && (
        <div className="flex justify-center pt-3">
          <Button variant="ghost" onClick={chargerPlus}>Charger plus</Button>
        </div>
      )}
    </div>
  );
}

export default function SecuritePage() {
  const { logout } = useAuth();
  const toast = useToast();
  const confirmer = useConfirm();
  const demander = usePrompt();

  const [resume, setResume] = useState<ResumeSecurite | null>(null);
  const [sessions, setSessions] = useState<SessionActive[]>([]);
  const [appareils, setAppareils] = useState<AppareilConnu[]>([]);
  const [occupe, setOccupe] = useState(false);

  // Mise en place de l'application d'authentification : QR code → premier code → codes de secours.
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qr_code: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [codesAffiches, setCodesAffiches] = useState<string[] | null>(null);

  const [filtreConnexions, setFiltreConnexions] = useState("");
  const [filtreJournal, setFiltreJournal] = useState("");
  const connexions = useEvenements(securiteApi.connexions, filtreConnexions ? { resultat: filtreConnexions } : {});
  const journal = useEvenements(
    securiteApi.journal,
    filtreJournal === "alertes" ? { alertes: 1 } : filtreJournal ? { niveau: filtreJournal } : {},
  );

  const charger = useCallback(async () => {
    const [r, s, a] = await Promise.all([securiteApi.resume(), securiteApi.sessions(), securiteApi.appareils()]);
    setResume(r.data);
    setSessions(s.data);
    setAppareils(a.data);
  }, []);

  useEffect(() => {
    charger().catch((err) => toast.error(extractErrorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charger]);

  /** Exécute une action, affiche son erreur éventuelle, puis rafraîchit la page. */
  const executer = async (action: () => Promise<unknown>, succes?: string) => {
    setOccupe(true);
    try {
      await action();
      if (succes) toast.success(succes);
      await charger();
      journal.recharger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setOccupe(false);
    }
  };

  const motDePasse = (message: string) =>
    demander(message, { title: "Confirmez votre identité", label: "Mot de passe", inputType: "password", required: true, confirmLabel: "Continuer" });

  // -- 2FA -------------------------------------------------------------------

  const demarrerTotp = async () => {
    const mdp = await motDePasse("Saisissez votre mot de passe pour configurer l'application d'authentification.");
    if (!mdp) return;
    setOccupe(true);
    try {
      const { data } = await securiteApi.totpInitialiser(mdp);
      setTotpSetup(data);
      setTotpCode("");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setOccupe(false);
    }
  };

  const confirmerTotp = async (e?: FormEvent) => {
    e?.preventDefault();
    if (totpCode.length !== 6) return;
    setOccupe(true);
    try {
      const { data } = await securiteApi.totpActiver(totpCode);
      setTotpSetup(null);
      setCodesAffiches(data.codes_secours);
      toast.success("Application d'authentification activée.");
      await charger();
      journal.recharger();
    } catch (err) {
      setTotpCode("");
      toast.error(extractErrorMessage(err));
    } finally {
      setOccupe(false);
    }
  };

  useEffect(() => {
    if (totpSetup && totpCode.length === 6 && !occupe) confirmerTotp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totpCode]);

  const desactiverTotp = async () => {
    const mdp = await motDePasse("La connexion ne demandera plus le code de l'application d'authentification.");
    if (!mdp) return;
    const code = await demander("Code actuel de l'application (ou un code de secours).", {
      title: "Désactiver l'application d'authentification", label: "Code", placeholder: "123456", required: true, confirmLabel: "Désactiver",
    });
    if (!code) return;
    executer(() => securiteApi.totpDesactiver(mdp, code.trim()), "Application d'authentification désactivée.");
  };

  const regenererCodes = async () => {
    const mdp = await motDePasse("Les codes de secours actuels cesseront immédiatement de fonctionner.");
    if (!mdp) return;
    setOccupe(true);
    try {
      const { data } = await securiteApi.regenererCodesSecours(mdp);
      setCodesAffiches(data.codes_secours);
      await charger();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setOccupe(false);
    }
  };

  const basculerOtp = async () => {
    if (!resume) return;
    const mdp = await motDePasse(resume.otp_actif
      ? "Le code par e-mail/SMS ne sera plus demandé à la connexion."
      : "Un code sera envoyé par e-mail/SMS à chaque connexion.");
    if (!mdp) return;
    executer(() => securiteApi.basculerOtp(mdp, !resume.otp_actif), resume.otp_actif ? "Code par e-mail/SMS désactivé." : "Code par e-mail/SMS activé.");
  };

  // -- sessions / appareils ----------------------------------------------------

  const revoquerSession = async (s: SessionActive) => {
    const message = s.courante
      ? "C'est la session que vous utilisez : vous serez déconnecté."
      : `Fermer la session « ${s.appareil_libelle || "appareil inconnu"} » (${s.adresse_ip || "IP inconnue"}) ?`;
    if (!(await confirmer(message, { title: "Fermer la session", confirmLabel: "Fermer", danger: true }))) return;
    if (s.courante) {
      await securiteApi.revoquerSession(s.id).catch(() => undefined);
      logout();
      return;
    }
    executer(() => securiteApi.revoquerSession(s.id), "Session fermée.");
  };

  const revoquerAutres = async () => {
    if (!(await confirmer("Toutes les autres sessions seront fermées immédiatement. Vous resterez connecté ici.", {
      title: "Déconnecter les autres sessions", confirmLabel: "Déconnecter", danger: true,
    }))) return;
    executer(async () => {
      const { data } = await securiteApi.revoquerToutes(false);
      toast.success(`${data.revoquees} session(s) fermée(s).`);
    });
  };

  const revoquerPartout = async () => {
    if (!(await confirmer("Toutes vos sessions, y compris celle-ci, seront fermées. À utiliser si vous pensez que votre compte est compromis — pensez aussi à changer votre mot de passe.", {
      title: "Se déconnecter partout", confirmLabel: "Tout déconnecter", danger: true,
    }))) return;
    try {
      await securiteApi.revoquerToutes(true);
    } catch (err) {
      toast.error(extractErrorMessage(err));
      return;
    }
    toast.success("Toutes les sessions ont été fermées.");
    logout();
  };

  const retirerAppareil = async (a: AppareilConnu) => {
    const message = a.courant
      ? "C'est l'appareil que vous utilisez : vous serez déconnecté, et votre prochaine connexion depuis celui-ci sera signalée comme inhabituelle."
      : `Retirer « ${a.libelle || "appareil inconnu"} » ? Ses sessions seront fermées et une prochaine connexion depuis cet appareil déclenchera une alerte.`;
    if (!(await confirmer(message, { title: "Retirer l'appareil", confirmLabel: "Retirer", danger: true }))) return;
    if (a.courant) {
      await securiteApi.retirerAppareil(a.id).catch(() => undefined);
      logout();
      return;
    }
    executer(() => securiteApi.retirerAppareil(a.id), "Appareil retiré.");
  };

  if (!resume) return <div className="flex justify-center py-16"><Spinner /></div>;

  const deuxFacteurs = resume.totp_actif || resume.otp_actif;

  return (
    <div>
      <PageHeader
        title="Sécurité du compte"
        description="Double authentification, sessions, appareils et journal de sécurité de votre compte Super Admin."
        actions={<Button variant="danger" onClick={revoquerPartout} disabled={occupe}>⏻ Se déconnecter partout</Button>}
      />

      {resume.alertes_non_lues > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
          <div>
            <p className="font-bold text-rose-800">⚠️ {resume.alertes_non_lues} alerte{resume.alertes_non_lues > 1 ? "s" : ""} de sécurité non consultée{resume.alertes_non_lues > 1 ? "s" : ""}</p>
            <p className="text-sm text-rose-700">Connexion inhabituelle, verrouillage du compte, désactivation d'un facteur… Vérifiez qu'il s'agit bien de vous.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setFiltreJournal("alertes")}>Voir les alertes</Button>
            <Button variant="ghost" onClick={() => executer(() => securiteApi.marquerAlertesLues())} disabled={occupe}>Marquer comme lues</Button>
          </div>
        </div>
      )}

      {!deuxFacteurs && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="font-bold text-amber-800">Double authentification désactivée</p>
          <p className="text-sm text-amber-700">Votre mot de passe est la seule protection d'un compte qui a accès à toute la plateforme. Activez l'application d'authentification ci-dessous.</p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Double authentification" value={resume.totp_actif ? "Application" : resume.otp_actif ? "E-mail/SMS" : "Inactive"} icon="🔐" accent={deuxFacteurs ? "green" : "amber"} />
        <StatCard label="Sessions actives" value={resume.sessions_actives} icon="💻" accent="brand" />
        <StatCard label="Appareils connus" value={resume.appareils} icon="📱" accent="teal" />
        <StatCard label="Échecs (24 h)" value={resume.echecs_24h} icon="🚫" accent={resume.echecs_24h > 0 ? "rose" : "green"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="font-bold text-ink-900 mb-1">Double authentification (2FA)</h3>
          <p className="text-sm text-slate-500 mb-4">Un second facteur est exigé après le mot de passe à chaque connexion.</p>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    Application d'authentification {resume.totp_actif && <Badge color="green">Activée</Badge>}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Google Authenticator, Microsoft Authenticator, Authy… Recommandé : fonctionne sans réseau.</p>
                </div>
                {resume.totp_actif ? (
                  <Button variant="secondary" onClick={desactiverTotp} disabled={occupe}>Désactiver</Button>
                ) : (
                  <Button onClick={demarrerTotp} disabled={occupe}>Configurer</Button>
                )}
              </div>
              {resume.totp_actif && (
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap border-t border-slate-100 pt-3">
                  <p className={`text-xs ${resume.codes_secours_restants <= 2 ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                    {resume.codes_secours_restants} code{resume.codes_secours_restants > 1 ? "s" : ""} de secours restant{resume.codes_secours_restants > 1 ? "s" : ""}
                  </p>
                  <Button variant="ghost" onClick={regenererCodes} disabled={occupe}>Régénérer les codes</Button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-100 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  Code par e-mail/SMS {resume.otp_actif && <Badge color="green">Activé</Badge>}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {resume.totp_actif ? "Inutilisé tant que l'application d'authentification est activée (elle prime)." : "Un code à 6 chiffres est envoyé à chaque connexion."}
                </p>
              </div>
              <Button variant={resume.otp_actif ? "secondary" : "primary"} onClick={basculerOtp} disabled={occupe}>
                {resume.otp_actif ? "Désactiver" : "Activer"}
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="font-bold text-ink-900 mb-1">Limitation des tentatives</h3>
          <p className="text-sm text-slate-500 mb-4">Protection contre les essais de mots de passe en série.</p>
          <ul className="space-y-2 text-sm text-slate-600">
            <li>🔒 Après <strong>{resume.politique.max_echecs} échecs</strong> (mot de passe ou code 2FA) en {resume.politique.fenetre_minutes} min, le compte est verrouillé <strong>{resume.politique.duree_verrouillage_minutes} min</strong>.</li>
            <li>✉️ Le verrouillage vous est signalé par e-mail/SMS et dans le journal ci-dessous.</li>
            <li>🛡️ Un autre Super Admin peut lever le verrouillage depuis « Comptes Super Admin ».</li>
            <li>🌐 Les connexions sont aussi limitées par adresse IP.</li>
          </ul>
          {resume.connexion_precedente && (
            <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Connexion précédente</p>
              <p className="text-slate-700">
                {dateHeure(resume.connexion_precedente.horodatage)}
                {resume.connexion_precedente.appareil && ` · ${resume.connexion_precedente.appareil}`}
                {resume.connexion_precedente.adresse_ip && ` · ${resume.connexion_precedente.adresse_ip}`}
              </p>
              <p className="text-xs text-slate-400 mt-1">Ce n'était pas vous ? Déconnectez toutes les sessions et changez votre mot de passe.</p>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h3 className="font-bold text-ink-900">Sessions actives</h3>
              <p className="text-sm text-slate-500">Chaque connexion ouverte à votre compte.</p>
            </div>
            {sessions.length > 1 && (
              <Button variant="secondary" onClick={revoquerAutres} disabled={occupe}>Déconnecter les autres</Button>
            )}
          </div>
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Aucune session active.</p>
          ) : (
            <ul className="divide-y divide-slate-100 -mx-1">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-1 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">
                      {s.appareil_libelle || "Appareil inconnu"} {s.courante && <Badge color="green">Cette session</Badge>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {s.adresse_ip || "IP inconnue"} · ouverte le {dateHeure(s.cree_le)} · active {ilYa(s.derniere_activite)}
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => revoquerSession(s)} disabled={occupe}>Fermer</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="font-bold text-ink-900 mb-1">Appareils connectés</h3>
          <p className="text-sm text-slate-500 mb-4">Navigateurs déjà utilisés pour vous connecter. Une connexion depuis un nouvel appareil ou une nouvelle adresse IP déclenche une alerte.</p>
          {appareils.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Aucun appareil enregistré.</p>
          ) : (
            <ul className="divide-y divide-slate-100 -mx-1">
              {appareils.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-1 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">
                      {a.libelle || "Appareil inconnu"} {a.courant && <Badge color="green">Cet appareil</Badge>}
                      {a.sessions_actives > 0 && !a.courant && <Badge color="brand">{a.sessions_actives} session{a.sessions_actives > 1 ? "s" : ""}</Badge>}
                    </p>
                    <p className="text-xs text-slate-400">
                      Dernière connexion {dateHeure(a.derniere_connexion)}{a.derniere_ip && ` · ${a.derniere_ip}`} · vu pour la 1re fois le {new Date(a.premiere_connexion).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => retirerAppareil(a)} disabled={occupe}>Retirer</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h3 className="font-bold text-ink-900">Historique des connexions</h3>
              <p className="text-sm text-slate-500">Connexions réussies et tentatives échouées.</p>
            </div>
            <select
              value={filtreConnexions}
              onChange={(e) => setFiltreConnexions(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">Toutes</option>
              <option value="succes">Réussies</option>
              <option value="echec">Échouées / bloquées</option>
            </select>
          </div>
          <ListeEvenements {...connexions} vide="Aucune connexion enregistrée." />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h3 className="font-bold text-ink-900">Journal de sécurité</h3>
              <p className="text-sm text-slate-500">Toutes les actions sensibles sur votre compte.</p>
            </div>
            <select
              value={filtreJournal}
              onChange={(e) => setFiltreJournal(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">Tout</option>
              <option value="alertes">Alertes non lues</option>
              <option value="critique">Critique</option>
              <option value="avertissement">Avertissement</option>
              <option value="info">Information</option>
            </select>
          </div>
          <ListeEvenements {...journal} vide="Aucun événement." />
        </Card>
      </div>

      <Modal open={!!totpSetup} onClose={() => setTotpSetup(null)} title="Configurer l'application d'authentification">
        {totpSetup && (
          <form noValidate onSubmit={confirmerTotp} className="space-y-4">
            <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
              <li>Ouvrez votre application d'authentification.</li>
              <li>Scannez ce QR code (ou saisissez la clé manuellement).</li>
              <li>Saisissez le code à 6 chiffres affiché.</li>
            </ol>
            <img src={totpSetup.qr_code} alt="QR code de configuration" className="mx-auto h-48 w-48 rounded-xl border border-slate-100" />
            <p className="text-center text-xs text-slate-500">
              Clé : <span className="font-mono tracking-wider text-slate-700 select-all break-all">{totpSetup.secret.match(/.{1,4}/g)?.join(" ")}</span>
            </p>
            <OtpBoxInput value={totpCode} onChange={setTotpCode} autoFocus disabled={occupe} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTotpSetup(null)}>Annuler</Button>
              <Button type="submit" disabled={occupe || totpCode.length !== 6}>{occupe ? "…" : "Activer"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!codesAffiches} onClose={() => setCodesAffiches(null)} title="Vos codes de secours">
        {codesAffiches && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Si vous perdez votre téléphone, chacun de ces codes permet <strong>une</strong> connexion à la place du code de
              l'application. <strong>Ils ne seront plus jamais affichés</strong> : téléchargez-les ou notez-les maintenant.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4">
              {codesAffiches.map((c) => (
                <code key={c} className="text-center font-mono text-sm tracking-widest text-ink-900">{c}</code>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => telechargerCodes(codesAffiches)}>⬇️ Télécharger</Button>
              <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(codesAffiches.join("\n")).then(() => toast.success("Codes copiés."))}>📋 Copier</Button>
              <Button onClick={() => setCodesAffiches(null)}>J'ai conservé mes codes</Button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
