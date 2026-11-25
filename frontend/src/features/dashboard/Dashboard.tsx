/**
 * UX-F2 — Business Dashboard connected to real run artifacts.
 *
 * Every number displayed comes from a stored, verified run artifact.
 * No value is hardcoded, calculated in React, or invented.
 * Trust levels reuse the exact chain from DecisionCockpit.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import { canBuild } from "../../api/client";
import type { Artifact, Organization, RunArtifact } from "../../api/types";
import { useLoad } from "../../shared/async";
import { text, unitLabel } from "../../shared/format";
import {
  EmptyState,
  PageHeader,
  Skeleton,
  StatusChip,
} from "../../shared/design-system";
import { ErrorNotice } from "../../shared/ui";
import { usePresentation } from "../../shared/presentation/context";
import {
  assessTrust,
  extractConstraints,
  extractDecisions,
  extractResources,
} from "./trust";

const RUNS_PAGE_SIZE = 5;

function sortRunsDeterministically(runs: Artifact[]): Artifact[] {
  return [...runs].sort(
    (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
  );
}

function formatRunDate(timestamp: unknown): string {
  if (typeof timestamp !== "number") return "Date non fournie";
  return new Date(timestamp * 1000).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ResourceMeter({
  label,
  consumption,
  capacity,
  remaining,
  unit,
  state,
}: {
  label: string;
  consumption: string;
  capacity: string;
  remaining: string;
  unit: string;
  state: string;
}) {
  const used = Number(consumption) || 0;
  const total = Number(capacity) || 0;
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isSaturated = state === "SATURATED";
  return (
    <div className="v2-resource-meter" data-state={state}>
      <div className="v2-resource-header">
        <span className="v2-resource-label">{label}</span>
        <span className="v2-resource-values">
          {consumption} / {capacity} {unit}
        </span>
      </div>
      <div className="v2-resource-bar" aria-hidden="true">
        <div
          className="v2-resource-fill"
          style={{ width: `${pct}%` }}
          data-saturated={isSaturated}
        />
      </div>
      <div className="v2-resource-footer">
        <span>
          {isSaturated ? (
            <StatusChip tone="warning">Saturée</StatusChip>
          ) : (
            <StatusChip tone="neutral">Disponible</StatusChip>
          )}
        </span>
        <span className="v2-resource-remaining">
          Marge : {remaining} {unit}
        </span>
      </div>
    </div>
  );
}

function DashboardContent({
  organization,
  record,
  latestRunMeta,
  verifiedFallback,
  base,
}: {
  organization: Organization;
  record: RunArtifact;
  latestRunMeta: Artifact;
  verifiedFallback?: RunArtifact;
  base: string;
}) {
  const { mode } = usePresentation();
  const trust = assessTrust(record);
  const { solve } = record.document;

  const decisions = trust.hasVerifiedPlan ? extractDecisions(record) : [];
  const resources = trust.hasVerifiedPlan ? extractResources(record) : [];
  const constraints = trust.hasVerifiedPlan ? extractConstraints(record) : [];
  const saturatedConstraints = constraints.filter(
    (c) => c.state === "SATURATED",
  );

  const createdAt = formatRunDate(record.created_at);
  const isLatest = record.id === latestRunMeta.id;
  const fallbackTrust = verifiedFallback
    ? assessTrust(verifiedFallback)
    : undefined;

  return (
    <>
      {/* Status & provenance summary banner */}
      <section
        className="v2-dashboard-status"
        data-testid="dashboard-latest-run"
      >
        <div className="v2-dashboard-status-main">
          <div className="v2-dashboard-badges">
            <StatusChip tone={trust.tone}>{trust.label}</StatusChip>
            {isLatest && trust.hasVerifiedPlan && (
              <StatusChip tone="positive">
                Dernier run = Dernier plan vérifié
              </StatusChip>
            )}
            {isLatest && !trust.hasVerifiedPlan && (
              <StatusChip tone="neutral">Dernier run disponible</StatusChip>
            )}
            {!isLatest && (
              <StatusChip tone="neutral">Run sélectionné</StatusChip>
            )}
          </div>
          <p className="v2-dashboard-status-desc">{trust.description}</p>
        </div>
        <div className="v2-dashboard-status-meta">
          <small data-testid="dashboard-date">{createdAt}</small>
          <small data-testid="dashboard-model-version">
            Modèle :{" "}
            <Link to={`${base}/models/${record.model_version_id}`}>
              v{text(solve.model_version)}
            </Link>
          </small>
          {mode === "expert" && (
            <small>
              Run <Link to={`${base}/history/${record.id}`}>{record.id}</Link>
            </small>
          )}
        </div>
      </section>

      {/* Primary KPI: Objective */}
      {trust.hasVerifiedPlan ? (
        <section className="v2-dashboard-kpi-section">
          <div className="v2-kpi-primary">
            <span className="v2-kpi-label">Objectif vérifié</span>
            <strong className="v2-kpi-value" data-testid="dashboard-objective">
              {text(solve.objective_value)}
            </strong>
            <span className="v2-kpi-unit" data-testid="dashboard-objective-unit">
              {unitLabel(solve.objective_unit)}
            </span>
          </div>
          {mode === "expert" && (
            <div className="v2-kpi-row">
              <div className="v2-kpi-secondary">
                <span>Meilleure borne</span>
                <strong>{text(solve.best_bound)}</strong>
              </div>
              <div className="v2-kpi-secondary">
                <span>Gap relatif</span>
                <strong>{text(solve.relative_gap)}</strong>
              </div>
              <div className="v2-kpi-secondary">
                <span>Statut mathématique</span>
                <strong data-testid="dashboard-math-status">
                  {record.status}
                </strong>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="v2-dashboard-kpi-section">
          <div className="v2-kpi-primary v2-kpi-unavailable">
            <span className="v2-kpi-label">Statut mathématique</span>
            <strong
              className="v2-kpi-value"
              data-testid="dashboard-math-status"
            >
              {record.status || "Non fourni"}
            </strong>
          </div>
          <p className="v2-dashboard-notice">
            Aucun plan vérifié n’est disponible pour ce run. Les valeurs de
            décision et les ressources ne peuvent pas être affichées comme
            décision validée.
          </p>
          {verifiedFallback && fallbackTrust?.hasVerifiedPlan && (
            <div
              className="v2-dashboard-fallback"
              data-testid="dashboard-verified-plan"
            >
              <StatusChip tone={fallbackTrust.tone}>
                Dernier plan vérifié antérieur
              </StatusChip>
              <span>
                Objectif :{" "}
                <strong>
                  {text(verifiedFallback.document.solve.objective_value)}
                </strong>{" "}
                {unitLabel(verifiedFallback.document.solve.objective_unit)} ·{" "}
                {formatRunDate(verifiedFallback.created_at)}
              </span>
              <Link to={`${base}/history/${verifiedFallback.id}`}>
                Consulter ce plan vérifié
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Decisions */}
      {decisions.length > 0 && (
        <section className="v2-dashboard-section">
          <h2>Décisions optimisées</h2>
          <div
            className="v2-dashboard-decisions"
            data-testid="dashboard-decisions"
          >
            {decisions.map((d) => (
              <div key={d.id} className="v2-decision-card">
                <span className="v2-decision-id">{d.id}</span>
                <strong className="v2-decision-value">{text(d.value)}</strong>
                <span className="v2-decision-unit">{d.unit}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Resources */}
      {resources.length > 0 && (
        <section className="v2-dashboard-section">
          <h2>Ressources et capacités</h2>
          <div
            className="v2-dashboard-resources"
            data-testid="dashboard-resources"
          >
            {resources.map((r) => (
              <ResourceMeter
                key={r.id}
                label={r.id}
                consumption={r.consumption}
                capacity={r.capacity}
                remaining={r.remaining}
                unit={r.unit}
                state={r.state}
              />
            ))}
          </div>
        </section>
      )}

      {/* Saturated constraints */}
      {saturatedConstraints.length > 0 && (
        <section className="v2-dashboard-section">
          <h2>Contraintes saturées</h2>
          <p className="v2-dashboard-notice">
            Une contrainte saturée signifie que la ressource est entièrement
            consommée. Cela n’implique pas automatiquement un gain économique si
            la capacité était augmentée.
          </p>
          <div
            className="v2-dashboard-saturated"
            data-testid="dashboard-saturated"
          >
            {saturatedConstraints.map((c) => (
              <div key={c.id} className="v2-saturated-card">
                <StatusChip tone="warning">Saturée</StatusChip>
                <span>
                  <strong>{c.id}</strong> — {c.owner}
                </span>
                <span>
                  {c.lhs} / {c.rhs} {c.unit}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Expert provenance */}
      {mode === "expert" && (
        <section
          className="v2-dashboard-section v2-dashboard-expert"
          data-testid="dashboard-expert-provenance"
        >
          <h2>Provenance et traçabilité</h2>
          <dl className="v2-expert-dl">
            <dt>Run immuable</dt>
            <dd>
              <Link to={`${base}/history/${record.id}`}>{record.id}</Link>
            </dd>
            <dt>Modèle publié</dt>
            <dd>
              <Link to={`${base}/models/${record.model_version_id}`}>
                {record.model_version_id}
              </Link>
            </dd>
            <dt>Version du modèle</dt>
            <dd>{text(solve.model_version)}</dd>
            <dt>Snapshot</dt>
            <dd>{text(solve.data_snapshot_id)}</dd>
            <dt>Hash du modèle</dt>
            <dd>{text(solve.model_hash)}</dd>
            <dt>Empreinte de l’artefact</dt>
            <dd>{record.content_hash}</dd>
            <dt>Solveur / version</dt>
            <dd>
              {text(solve.solver_name)} / {text(solve.solver_version)}
            </dd>
            <dt>Durée (ms)</dt>
            <dd>{text(solve.duration_ms)}</dd>
            <dt>Certificat</dt>
            <dd>{text(solve.certificate_scope)}</dd>
            <dt>Label d’optimalité</dt>
            <dd>{text(solve.optimality_label)}</dd>
          </dl>
          {constraints.length > 0 && (
            <>
              <h3>Toutes les contraintes</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Contrainte</th>
                      <th>Département</th>
                      <th>État</th>
                      <th>Membre gauche</th>
                      <th>Limite</th>
                      <th>Marge</th>
                      <th>Unité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {constraints.map((c) => (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>{c.owner}</td>
                        <td>
                          <StatusChip
                            tone={
                              c.state === "SATURATED" ? "warning" : "neutral"
                            }
                          >
                            {c.state}
                          </StatusChip>
                        </td>
                        <td>{c.lhs}</td>
                        <td>{c.rhs}</td>
                        <td>{c.slack}</td>
                        <td>{c.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* Actions */}
      <section className="v2-dashboard-actions">
        <Link to={`${base}/history/${record.id}`} className="v2-action-link">
          Comprendre ce résultat
        </Link>
        {canBuild(organization.role) && (
          <Link to={`${base}/execution`} className="v2-action-link primary">
            Lancer une optimisation
          </Link>
        )}
        <Link to={`${base}/scenarios`} className="v2-action-link">
          Explorer un scénario
        </Link>
      </section>
    </>
  );
}

function NoRunState({
  organization,
  base,
}: {
  organization: Organization;
  base: string;
}) {
  return (
    <EmptyState
      title="Aucun résultat disponible"
      action={
        canBuild(organization.role) ? (
          <Link to={`${base}/execution`} className="v2-action-link primary">
            Lancer une première optimisation
          </Link>
        ) : undefined
      }
    >
      <p>
        Cette organisation n’a pas encore de run enregistré. Publiez un modèle
        et lancez une optimisation pour voir vos premiers résultats ici.
      </p>
      <p>
        Aucun indicateur n’est extrapolé ni fabriqué en l’absence de données.
      </p>
    </EmptyState>
  );
}

export function Dashboard({
  client,
  organization,
}: {
  client: ApiClient;
  organization: Organization;
}) {
  const base = `/organizations/${organization.id}`;
  const { mode } = usePresentation();
  const [runsRevision, setRunsRevision] = useState(0);
  const [runRevision, setRunRevision] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [page, setPage] = useState(0);

  const runsLoad = useLoad(
    () => client.artifacts(organization.id, "optimization-runs"),
    [client, organization.id, runsRevision],
  );

  const sortedRuns = runsLoad.data
    ? sortRunsDeterministically(runsLoad.data)
    : [];
  const latestRunMeta = sortedRuns[0];
  const activeRunMeta =
    (selectedRunId && sortedRuns.find((r) => r.id === selectedRunId)) ||
    latestRunMeta;

  const runLoad = useLoad(
    () =>
      activeRunMeta
        ? client.run(organization.id, activeRunMeta.id)
        : Promise.resolve(undefined),
    [client, organization.id, activeRunMeta?.id, runRevision],
  );

  // If the active run has no verified plan, locate the most recent candidate
  // with a verified-capable status so we can clearly distinguish "latest run"
  // from "last verified plan".
  const activeTrust = runLoad.data ? assessTrust(runLoad.data) : undefined;
  const fallbackCandidate =
    activeTrust && !activeTrust.hasVerifiedPlan
      ? sortedRuns.find(
          (r) =>
            r.id !== activeRunMeta?.id &&
            (r.status === "OPTIMAL" ||
              r.status === "FEASIBLE_NOT_PROVEN_OPTIMAL"),
        )
      : undefined;

  const fallbackLoad = useLoad(
    () =>
      fallbackCandidate
        ? client.run(organization.id, fallbackCandidate.id)
        : Promise.resolve(undefined),
    [client, organization.id, fallbackCandidate?.id],
  );

  const totalPages = Math.max(1, Math.ceil(sortedRuns.length / RUNS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedRuns = sortedRuns.slice(
    currentPage * RUNS_PAGE_SIZE,
    (currentPage + 1) * RUNS_PAGE_SIZE,
  );

  return (
    <>
      <PageHeader
        eyebrow={
          mode === "expert"
            ? "TABLEAU DE BORD · MODE EXPERT"
            : "TABLEAU DE BORD"
        }
        title={organization.name}
      >
        <p>
          {mode === "expert"
            ? "Situation actuelle et résultat vérifié avec provenance complète."
            : "Situation actuelle, dernière décision vérifiée et ressources."}
        </p>
      </PageHeader>

      {runsLoad.loading ? (
        <Skeleton label="Chargement des résultats…" />
      ) : runsLoad.error ? (
        <div className="v2-retry-panel">
          <ErrorNotice message={runsLoad.error} />
          <button
            type="button"
            data-testid="dashboard-retry"
            onClick={() => setRunsRevision((r) => r + 1)}
          >
            Réessayer
          </button>
        </div>
      ) : !activeRunMeta || !latestRunMeta ? (
        <NoRunState organization={organization} base={base} />
      ) : runLoad.loading ? (
        <Skeleton label="Chargement du dernier résultat…" />
      ) : runLoad.error ? (
        <div className="v2-retry-panel">
          <ErrorNotice message={runLoad.error} />
          <button
            type="button"
            data-testid="dashboard-retry"
            onClick={() => setRunRevision((r) => r + 1)}
          >
            Réessayer
          </button>
        </div>
      ) : runLoad.data ? (
        <>
          <DashboardContent
            organization={organization}
            record={runLoad.data}
            latestRunMeta={latestRunMeta}
            verifiedFallback={fallbackLoad.data}
            base={base}
          />
          {sortedRuns.length > 1 && (
            <section
              className="v2-dashboard-section v2-dashboard-runs"
              aria-label="Runs récents"
            >
              <h2>Runs récents ({sortedRuns.length})</h2>
              <ul className="v2-runs-list">
                {pagedRuns.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={
                        item.id === activeRunMeta.id ? "primary" : undefined
                      }
                      aria-pressed={item.id === activeRunMeta.id}
                      onClick={() => setSelectedRunId(item.id)}
                    >
                      <span>{item.status || "INCONNU"}</span>
                      <small>{formatRunDate(item.created_at)}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {totalPages > 1 && (
                <div className="v2-pagination">
                  <button
                    type="button"
                    disabled={currentPage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Précédent
                  </button>
                  <span>
                    Page {currentPage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage + 1 >= totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                  >
                    Suivant
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <NoRunState organization={organization} base={base} />
      )}
    </>
  );
}
