import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiClient, ApiError, canBuild } from "../../api/client";
import type { Artifact, Organization, ScenarioCreate } from "../../api/types";
import { useLoad } from "../../shared/async";
import { Empty, ErrorNotice, JsonView, Status } from "../../shared/ui";

function ScenarioDetail({
  client,
  org,
  id,
}: {
  client: ApiClient;
  org: string;
  id: string;
}) {
  const loaded = useLoad(() => client.scenario(org, id), [client, org, id]);
  if (loaded.loading) return <p role="status">Chargement du scénario…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  const record = loaded.data;
  const document = record.document;
  return (
    <section className="panel" data-testid="scenario-detail">
      <h2>{document.name}</h2>
      <Status value={record.model_state} />
      <p>
        Copie identique isolée. Les équations, paramètres et données de
        référence sont conservés.
      </p>
      <dl>
        <dt>Identité / version du scénario</dt>
        <dd>
          {record.key} · {record.version}
        </dd>
        <dt>Auteur</dt>
        <dd>{record.created_by}</dd>
        <dt>Justification</dt>
        <dd>{document.reason}</dd>
        <dt>Snapshot immuable</dt>
        <dd>{document.data_snapshot_id}</dd>
        <dt>Empreinte du scénario</dt>
        <dd>{record.content_hash}</dd>
        <dt>Référence publiée</dt>
        <dd>
          <Link
            to={`/organizations/${org}/models/${record.source_model_version_id}`}
          >
            {record.source_model_version_id}
          </Link>
        </dd>
        <dt>Empreinte de référence</dt>
        <dd>{document.source_content_hash}</dd>
        <dt>Modèle du scénario</dt>
        <dd>
          <Link
            data-testid="scenario-model-link"
            to={`/organizations/${org}/models/${record.model_version_id}`}
          >
            {record.model_version_id}
          </Link>
        </dd>
        <dt>Empreinte du modèle dérivé</dt>
        <dd>{document.model_content_hash}</dd>
      </dl>
      <p className="notice">
        {record.model_state === "DRAFT"
          ? "Le modèle du scénario doit être publié explicitement par ADMIN ou APPROVER avant tout calcul."
          : "Le modèle est publié ; sa résolution utilise les autorisations et limites de l'Optimization Center."}
      </p>
      <Link to={`/organizations/${org}/execution`}>
        Ouvrir Optimization Center
      </Link>
      <p>
        La comparaison et les gains ne sont pas encore disponibles dans cette
        première tranche.
      </p>
      <JsonView title="Provenance canonique du scénario" value={record} />
    </section>
  );
}

function CreateScenario({
  client,
  organization,
  models,
  onCreated,
}: {
  client: ApiClient;
  organization: Organization;
  models: Artifact[];
  onCreated: (id: string) => void;
}) {
  const [sourceId, setSource] = useState("");
  const [key, setKey] = useState("");
  const [version, setVersion] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef(true);
  const sending = useRef(false);
  const completed = useRef(false);
  const captured = useRef<ScenarioCreate | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const published = models.filter(
    (m) => m.organization_id === organization.id && m.state === "PUBLISHED",
  );
  const locked = busy || uncertain || done;
  async function submit() {
    if (sending.current || completed.current) return;
    const source = published.find((m) => m.id === sourceId);
    if (!captured.current && !source) return;
    const body: ScenarioCreate = captured.current ?? {
      key,
      version,
      name,
      reason,
      source_model_version_id: source!.id,
      expected_source_content_hash: source!.content_hash,
    };
    captured.current = body;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await client.createScenario(organization.id, body);
      if (active.current) {
        completed.current = true;
        captured.current = null;
        setUncertain(false);
        setDone(true);
        onCreated(result.id);
      }
    } catch (failure) {
      if (!active.current) return;
      const rejected =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500;
      if (rejected) captured.current = null;
      setUncertain(!rejected);
      setError(
        failure instanceof Error ? failure.message : "Création indisponible.",
      );
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  }
  if (!published.length)
    return <Empty>Un modèle publié est requis pour créer un scénario.</Empty>;
  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2>Créer un scénario identique</h2>
      <p>
        Cette première tranche conserve toutes les hypothèses. Les modifications
        de paramètres ou de contraintes ne sont pas proposées.
      </p>
      <ErrorNotice message={error} />
      <label>
        Modèle publié de référence
        <select
          required
          disabled={locked}
          value={sourceId}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Choisir une référence</option>
          {published.map((m) => (
            <option key={m.id} value={m.id}>
              {m.key} · {m.version} · {m.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Clé du scénario
        <input
          required
          pattern="[A-Za-z][A-Za-z0-9_]*"
          maxLength={100}
          disabled={locked}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <label>
        Version du scénario
        <input
          required
          maxLength={500}
          disabled={locked}
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        />
      </label>
      <label>
        Nom du scénario
        <input
          required
          maxLength={500}
          disabled={locked}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Justification du scénario
        <textarea
          required
          maxLength={500}
          disabled={locked}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {uncertain && error && (
        <p className="notice">
          Réception incertaine : réessayez exactement la même création, ou
          consultez la liste avant une nouvelle demande.
        </p>
      )}
      <button className="primary" disabled={busy || done} type="submit">
        {busy
          ? "Enregistrement…"
          : uncertain
            ? "Réessayer la même création"
            : "Créer la copie isolée"}
      </button>
    </form>
  );
}

export function ScenarioLab({
  client,
  organization,
  models,
  refresh,
}: {
  client: ApiClient;
  organization: Organization;
  models: Artifact[];
  refresh: () => void;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.scenarios(organization.id, offset),
    [client, organization.id, offset, revision, id],
  );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">SCENARIO LAB · PREMIÈRE TRANCHE</span>
        <h1>Scénarios isolés et traçables</h1>
        <p>
          La référence publiée reste immuable. Chaque création conserve une
          version distincte.
        </p>
      </div>
      {id ? (
        <>
          <Link to={`/organizations/${organization.id}/scenarios`}>
            Retour aux scénarios
          </Link>
          <ScenarioDetail
            key={`${organization.id}:${id}`}
            client={client}
            org={organization.id}
            id={id}
          />
        </>
      ) : (
        canBuild(organization.role) && (
          <CreateScenario
            key={organization.id}
            client={client}
            organization={organization}
            models={models}
            onCreated={(identity) => {
              navigate(
                `/organizations/${organization.id}/scenarios/${identity}`,
              );
              refresh();
            }}
          />
        )
      )}
      <section className="panel">
        <h2>Historique des scénarios</h2>
        <button onClick={() => setRevision((n) => n + 1)}>
          Actualiser les scénarios
        </button>
        {loaded.loading ? (
          <p role="status">Chargement des versions…</p>
        ) : loaded.data ? (
          <>
            {!loaded.data.items.length ? (
              <Empty>Aucun scénario enregistré.</Empty>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Scénario / version</th>
                      <th>Nom</th>
                      <th>État du modèle</th>
                      <th>Auteur</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.data.items.map((record) => (
                      <tr key={record.id}>
                        <td>
                          {record.key} · {record.version}
                        </td>
                        <td>{record.document.name}</td>
                        <td>{record.model_state}</td>
                        <td>{record.created_by}</td>
                        <td>
                          <Link
                            to={`/organizations/${organization.id}/scenarios/${record.id}`}
                          >
                            Consulter le scénario
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="actions">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Versions précédentes
              </button>
              <button
                disabled={loaded.data.items.length < 50}
                onClick={() => setOffset(offset + 50)}
              >
                Versions suivantes
              </button>
            </div>
          </>
        ) : (
          <ErrorNotice message={loaded.error} />
        )}
      </section>
    </>
  );
}
