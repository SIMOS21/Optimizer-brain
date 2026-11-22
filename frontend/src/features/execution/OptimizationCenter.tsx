import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiClient, canBuild } from "../../api/client";
import type { Artifact, Organization } from "../../api/types";
import { useLoad } from "../../shared/async";
import { Empty, ErrorNotice } from "../../shared/ui";
import { ExecutionPanel } from "./ExecutionPanel";
import { JobMonitor } from "./JobMonitor";

function PublishedModel({
  client,
  organization,
  modelId,
  submitted,
}: {
  client: ApiClient;
  organization: Organization;
  modelId: string;
  submitted: (id: string) => void;
}) {
  const loaded = useLoad(
    () => client.model(organization.id, modelId),
    [client, organization.id, modelId],
  );
  if (loaded.loading) return <p role="status">Chargement du modèle publié…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  const record = loaded.data;
  return (
    <>
      <section className="panel">
        <h2>Provenance du modèle</h2>
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
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [selected, select] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const published = models.filter(
    (model) =>
      model.state === "PUBLISHED" && model.organization_id === organization.id,
  );
  const jobs = useLoad(
    () => client.jobs(organization.id, offset),
    [client, organization.id, offset, revision, jobId],
  );
  const base = `/organizations/${organization.id}`;
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">OPTIMIZATION CENTER</span>
        <h1>Exécuter un modèle publié</h1>
        <p>
          Une version explicite, un calcul suivi et un résultat historique
          vérifié. Aucune action métier n’est appliquée automatiquement.
        </p>
        {jobId && (
          <Link to={`${base}/execution`}>Préparer une autre exécution</Link>
        )}
      </div>
      {jobId && (
        <JobMonitor
          key={`${organization.id}/${jobId}`}
          client={client}
          organization={organization}
          userId={userId}
          id={jobId}
        />
      )}
      <section className="panel">
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
              value={selected}
              onChange={(event) => select(event.target.value)}
            >
              <option value="">Choisir une version publiée</option>
              {published.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.key} · v{model.version} · {model.id}
                </option>
              ))}
            </select>
          </label>
        )}
        {!canBuild(organization.role) && (
          <p className="notice">
            Consultation autorisée. Le lancement exige le rôle ADMIN ou BUILDER.
          </p>
        )}
      </section>
      {selected && published.some((model) => model.id === selected) && (
        <PublishedModel
          key={selected}
          client={client}
          organization={organization}
          modelId={selected}
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
          <p role="status">Chargement de la liste…</p>
        ) : jobs.error ? null : !jobs.data?.items.length ? (
          <Empty>Aucun job sur cette page.</Empty>
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
            disabled={offset === 0 || jobs.loading}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            Jobs précédents
          </button>
          <button
            disabled={jobs.loading || jobs.data?.items.length !== 50}
            onClick={() => setOffset((value) => value + 50)}
          >
            Jobs suivants
          </button>
        </div>
        <p className="quiet">
          Liste à la consultation. Le suivi automatique concerne le job ouvert.
        </p>
      </section>
    </>
  );
}
