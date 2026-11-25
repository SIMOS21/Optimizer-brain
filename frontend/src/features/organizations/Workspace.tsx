import { compareMetadata } from "../models/comparison";
import { lazy, Suspense, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ApiClient, canBuild } from "../../api/client";
import type {
  Artifact,
  Department,
  GraphArtifact,
  Organization,
} from "../../api/types";
import { useLoad } from "../../shared/async";
import { Empty, ErrorNotice, JsonView, Status } from "../../shared/ui";
import { Skeleton } from "../../shared/design-system";
import { Publish } from "../../shared/Publish";
import { GraphEditor } from "../graph/GraphEditor";
import { History } from "../history/History";
import { ModelEditor, ModelInspector } from "../models/ModelInspector";
import { canonical } from "../../api/validation";
import { exportGraph } from "../graph/projection";
import { ArtifactImport } from "./ArtifactImport";
import { StoredRun } from "../execution/DecisionCockpit";
import { ConstraintDiagnostics } from "../diagnostics/ConstraintDiagnostics";
import { Dashboard } from "../dashboard/Dashboard";

const OptimizationCenter = lazy(() =>
  import("../execution/OptimizationCenter").then((module) => ({
    default: module.OptimizationCenter,
  })),
);

const ScenarioLab = lazy(() =>
  import("../scenarios/ScenarioLab").then((module) => ({
    default: module.ScenarioLab,
  })),
);

const GraphCanvas = lazy(() =>
  import("../graph/GraphCanvas").then((module) => ({
    default: module.GraphCanvas,
  })),
);

function ArtifactList({
  title,
  records,
  base,
}: {
  title: string;
  records: Artifact[];
  base: string;
}) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{title}</h2>
        <span>{records.length} version(s)</span>
      </div>
      {!records.length ? (
        <Empty>Aucune version enregistrée.</Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Identité / version</th>
                <th>État</th>
                <th>Création</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.key}</strong>
                    <small>
                      v{record.version} · {record.id}
                    </small>
                  </td>
                  <td>
                    <Status value={record.state} />
                  </td>
                  <td>
                    {new Date(record.created_at * 1000).toLocaleDateString(
                      "fr-FR",
                    )}
                  </td>
                  <td>
                    <Link to={`${base}/${record.id}`}>
                      Ouvrir <span aria-hidden="true">↗</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function DepartmentRegistry({
  client,
  organization,
  departments,
  refresh,
}: {
  client: ApiClient;
  organization: Organization;
  departments: Department[];
  refresh: () => void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h2>Départements enregistrés</h2>
      <div className="department-grid">
        {departments.map((department) => (
          <article key={department.id}>
            <span className="node-symbol">D</span>
            <h3>{department.name}</h3>
            <code>{department.key}</code>
            <small>
              Propriétaire : {department.owner_user_id || "Non affecté"}
            </small>
          </article>
        ))}
      </div>
      {!departments.length && (
        <Empty>
          Aucun département. Enregistrez les identifiants utilisés par vos
          graphes.
        </Empty>
      )}
      {organization.role === "ADMIN" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(undefined);
            void client
              .request(
                `/organizations/${organization.id}/departments`,
                "DepartmentResponse",
                "POST",
                { key, name },
              )
              .then(() => {
                setKey("");
                setName("");
                refresh();
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Enregistrement refusé.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <ErrorNotice message={error} />
          <div className="inline-form">
            <label>
              Identifiant du département
              <input
                required
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <label>
              Nom du département
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button disabled={busy} type="submit">
              Enregistrer un département
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function GraphPage({
  client,
  organization,
  id,
  refresh,
}: {
  client: ApiClient;
  organization: Organization;
  id: string;
  refresh: () => void;
}) {
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const loaded = useLoad(
    () => client.graph(organization.id, id),
    [client, organization.id, id, revision],
  );
  if (loaded.loading) return <p role="status">Chargement du snapshot…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  const record = loaded.data;
  function saved(next: GraphArtifact) {
    setEditing(false);
    refresh();
    navigate(`/organizations/${organization.id}/graphs/${next.id}`);
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">ORGANIZATION STUDIO / GRAPHE</span>
        <div className="section-title">
          <h1>{record.document.graph.organization.name}</h1>
          <Status value={record.state} />
        </div>
        <p>
          {record.key} · version {record.version} · snapshot{" "}
          {record.document.graph.organization.data_snapshot_id}
        </p>
        <div className="actions">
          {canBuild(organization.role) && !editing && (
            <button className="primary" onClick={() => setEditing(true)}>
              Créer un nouveau brouillon
            </button>
          )}
          <button onClick={refresh}>Recharger les versions</button>
          <button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([canonical(exportGraph(record.document))], {
                  type: "application/json",
                }),
              );
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = "organization-graph.json";
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            Exporter le snapshot JSON
          </button>
        </div>
      </div>
      {editing ? (
        <GraphEditor
          key={record.id}
          client={client}
          organization={organization}
          source={record}
          onSaved={saved}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <Publish
            client={client}
            organization={organization}
            record={record}
            kind="graphs"
            onPublished={() => {
              setRevision((value) => value + 1);
              refresh();
            }}
          />
          <Suspense
            fallback={<p role="status">Chargement du canvas interactif…</p>}
          >
            <GraphCanvas
              key={`${record.id}-${record.content_hash}`}
              document={record.document}
            />
          </Suspense>
          <section className="panel compact">
            <JsonView
              title="Snapshot canonique et provenance"
              value={record.document}
            />
            <p className="quiet">
              Empreinte du contenu : {record.content_hash}. Placement local
              uniquement ; aucune position n’est persistée.
            </p>
          </section>
        </>
      )}
    </>
  );
}
function Comparison({
  client,
  organization,
  source,
  target,
}: {
  client: ApiClient;
  organization: Organization;
  source: Parameters<typeof compareMetadata>[0];
  target: string;
}) {
  const loaded = useLoad(
    () => client.model(organization.id, target),
    [client, organization.id, target],
  );
  if (loaded.loading)
    return <p role="status">Lecture de la seconde version…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  const changes = compareMetadata(source, loaded.data.document);
  return (
    <div className="table-scroll">
      <p>
        Comparaison descriptive des métadonnées et paramètres. Aucun scénario ni
        gain n’est calculé.
      </p>
      {!changes.length ? (
        <Empty>Aucune différence dans les champs comparés.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Chemin</th>
              <th>Version ouverte</th>
              <th>Version comparée</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.path}>
                <td>{change.path}</td>
                <td>{change.before}</td>
                <td>{change.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
function ModelPage({
  client,
  organization,
  id,
  graphs,
  models,
  refresh,
}: {
  client: ApiClient;
  organization: Organization;
  id: string;
  graphs: Artifact[];
  models: Artifact[];
  refresh: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [comparison, setComparison] = useState("");
  const navigate = useNavigate();
  const loaded = useLoad(
    () => client.model(organization.id, id),
    [client, organization.id, id, revision],
  );
  if (loaded.loading) return <p role="status">Chargement du modèle…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  const record = loaded.data;
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">MODEL INSPECTOR</span>
        <div className="section-title">
          <h1>{record.document.dsl.name}</h1>
          <Status value={record.state} />
        </div>
        <p>
          {record.key} · v{record.version} ·{" "}
          {record.document.dsl.variables.length} variables ·{" "}
          {record.document.dsl.constraints.length} contraintes
        </p>
        <button onClick={refresh}>Recharger les versions</button>
        {canBuild(organization.role) && !editing && (
          <button className="primary" onClick={() => setEditing(true)}>
            Créer une version de modèle
          </button>
        )}
      </div>
      {editing ? (
        <ModelEditor
          client={client}
          organization={organization}
          source={record}
          graphs={graphs}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            refresh();
            navigate(`/organizations/${organization.id}/models/${next.id}`);
          }}
        />
      ) : (
        <>
          <Publish
            client={client}
            organization={organization}
            record={record}
            kind="model-versions"
            onPublished={() => {
              setRevision((value) => value + 1);
              refresh();
            }}
          />
          <ModelInspector document={record.document} />
          <ConstraintDiagnostics
            client={client}
            org={organization.id}
            id={record.id}
            kind="model-versions"
            contentHash={record.content_hash}
          />
          <section className="panel">
            <h2>Comparer deux versions</h2>
            <label>
              Version à comparer
              <select
                value={comparison}
                onChange={(event) => setComparison(event.target.value)}
              >
                <option value="">Choisir une version</option>
                {models
                  .filter((model) => model.id !== record.id)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.key} · v{model.version}
                    </option>
                  ))}
              </select>
            </label>
            {comparison && (
              <Comparison
                key={comparison}
                client={client}
                organization={organization}
                source={record.document}
                target={comparison}
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
function GraphRoute(props: Omit<Parameters<typeof GraphPage>[0], "id">) {
  const { id = "" } = useParams();
  return <GraphPage key={id} {...props} id={id} />;
}
function ModelRoute({
  client,
  organization,
}: {
  client: ApiClient;
  organization: Organization;
}) {
  const { id = "" } = useParams();
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () =>
      Promise.all([
        client.artifacts(organization.id, "graphs"),
        client.artifacts(organization.id, "model-versions"),
      ]),
    [client, organization.id, revision],
  );
  if (loaded.loading) return <Skeleton label="Chargement des versions…" />;
  if (!loaded.data)
    return (
      <div className="v2-retry-panel">
        <ErrorNotice message={loaded.error} />
        <button type="button" onClick={() => setRevision((r) => r + 1)}>
          Réessayer
        </button>
      </div>
    );
  const [graphs, models] = loaded.data;
  return (
    <ModelPage
      key={id}
      client={client}
      organization={organization}
      id={id}
      graphs={graphs}
      models={models}
      refresh={() => setRevision((r) => r + 1)}
    />
  );
}
function RunRoute({ client, org }: { client: ApiClient; org: string }) {
  const { id = "" } = useParams();
  return <StoredRun key={id} client={client} org={org} id={id} />;
}
function GraphsRoute({
  client,
  organization,
  base,
}: {
  client: ApiClient;
  organization: Organization;
  base: string;
}) {
  const navigate = useNavigate();
  const [graphsRevision, setGraphsRevision] = useState(0);
  const [deptsRevision, setDeptsRevision] = useState(0);
  const graphsLoad = useLoad(
    () => client.artifacts(organization.id, "graphs"),
    [client, organization.id, graphsRevision],
  );
  const deptsLoad = useLoad(
    () => client.departments(organization.id),
    [client, organization.id, deptsRevision],
  );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">ORGANIZATION GRAPH</span>
        <h1>La structure, rendue explicite.</h1>
        <p>
          Départements, ressources et relations tels qu’enregistrés dans chaque
          snapshot.
        </p>
      </div>
      {graphsLoad.loading ? (
        <Skeleton label="Chargement des graphes…" />
      ) : graphsLoad.error ? (
        <div className="v2-retry-panel">
          <ErrorNotice message={graphsLoad.error} />
          <button
            type="button"
            onClick={() => setGraphsRevision((r) => r + 1)}
          >
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <ArtifactList
            title="Versions de graphe"
            records={graphsLoad.data ?? []}
            base={`${base}/graphs`}
          />
          <ArtifactImport
            client={client}
            organization={organization}
            kind="graphs"
            onSaved={(id) => {
              setGraphsRevision((r) => r + 1);
              navigate(`${base}/graphs/${id}`);
            }}
          />
        </>
      )}
      {deptsLoad.loading ? (
        <Skeleton label="Chargement des départements…" />
      ) : deptsLoad.error ? (
        <div className="v2-retry-panel">
          <ErrorNotice message={deptsLoad.error} />
          <button type="button" onClick={() => setDeptsRevision((r) => r + 1)}>
            Réessayer
          </button>
        </div>
      ) : (
        <DepartmentRegistry
          client={client}
          organization={organization}
          departments={deptsLoad.data ?? []}
          refresh={() => setDeptsRevision((r) => r + 1)}
        />
      )}
    </>
  );
}
function ModelsRoute({
  client,
  organization,
  base,
}: {
  client: ApiClient;
  organization: Organization;
  base: string;
}) {
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () =>
      Promise.all([
        client.artifacts(organization.id, "model-versions"),
        client.artifacts(organization.id, "graphs"),
      ]),
    [client, organization.id, revision],
  );
  if (loaded.loading) return <Skeleton label="Chargement des modèles…" />;
  if (!loaded.data)
    return (
      <div className="v2-retry-panel">
        <ErrorNotice message={loaded.error} />
        <button type="button" onClick={() => setRevision((r) => r + 1)}>
          Réessayer
        </button>
      </div>
    );
  const [models, graphs] = loaded.data;
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">MODEL INSPECTOR</span>
        <h1>Des règles aux équations.</h1>
        <p>
          La DSL compilée et l’IR sont les sources mathématiques, sans
          interprétation du canvas.
        </p>
      </div>
      <ArtifactList
        title="Versions de modèle"
        records={models}
        base={`${base}/models`}
      />
      <ArtifactImport
        client={client}
        organization={organization}
        kind="model-versions"
        graphs={graphs}
        onSaved={(id) => {
          setRevision((r) => r + 1);
          navigate(`${base}/models/${id}`);
        }}
      />
    </>
  );
}
function ScenariosRoute({
  client,
  organization,
  userId,
}: {
  client: ApiClient;
  organization: Organization;
  userId: string;
}) {
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.artifacts(organization.id, "model-versions"),
    [client, organization.id, revision],
  );
  if (loaded.loading)
    return <Skeleton label="Chargement des modèles pour les scénarios…" />;
  if (!loaded.data)
    return (
      <div className="v2-retry-panel">
        <ErrorNotice message={loaded.error} />
        <button type="button" onClick={() => setRevision((r) => r + 1)}>
          Réessayer
        </button>
      </div>
    );
  return (
    <Suspense fallback={<Skeleton label="Chargement du Scenario Lab…" />}>
      <ScenarioLab
        client={client}
        organization={organization}
        userId={userId}
        models={loaded.data}
        refresh={() => setRevision((r) => r + 1)}
      />
    </Suspense>
  );
}
function ExecutionRoute({
  client,
  organization,
  userId,
}: {
  client: ApiClient;
  organization: Organization;
  userId: string;
}) {
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.artifacts(organization.id, "model-versions"),
    [client, organization.id, revision],
  );
  if (loaded.loading)
    return <Skeleton label="Chargement des modèles pour l’exécution…" />;
  if (!loaded.data)
    return (
      <div className="v2-retry-panel">
        <ErrorNotice message={loaded.error} />
        <button type="button" onClick={() => setRevision((r) => r + 1)}>
          Réessayer
        </button>
      </div>
    );
  return (
    <Suspense fallback={<Skeleton label="Chargement du centre d’exécution…" />}>
      <OptimizationCenter
        client={client}
        organization={organization}
        userId={userId}
        models={loaded.data}
      />
    </Suspense>
  );
}
function HistoryRoute({
  client,
  organization,
}: {
  client: ApiClient;
  organization: Organization;
}) {
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.artifacts(organization.id, "optimization-runs"),
    [client, organization.id, revision],
  );
  if (loaded.loading) return <Skeleton label="Chargement de l’historique…" />;
  if (!loaded.data)
    return (
      <div className="v2-retry-panel">
        <ErrorNotice message={loaded.error} />
        <button type="button" onClick={() => setRevision((r) => r + 1)}>
          Réessayer
        </button>
      </div>
    );
  return (
    <History client={client} organization={organization} records={loaded.data} />
  );
}

export function Workspace({
  client,
  organizationId,
  userId,
  authorizedOrganization,
}: {
  client: ApiClient;
  organizationId: string;
  userId: string;
  authorizedOrganization?: Organization;
}) {
  const [orgRevision, setOrgRevision] = useState(0);
  const loadedOrg = useLoad(
    () =>
      authorizedOrganization
        ? Promise.resolve(authorizedOrganization)
        : client.organization(organizationId),
    [client, organizationId, authorizedOrganization, orgRevision],
  );
  if (!authorizedOrganization && loadedOrg.loading)
    return <Skeleton label="Chargement de l’organisation autorisée…" />;
  const organization = authorizedOrganization ?? loadedOrg.data;
  if (!organization)
    return (
      <div className="v2-retry-panel">
        <ErrorNotice message={loadedOrg.error} />
        <button type="button" onClick={() => setOrgRevision((r) => r + 1)}>
          Réessayer
        </button>
      </div>
    );
  const base = `/organizations/${organizationId}`;
  return (
    <div className="legacy-workspace">
      <Routes>
        <Route
          path="scenarios/:id?"
          element={
            <ScenariosRoute
              client={client}
              organization={organization}
              userId={userId}
            />
          }
        />
        <Route
          path="execution/:jobId?"
          element={
            <ExecutionRoute
              client={client}
              organization={organization}
              userId={userId}
            />
          }
        />
        <Route
          path="history/:id"
          element={<RunRoute client={client} org={organization.id} />}
        />
        <Route
          index
          element={<Dashboard client={client} organization={organization} />}
        />
        <Route
          path="graphs"
          element={
            <GraphsRoute
              client={client}
              organization={organization}
              base={base}
            />
          }
        />
        <Route
          path="graphs/:id"
          element={
            <GraphRoute
              client={client}
              organization={organization}
              refresh={() => undefined}
            />
          }
        />
        <Route
          path="models"
          element={
            <ModelsRoute
              client={client}
              organization={organization}
              base={base}
            />
          }
        />
        <Route
          path="models/:id"
          element={<ModelRoute client={client} organization={organization} />}
        />
        <Route
          path="history"
          element={<HistoryRoute client={client} organization={organization} />}
        />
        <Route
          path="*"
          element={<Empty>Page introuvable dans cette organisation.</Empty>}
        />
      </Routes>
    </div>
  );
}
