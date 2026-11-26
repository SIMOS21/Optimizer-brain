import { useState } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import type { Artifact, OptimizationJob } from "../../api/types";
import { useLoad } from "../../shared/async";
import { StatusChip, Skeleton } from "../../shared/design-system";
import { text, unitLabel } from "../../shared/format";
import { ErrorNotice } from "../../shared/ui";
import { assessTrust } from "../dashboard/trust";
import { usePresentation } from "../../shared/presentation/context";

export function HistoryCard({
  client,
  org,
  metadata,
  jobs,
  jobsUnavailable,
  onSelect,
}: {
  client: ApiClient;
  org: string;
  metadata: Artifact;
  jobs: OptimizationJob[];
  jobsUnavailable: boolean;
  onSelect: (id: string) => void;
}) {
  const { mode } = usePresentation();
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.run(org, metadata.id),
    [client, org, metadata.id, revision],
  );
  if (loaded.loading)
    return <Skeleton label="Qualification du résultat historique…" />;
  if (!loaded.data)
    return (
      <article className="history-card">
        <ErrorNotice message={loaded.error} />
        <button onClick={() => setRevision((n) => n + 1)}>
          Réessayer ce résumé
        </button>
      </article>
    );
  const record = loaded.data;
  const solve = record.document.solve;
  const trust = assessTrust(record);
  const job = jobs.find(
    (j) =>
      j.organization_id === org &&
      j.run_id === record.id &&
      j.model_version_id === record.model_version_id,
  );
  return (
    <article className="history-card" data-testid="history-card">
      <header>
        <h2>
          Calcul du {new Date(record.created_at * 1000).toLocaleString("fr-FR")}
        </h2>
        <StatusChip tone={trust.tone}>{trust.label}</StatusChip>
      </header>
      <p>
        Modèle : {text(solve.model_id)} · version {text(solve.model_version)}
      </p>
      <p>
        Scénario déclaré : {text(solve.scenario_id)} · snapshot :{" "}
        {text(solve.data_snapshot_id)}
      </p>
      <p>
        Statut mathématique : <strong>{record.status || "Non fourni"}</strong>
      </p>
      <p>
        État technique du job :{" "}
        <strong data-testid="history-job-state">
          {job?.state || "Non fourni"}
        </strong>
        {!job && (
          <small>
            {" "}
            —{" "}
            {jobsUnavailable
              ? "lecture des jobs indisponible"
              : "aucun job correspondant dans la page consultée"}
          </small>
        )}
      </p>
      <p>{trust.description}</p>
      {trust.hasVerifiedPlan && (
        <p className="history-objective">
          Objectif vérifié : <strong>{text(solve.objective_value)}</strong>{" "}
          {unitLabel(solve.objective_unit)}
        </p>
      )}
      {mode === "expert" && (
        <p className="quiet">
          Run : {record.id} · modèle : {record.model_version_id} · empreinte :{" "}
          {record.content_hash}
          {job ? ` · job : ${job.id}` : ""}
        </p>
      )}
      <div className="actions">
        <Link to={`/organizations/${org}/history/${record.id}`}>
          Ouvrir le résultat complet
        </Link>
        <button onClick={() => onSelect(record.id)}>
          Afficher ce résultat ici
        </button>
      </div>
    </article>
  );
}
