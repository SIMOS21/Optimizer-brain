import { useState } from "react";
import { Link, Route, Routes, useMatch, useNavigate } from "react-router-dom";
import { ApiClient } from "../api/client";
import type { Schemas } from "../api/types";
import { Workspace } from "../features/organizations/Workspace";
import { useLoad } from "../shared/async";
import { Empty, ErrorNotice } from "../shared/ui";

type User = Schemas["UserResponse"];
function Login({
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
        <small>Phase 4B · Sans LLM · Données et versions explicites</small>
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
function SignedIn({
  client,
  user,
  logout,
}: {
  client: ApiClient;
  user: User;
  logout: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [newOrganization, setNewOrganization] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const loaded = useLoad(() => client.organizations(), [client, revision]);
  const navigate = useNavigate();
  const match = useMatch("/organizations/:organizationId/*");
  const selected = match?.params.organizationId || "";
  const organization = loaded.data?.find((item) => item.id === selected);
  return (
    <>
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="brand-mark">OB</span>
          <span>
            Optimization Brain<small>Organization Studio</small>
          </span>
        </Link>
        <label className="organization-switcher">
          Organisation
          <select
            value={organization?.id || ""}
            onChange={(event) => {
              client.abort();
              navigate(
                event.target.value
                  ? `/organizations/${event.target.value}`
                  : "/",
              );
            }}
          >
            <option value="">Choisir une organisation</option>
            {loaded.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.role}
              </option>
            ))}
          </select>
        </label>
        <div className="user-menu">
          <span>{user.display_name}</span>
          <button onClick={logout}>Déconnexion</button>
        </div>
      </header>
      {loaded.loading ? (
        <p role="status">Chargement des organisations…</p>
      ) : loaded.error ? (
        <ErrorNotice message={loaded.error} />
      ) : (
        <Routes>
          <Route
            path="/organizations/:organizationId/*"
            element={
              organization ? (
                <Workspace
                  key={organization.id}
                  client={client}
                  organizationId={organization.id}
                />
              ) : (
                <Empty>Organisation absente ou inaccessible.</Empty>
              )
            }
          />
          <Route
            path="*"
            element={
              <main className="organization-picker" id="main-content">
                <span className="eyebrow">VOS ORGANISATIONS</span>
                <h1>Choisissez votre espace de travail.</h1>
                <p>Seules vos organisations autorisées sont proposées.</p>
                <div className="organization-cards">
                  {loaded.data?.map((item) => (
                    <Link key={item.id} to={`/organizations/${item.id}`}>
                      <span className="node-symbol">O</span>
                      <h2>{item.name}</h2>
                      <code>{item.key}</code>
                      <span className="role">{item.role}</span>
                      <span>Ouvrir le workspace →</span>
                    </Link>
                  ))}
                </div>
                {!loaded.data?.length && (
                  <Empty>
                    Aucune appartenance active. Créez une organisation ou
                    contactez votre administrateur.
                  </Empty>
                )}
                <button onClick={() => setNewOrganization(!newOrganization)}>
                  Créer une organisation
                </button>
                {newOrganization && (
                  <form
                    className="panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setBusy(true);
                      setError(undefined);
                      void client
                        .request(
                          "/organizations",
                          "OrganizationResponse",
                          "POST",
                          { key, name },
                        )
                        .then((item) => {
                          setRevision((value) => value + 1);
                          setNewOrganization(false);
                          navigate(`/organizations/${item.id}`);
                        })
                        .catch((reason: unknown) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : "Création refusée.",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    <ErrorNotice message={error} />
                    <label>
                      Clé de l’organisation
                      <input
                        required
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                      />
                    </label>
                    <label>
                      Nom de l’organisation
                      <input
                        required
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Créer l’espace
                    </button>
                  </form>
                )}
              </main>
            }
          />
        </Routes>
      )}
    </>
  );
}
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<string>();
  const navigate = useNavigate();
  const [client] = useState(
    () =>
      new ApiClient(() => {
        setUser(null);
        setNotice("Session expirée. Reconnectez-vous.");
        navigate("/");
      }),
  );
  function logout() {
    setUser(null);
    setNotice(undefined);
    navigate("/");
    void client.logout().then((revoked) => {
      if (!revoked)
        setNotice(
          "Session locale supprimée. Révocation serveur non confirmée ; le jeton reste soumis à son expiration.",
        );
    });
  }
  return user ? (
    <SignedIn key={user.id} client={client} user={user} logout={logout} />
  ) : (
    <Login
      client={client}
      notice={notice}
      onLogin={(current) => {
        setUser(current);
        setNotice(undefined);
        navigate("/");
      }}
    />
  );
}
