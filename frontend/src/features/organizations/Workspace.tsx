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
import { Publish } from "../../shared/Publish";
import { GraphEditor } from "../graph/GraphEditor";
import { History } from "../history/History";
import { ModelEditor, ModelInspector } from "../models/ModelInspector";
import { canonical } from "../../api/validation";
import { exportGraph } from "../graph/projection";
import { ArtifactImport } from "./ArtifactImport";
import { StoredRun } from "../execution/DecisionCockpit";
import { ConstraintDiagnostics } from "../diagnostics/ConstraintDiagnostics";

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
function ModelRoute(props: Omit<Parameters<typeof ModelPage>[0], "id">) {
  const { id = "" } = useParams();
  return <ModelPage key={id} {...props} id={id} />;
}
function RunRoute({ client, org }: { client: ApiClient; org: string }) {
  const { id = "" } = useParams();
  return <StoredRun key={id} client={client} org={org} id={id} />;
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
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(async () => {
    const organization =
      authorizedOrganization ?? (await client.organization(organizationId));
    const [departments, graphs, models, runs] = await Promise.all([
      client.departments(organizationId),
      client.artifacts(organizationId, "graphs"),
      client.artifacts(organizationId, "model-versions"),
      client.artifacts(organizationId, "optimization-runs"),
    ]);
    return { organization, departments, graphs, models, runs };
  }, [client, organizationId, revision, authorizedOrganization]);
  if (loaded.loading)
    return (
      <p className="page-loading" role="status">
        Chargement de l’organisation autorisée…
      </p>
    );
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  const { organization, departments, graphs, models, runs } = loaded.data;
  const base = `/organizations/${organizationId}`;
  const refresh = () => setRevision((value) => value + 1);
  return (
    <div className="legacy-workspace">
      <Routes>
        <Route
          path="scenarios/:id?"
          element={
            <Suspense
              fallback={<p role="status">Chargement du Scenario Lab…</p>}
            >
              <ScenarioLab
                client={client}
                organization={organization}
                userId={userId}
                models={models}
                refresh={refresh}
              />
            </Suspense>
          }
        />
        <Route
          path="execution/:jobId?"
          element={
            <Suspense
              fallback={<p role="status">Chargement du centre d’exécution…</p>}
            >
              <OptimizationCenter
                client={client}
                organization={organization}
                userId={userId}
                models={models}
              />
            </Suspense>
          }
        />
        <Route
          path="history/:id"
          element={<RunRoute client={client} org={organization.id} />}
        />
        <Route
          index
          element={
            <>
              <div className="page-heading">
                <span className="eyebrow">WORKSPACE</span>
                <h1>Une organisation. Un modèle commun.</h1>
                <p>
                  Explorez les responsabilités, les ressources partagées et les
                  règles qui relient vos départements.
                </p>
              </div>
              <div className="metrics overview-metrics">
                <div>
                  <span>Départements enregistrés</span>
                  <strong>{departments.length}</strong>
                </div>
                <div>
                  <span>Versions de graphe</span>
                  <strong>{graphs.length}</strong>
                </div>
                <div>
                  <span>Versions de modèle</span>
                  <strong>{models.length}</strong>
                </div>
              </div>
              <ArtifactList
                title="Graphes de l’organisation"
                records={graphs}
                base={`${base}/graphs`}
              />
              <DepartmentRegistry
                client={client}
                organization={organization}
                departments={departments}
                refresh={refresh}
              />
            </>
          }
        />
        <Route
          path="graphs"
          element={
            <>
              <div className="page-heading">
                <span className="eyebrow">ORGANIZATION GRAPH</span>
                <h1>La structure, rendue explicite.</h1>
                <p>
                  Départements, ressources et relations tels qu’enregistrés dans
                  chaque snapshot.
                </p>
              </div>
              <ArtifactList
                title="Versions de graphe"
                records={graphs}
                base={`${base}/graphs`}
              />
              <ArtifactImport
                client={client}
                organization={organization}
                kind="graphs"
                onSaved={(id) => {
                  refresh();
                  navigate(`${base}/graphs/${id}`);
                }}
              />
            </>
          }
        />
        <Route
          path="graphs/:id"
          element={
            <GraphRoute
              client={client}
              organization={organization}
              refresh={refresh}
            />
          }
        />
        <Route
          path="models"
          element={
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
                  refresh();
                  navigate(`${base}/models/${id}`);
                }}
              />
            </>
          }
        />
        <Route
          path="models/:id"
          element={
            <ModelRoute
              client={client}
              organization={organization}
              graphs={graphs}
              models={models}
              refresh={refresh}
            />
          }
        />
        <Route
          path="history"
          element={
            <History
              client={client}
              organization={organization}
              records={runs}
            />
          }
        />
        <Route
          path="*"
          element={<Empty>Page introuvable dans cette organisation.</Empty>}
        />
      </Routes>
    </div>
  );
}
