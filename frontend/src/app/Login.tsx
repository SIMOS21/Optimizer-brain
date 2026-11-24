import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiClient } from "../api/client";
import type { Schemas } from "../api/types";
import { ErrorNotice } from "../shared/ui";
type User = Schemas["UserResponse"];
export function Login({
  client,
  onLogin,
  notice,
}: {
  client: ApiClient;
  onLogin: (user: User) => void;
  notice?: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-story">
        <Link className="brand" to="/">
          <span className="brand-mark">OB</span> Optimization Brain
        </Link>
        <span className="eyebrow">VISUAL ORGANIZATION STUDIO</span>
        <h1>
          Rendez vos règles
          <br />
          visibles. Vos décisions
          <br />
          vérifiables.
        </h1>
        <p>
          Un espace commun pour les départements,
          <br />
          les ressources et les contraintes de votre organisation.
        </p>
        <div className="login-diagram" aria-hidden="true">
          <span>Départements</span>
          <i />
          <span>Ressources partagées</span>
          <i />
          <span>Modèle mathématique</span>
        </div>
        <small>Modèles versionnés · Décisions vérifiées</small>
      </div>
      <section className="login-form">
        <span className="eyebrow">VOTRE WORKSPACE</span>
        <h2>Se connecter au Studio</h2>
        <p>Utilisez un compte provisionné par votre administrateur.</p>
        <ErrorNotice message={error || notice} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(undefined);
            void client
              .login(username, password)
              .then((user) => {
                setPassword("");
                onLogin(user);
              })
              .catch((reason: unknown) => {
                setPassword("");
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Connexion refusée.",
                );
              })
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Identifiant
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Connexion…" : "Accéder au workspace"}
          </button>
        </form>
        <p className="quiet">
          La session reste uniquement en mémoire. Un rechargement demande une
          nouvelle connexion.
        </p>
      </section>
    </main>
  );
}
