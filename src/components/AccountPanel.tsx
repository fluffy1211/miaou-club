import { useEffect, useState, type SubmitEvent } from "react";
type Mode = "login" | "signup" | "forgot" | "reset" | "profile";
type Profile = {
  handle: string | null;
  displayName: string;
  bio: string;
  color: string;
  avatar: string;
};
type Me = {
  user: { email: string };
  profile: Profile | null;
  access: string;
  status: string;
  reason: string | null;
  role: string;
  methods: string[];
  mfaEnabled: boolean;
  mfaValid: boolean;
  recoveryPending: boolean;
};
export function AccountPanel({
  mode = "login",
  returnTo = "/profil",
  preview = false,
}: {
  mode?: Mode;
  returnTo?: string;
  preview?: boolean;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [options, setOptions] = useState({ google: false, signup: false });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [factor, setFactor] = useState<{
    totpURI?: string;
    backupCodes?: string[];
  } | null>(null);
  const load = async () => {
    const r = await fetch("/api/v1/me");
    if (r.ok) setMe(await r.json());
  };
  useEffect(() => {
    if (preview) return;
    void load();
    void fetch("/api/v1/auth-options")
      .then((r) => r.json())
      .then(setOptions)
      .catch(() => setMessage("Le club est temporairement indisponible."));
  }, [preview]);
  async function send(
    path: string,
    body: Record<string, unknown> | undefined,
    method = "POST",
  ) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) {
        setMessage(
          r.status === 429
            ? `Réessaie dans ${result.retryAfter ?? 30} secondes.`
            : r.status === 503
              ? "Le service est temporairement indisponible."
              : "L’action n’a pas abouti. Vérifie les informations et tes droits d’accès.",
        );
        return null;
      }
      return result;
    } catch {
      setMessage("Connexion interrompue. Réessaie.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  const values = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget).entries());
  };
  const go = () => window.location.assign(returnTo);
  async function login(e: SubmitEvent<HTMLFormElement>) {
    const result = await send("/api/auth/sign-in/email", values(e));
    if (result?.twoFactorRedirect) setChallenge(true);
    else if (result) go();
  }
  async function signup(e: SubmitEvent<HTMLFormElement>) {
    const v = values(e);
    if (
      await send("/api/auth/sign-up/email", {
        ...v,
        acceptedTerms: v.acceptedTerms === "on",
      })
    )
      go();
  }
  async function google(e: SubmitEvent<HTMLFormElement>) {
    const v = values(e);
    const result = await send("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: returnTo,
      acceptedTerms: v.acceptedTerms === "on",
    });
    if (result?.url) window.location.assign(result.url);
  }
  const terms = (
    <label className="account-consent">
      <input name="acceptedTerms" type="checkbox" required />{" "}
      <span>
        Je déclare avoir 18 ans ou plus et j’accepte les{" "}
        <a href="/conditions">conditions générales d’utilisation</a>.
      </span>
    </label>
  );
  const password = (auto = "current-password") => (
    <label>
      Ton mot de passe
      <input
        name={auto === "new-password" ? "newPassword" : "password"}
        type="password"
        autoComplete={auto}
        minLength={auto === "new-password" ? 12 : undefined}
        required
      />
    </label>
  );
  const email = (
    <label>
      Ton e-mail
      <input name="email" type="email" autoComplete="email" required />
    </label>
  );
  return (
    <section className="account-panel">
      <a className="account-brand" href="/profil">
        miaou club
      </a>
      <p role="status" aria-live="polite" className="account-message">
        {message}
      </p>
      {me && (mode === "profile" || mode === "login") ? (
        <>
          <h1>Mon profil</h1>
          <div
            className={`account-paper account-color-${me.profile?.color ?? "violet"}`}
          >
            <span className="account-avatar" aria-hidden="true">
              {me.profile?.avatar === "cat"
                ? "∧ ∧"
                : (me.profile?.displayName ?? "M").slice(0, 1)}
            </span>
            <h2>{me.profile?.displayName ?? "Ton compte"}</h2>
            <p>{me.profile?.bio}</p>
          </div>
          {me.access !== "group" ? (
            <div role="note">
              <h2>Ton espace personnel</h2>
              <a href="/carnet">Retrouver mon carnet</a>
              <p>
                {me.reason ??
                  "L’accès au groupe n’est pas autorisé pour ce compte."}
              </p>
              <p>Ton adresse : {me.user.email}</p>
              <p>
                Pour obtenir tes données ou demander la suppression de ton
                compte, contacte Gabriel par votre canal habituel.
              </p>
            </div>
          ) : (
            <>
              <p>
                <a href="/photo">Photographier un chat</a> ·{" "}
                <a href="/carnet">Mon carnet</a>
                {me.profile?.handle && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={"/profil/" + me.profile.handle}>
                      Voir mon profil public
                    </a>
                  </>
                )}
              </p>
              <a href="/races">Découvrir le catalogue</a>
              <form
                onSubmit={async (e) => {
                  const v = values(e);
                  if (await send("/api/v1/me/profile", v, "PATCH")) {
                    setMessage("Profil enregistré.");
                    await load();
                  }
                }}
              >
                <h2>Personnaliser mon profil</h2>
                <label>
                  Identifiant public
                  <input
                    name="handle"
                    defaultValue={me.profile?.handle ?? ""}
                    readOnly={Boolean(me.profile?.handle)}
                    pattern="[a-z0-9_]{3,30}"
                    minLength={3}
                    maxLength={30}
                    required
                  />
                  <small>Unique et définitif après enregistrement.</small>
                </label>
                <label>
                  Nom affiché
                  <input
                    name="displayName"
                    defaultValue={me.profile?.displayName ?? ""}
                    maxLength={60}
                    required
                  />
                </label>
                <label>
                  Biographie
                  <textarea
                    name="bio"
                    defaultValue={me.profile?.bio ?? ""}
                    maxLength={240}
                  />
                </label>
                <label>
                  Couleur
                  <select
                    name="color"
                    defaultValue={me.profile?.color ?? "violet"}
                  >
                    <option value="violet">Violet</option>
                    <option value="corail">Corail</option>
                    <option value="sauge">Sauge</option>
                  </select>
                </label>
                <label>
                  Avatar
                  <select
                    name="avatar"
                    defaultValue={me.profile?.avatar ?? "initials"}
                  >
                    <option value="initials">Initiale</option>
                    <option value="cat">Chat</option>
                  </select>
                </label>
                <button disabled={busy}>Enregistrer le profil</button>
              </form>
            </>
          )}
          <section>
            <h2>Sécurité du compte</h2>
            <p>
              Méthodes liées : {me.methods.join(", ")}. Ton e-mail reste privé.
            </p>
            {me.role === "admin" && me.mfaValid && (
              <button
                disabled={busy}
                onClick={async () => {
                  const quota = await send(
                    "/api/v1/admin/mail-quota",
                    undefined,
                    "GET",
                  );
                  if (quota)
                    setMessage(
                      `${quota.requestedLast24Hours} demandes d’e-mail sur 24 heures, limite de l’application : ${quota.applicationDailyLimit}. Le quota du fournisseur se consulte chez Resend.`,
                    );
                }}
              >
                Consulter le quota d’e-mails
              </button>
            )}
            {me.methods.includes("credential") ? (
              <form
                onSubmit={async (e) => {
                  if (await send("/api/v1/reauth", values(e)))
                    setMessage(
                      "Identité confirmée pour les prochaines actions sensibles.",
                    );
                }}
              >
                {password()}
                <button disabled={busy}>Confirmer mon identité</button>
              </form>
            ) : (
              options.google && (
                <form onSubmit={google}>
                  <button disabled={busy}>
                    Confirmer mon identité avec Google
                  </button>
                </form>
              )
            )}
            {options.google && !me.methods.includes("google") && (
              <button
                disabled={busy}
                onClick={async () => {
                  const r = await send("/api/auth/link-social", {
                    provider: "google",
                    callbackURL: "/profil",
                  });
                  if (r?.url) window.location.assign(r.url);
                }}
              >
                Lier Google à ce compte
              </button>
            )}
            {!me.methods.includes("credential") && (
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    await send("/api/auth/request-password-reset", {
                      email: me.user.email,
                    })
                  )
                    setMessage(
                      "Si l’action est autorisée, un lien de confirmation est envoyé à ton adresse.",
                    );
                }}
              >
                Ajouter un mot de passe par e-mail
              </button>
            )}
            <button
              disabled={busy}
              onClick={async () => {
                if (await send("/api/v1/me/revoke-others", {}))
                  setMessage("Les autres sessions sont déconnectées.");
              }}
            >
              Déconnecter les autres sessions
            </button>
            <a href="/donnees">Mes données et suppression du compte</a>
            {me.role === "admin" && me.mfaValid && (
              <a href="/administration">Administration et signalements</a>
            )}
            {me.role === "admin" && (
              <>
                {me.mfaValid && (
                  <form
                    onSubmit={async (e) => {
                      if (await send("/api/v1/admin/admissions", values(e)))
                        setMessage("Admission mise à jour.");
                    }}
                  >
                    <h2>Admission au pilote</h2>
                    <label>
                      Adresse de la personne
                      <input name="email" type="email" required />
                    </label>
                    <label>
                      Action
                      <select name="action">
                        <option value="admit">Autoriser cette adresse</option>
                        <option value="withdraw">Retirer l’admission</option>
                      </select>
                    </label>
                    <button disabled={busy}>Appliquer l’admission</button>
                  </form>
                )}
                <h2>Double authentification admin</h2>
                <p>
                  {me.recoveryPending
                    ? "Récupération en cours : configure et vérifie un nouveau facteur."
                    : me.mfaValid
                      ? "Accès administratif déverrouillé."
                      : "Vérification requise avant tout accès administratif."}
                </p>
                {(!me.mfaEnabled || me.recoveryPending) && (
                  <form
                    onSubmit={async (e) => {
                      const r = await send(
                        "/api/auth/two-factor/enable",
                        values(e),
                      );
                      if (r) setFactor(r);
                    }}
                  >
                    {me.methods.includes("credential") && password()}
                    <button disabled={busy}>Configurer un nouveau TOTP</button>
                  </form>
                )}
                {factor && (
                  <div className="account-factor">
                    <p>
                      Ajoute ce secret dans ton application d’authentification,
                      puis confirme un code.
                    </p>
                    <output>{factor.totpURI}</output>
                    <p>Conserve ces codes de secours en lieu sûr :</p>
                    <output>{factor.backupCodes?.join(" · ")}</output>
                  </div>
                )}
                <form
                  onSubmit={async (e) => {
                    if (
                      await send("/api/auth/two-factor/verify-totp", values(e))
                    ) {
                      setFactor(null);
                      await load();
                      setMessage("Code vérifié.");
                    }
                  }}
                >
                  <label>
                    Code TOTP
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      required
                    />
                  </label>
                  <button disabled={busy}>Vérifier le code TOTP</button>
                </form>
                <form
                  onSubmit={async (e) => {
                    if (
                      await send(
                        "/api/auth/two-factor/verify-backup-code",
                        values(e),
                      )
                    ) {
                      await load();
                      setMessage("Configure maintenant un nouveau TOTP.");
                    }
                  }}
                >
                  <label>
                    Code de secours
                    <input name="code" autoComplete="off" required />
                  </label>
                  <button disabled={busy}>
                    Récupérer avec un code de secours
                  </button>
                </form>
              </>
            )}
          </section>
          <button
            disabled={busy}
            onClick={async () => {
              if (await send("/api/auth/sign-out", {})) {
                try {
                  for (const key of Object.keys(sessionStorage))
                    if (key.startsWith("miaou-draft-"))
                      sessionStorage.removeItem(key);
                } catch {
                  /* Storage may be disabled. */
                }
                window.location.assign("/profil");
              }
            }}
          >
            Se déconnecter
          </button>
        </>
      ) : challenge ? (
        <>
          <h1>Vérifie ta connexion</h1>
          <form
            onSubmit={async (e) => {
              if (await send("/api/auth/two-factor/verify-totp", values(e)))
                go();
            }}
          >
            <label>
              Code TOTP
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </label>
            <button disabled={busy}>Valider le code</button>
          </form>
          <form
            onSubmit={async (e) => {
              if (
                await send("/api/auth/two-factor/verify-backup-code", values(e))
              )
                window.location.assign("/profil");
            }}
          >
            <label>
              Code de secours
              <input name="code" required />
            </label>
            <button disabled={busy}>Utiliser un code de secours</button>
          </form>
        </>
      ) : mode === "signup" ? (
        <>
          <h1>Crée ton petit carnet.</h1>
          <p>Le pilote est réservé aux personnes admises par Gabriel.</p>
          {options.signup ? (
            <form onSubmit={signup}>
              <label>
                Ton nom affiché
                <input
                  name="name"
                  autoComplete="nickname"
                  maxLength={60}
                  required
                />
              </label>
              {email}
              {password()}
              {terms}
              <button disabled={busy}>Créer mon compte</button>
            </form>
          ) : (
            <p>Les inscriptions ne sont pas encore ouvertes.</p>
          )}
          <a href="/profil">J’ai déjà un compte</a>
        </>
      ) : mode === "forgot" ? (
        <>
          <h1>Retrouve ton compte.</h1>
          <form
            onSubmit={async (e) => {
              if (await send("/api/auth/request-password-reset", values(e)))
                setMessage(
                  "Si ton compte le permet, un lien de réinitialisation est envoyé à ton adresse.",
                );
            }}
          >
            {email}
            <button disabled={busy}>
              Recevoir un lien de réinitialisation
            </button>
          </form>
          <a href="/profil">Retour à la connexion</a>
        </>
      ) : mode === "reset" ? (
        <>
          <h1>Choisis un nouveau mot de passe.</h1>
          <form
            onSubmit={async (e) => {
              const v = values(e);
              const token = new URLSearchParams(window.location.search).get(
                "token",
              );
              if (await send("/api/auth/reset-password", { ...v, token })) {
                window.history.replaceState(null, "", "/reinitialisation");
                setMessage(
                  "Mot de passe modifié. Connecte-toi avec ton nouveau mot de passe.",
                );
              }
            }}
          >
            {password("new-password")}
            <button disabled={busy}>Changer le mot de passe</button>
          </form>
          <a href="/profil">Se connecter</a>
        </>
      ) : (
        <>
          <h1>Retrouve ton petit monde.</h1>
          <p>Tes Polaroids, tes amis, ton profil.</p>
          <form onSubmit={login}>
            {email}
            {password()}
            <button disabled={busy}>Se connecter</button>
          </form>
          <p>
            Première visite ? <a href="/compte">Créer un compte</a>
          </p>
          <a href="/mot-de-passe-oublie">Mot de passe oublié</a>
          <p>
            Si tu as perdu tous tes accès, contacte Gabriel par votre moyen
            habituel.
          </p>
          {options.google && (
            <form onSubmit={google}>
              <div className="account-divider">ou</div>
              {terms}
              <button className="account-google" disabled={busy}>
                Continuer avec Google
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
