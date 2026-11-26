import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiClient, canBuild } from "../../api/client";
import type { Artifact, Organization } from "../../api/types";
import { useLoad } from "../../shared/async";
import { Empty, ErrorNotice } from "../../shared/ui";
import { PageHeader, Skeleton, StatusChip } from "../../shared/design-system";
import { usePresentation } from "../../shared/presentation/context";
import "../../styles/execution-center.css";
import { ExecutionPanel } from "./ExecutionPanel";
import { JobMonitor } from "./JobMonitor";

function PublishedModel({
  client,
  organization,
  modelId,
  submitted,
  onLocked,
}: {
  client: ApiClient;
  organization: Organization;
  modelId: string;
  submitted: (id: string) => void;
  onLocked: (locked: boolean) => void;
}) {
  const { mode } = usePresentation();
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.model(organization.id, modelId),
    [client, organization.id, modelId, revision],
  );
  if (loaded.loading) return <Skeleton label="Chargement du modèle publié…" />;
  if (!loaded.data)
    return (
      <section className="panel">
        <ErrorNotice message={loaded.error} />
        <button onClick={() => setRevision((n) => n + 1)}>
          Réessayer le modèle
        </button>
      </section>
    );
  const record = loaded.data;
  if (record.state !== "PUBLISHED")
    return (
      <ErrorNotice message="Cette version n’est pas publiée. Aucun lancement autorisé." />
    );
  return (
    <>
      <section className="panel">
        <span className="eyebrow">MODÈLE SÉLECTIONNÉ</span>
        <h2>{record.document.organization_model.model_name}</h2>
        <p>
          Version publiée {record.version} ·{" "}
          {new Date(record.created_at * 1000).toLocaleString("fr-FR")}
        </p>
        <p>
          Snapshot : {record.data_snapshot_id} · scénario déclaré :{" "}
          {record.document.organization_model.scenario_id}
        </p>
        <p>
          Les résultats de cette version ne sont pas interchangeables avec ceux
          d’un autre modèle ou scénario.
        </p>
        {mode === "expert" && (
          <dl>
            <dt>Identifiant / version</dt>
            <dd>
              {record.id} · {record.version}
            </dd>
            <dt>Snapshot de données</dt>
            <dd>{record.data_snapshot_id}</dd>
            <dt>Graphe publié</dt>
            <dd>{record.graph_snapshot_id}</dd>
            <dt>Source</dt>
            <dd>
              {record.document.organization_model.graph.organization.source}
            </dd>
            <dt>Hash du modèle</dt>
            <dd>{record.model_hash}</dd>
          </dl>
        )}
        <Link to={`/organizations/${organization.id}/models/${record.id}`}>
          Inspecter les contraintes approuvées
        </Link>
      </section>
      <ExecutionPanel
        key={record.id}
        client={client}
        organization={organization}
        model={record}
        onSubmitted={(job) => submitted(job.id)}
        onLocked={onLocked}
      />
    </>
  );
}
export function OptimizationCenter({
  client,
  organization,
  userId,
  models,
}: {
  client: ApiClient;
  organization: Organization;
  userId: string;
  models: Artifact[];
}) {
  const { mode } = usePresentation();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [selected, select] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [part, setPart] = useState(0);
  const published = models.filter(
    (model) =>
      model.state === "PUBLISHED" && model.organization_id === organization.id,
  );
  const jobs = useLoad(
    () => client.jobs(organization.id, offset),
    [client, organization.id, offset, revision, jobId],
  );
  const base = `/organizations/${organization.id}`;
  const visibleJobs = jobs.data?.items.slice(part, part + 5) ?? [];
  return (
    <div className="optimization-center-v2">
      <PageHeader eyebrow="OPTIMISATION" title="Exécuter un modèle publié">
        <p>
          Une version explicite, un calcul suivi et un résultat historique
          vérifié. Aucune action métier n’est appliquée automatiquement.
        </p>
        {jobId && (
          <Link to={`${base}/execution`}>Préparer une autre exécution</Link>
        )}
      </PageHeader>
      <ol className="execution-steps" aria-label="Parcours d’optimisation">
        <li>1 · Modèle publié</li>
        <li>2 · Paramètres</li>
        <li>3 · Confirmation</li>
        <li>4 · Suivi</li>
        <li>5 · Résultat vérifié ou absence de plan</li>
      </ol>
      {jobId && (
        <JobMonitor
          key={`${organization.id}/${jobId}`}
          client={client}
          organization={organization}
          userId={userId}
          id={jobId}
        />
      )}
      {!jobId && (
        <section className="panel">
          <span className="eyebrow">ÉTAPE 1 · CHOISIR UNE VERSION</span>
          <h2>Modèles publiés accessibles</h2>
          {!published.length ? (
            <Empty>
              Aucun modèle publié. Publiez une version avec les droits requis
              avant de lancer un calcul.
            </Empty>
          ) : (
            <label>
              Modèle publié à exécuter
              <select
                aria-label="Modèle publié à exécuter"
                disabled={selectionLocked}
                value={selected}
                onChange={(event) => select(event.target.value)}
              >
                <option value="">Choisir une version publiée</option>
                {published.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.key} · v{model.version} ·{" "}
                    {new Date(model.created_at * 1000).toLocaleDateString(
                      "fr-FR",
                    )}
                    {mode === "expert" ? ` · ${model.id}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!canBuild(organization.role) && (
            <p className="notice">
              Consultation autorisée. Le lancement exige le rôle ADMIN ou
              BUILDER.
            </p>
          )}
        </section>
      )}
      {!jobId &&
        selected &&
        published.some((model) => model.id === selected) && (
          <PublishedModel
            key={selected}
            client={client}
            organization={organization}
            modelId={selected}
            onLocked={setSelectionLocked}
            submitted={(id) => {
              select("");
              navigate(`${base}/execution/${id}`);
              setRevision((value) => value + 1);
            }}
          />
        )}
      <section className="panel">
        <div className="section-title">
          <h2>Exécutions de l’organisation</h2>
          <button onClick={() => setRevision((value) => value + 1)}>
            Actualiser la liste
          </button>
        </div>
        <ErrorNotice message={jobs.error} />
        {jobs.loading ? (
          <Skeleton label="Chargement de la liste…" />
        ) : jobs.error ? null : !jobs.data?.items.length ? (
          <Empty>Aucun job sur cette page.</Empty>
        ) : mode === "business" ? (
          <div className="execution-job-list">
            {visibleJobs.map((job) => (
              <article key={job.id}>
                <div>
                  <strong>
                    Calcul du{" "}
                    {new Date(job.created_at * 1000).toLocaleString("fr-FR")}
                  </strong>
                  <StatusChip>{job.state}</StatusChip>
                </div>
                <p>
                  Modèle :{" "}
                  {models.find((model) => model.id === job.model_version_id)
                    ?.key || "Version enregistrée"}{" "}
                  · version{" "}
                  {models.find((model) => model.id === job.model_version_id)
                    ?.version || "Non fournie"}
                </p>
                <p>
                  Statut mathématique enregistré :{" "}
                  {job.solver_status || "Non disponible"}
                </p>
                <Link to={`${base}/execution/${job.id}`}>
                  Consulter ce calcul
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Modèle</th>
                  <th>État technique</th>
                  <th>Statut mathématique</th>
                  <th>Créé le</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.items.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link to={`${base}/execution/${job.id}`}>{job.id}</Link>
                    </td>
                    <td>{job.model_version_id}</td>
                    <td>{job.state}</td>
                    <td>{job.solver_status || "Non disponible"}</td>
                    <td>
                      {new Date(job.created_at * 1000).toLocaleString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="execution-actions">
          <button
            disabled={
              (offset === 0 && (mode === "expert" || part === 0)) ||
              jobs.loading
            }
            onClick={() => {
              if (mode === "business" && part > 0) setPart((n) => n - 5);
              else {
                setOffset((value) => Math.max(0, value - 50));
                setPart(mode === "business" ? 45 : 0);
              }
            }}
          >
            Jobs précédents
          </button>
          <button
            disabled={
              jobs.loading ||
              !jobs.data ||
              (jobs.data.items.length !== 50 &&
                (mode === "expert" || part + 5 >= jobs.data.items.length))
            }
            onClick={() => {
              if (
                mode === "business" &&
                jobs.data &&
                part + 5 < jobs.data.items.length
              )
                setPart((n) => n + 5);
              else {
                setOffset((value) => value + 50);
                setPart(0);
              }
            }}
          >
            Jobs suivants
          </button>
        </div>
        <p className="quiet">
          Liste à la consultation. Le suivi automatique concerne le job ouvert.
        </p>
      </section>
    </div>
  );
}
