import { useState } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import type { Json, RunArtifact } from "../../api/types";
import { useLoad } from "../../shared/async";
import { text, unitLabel } from "../../shared/format";
import { Empty, ErrorNotice, JsonView } from "../../shared/ui";
import { ConstraintDiagnostics } from "../diagnostics/ConstraintDiagnostics";
import { ResultAssistant } from "../assistant/ResultAssistant";
import { assessTrust } from "../dashboard/trust";
import { Skeleton, StatusChip } from "../../shared/design-system";
import { usePresentation } from "../../shared/presentation/context";
import "../../styles/execution-center.css";

function object(value: Json | undefined): Record<string, Json> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}
function rows(value: Json | undefined) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const row = object(item);
        return row && typeof row.id === "string" ? [row] : [];
      })
    : [];
}
const descriptions: Record<string, string> = {
  OPTIMAL:
    "Optimalité selon les tolérances enregistrées du solveur ; aucune optimalité rationnelle exacte n’est revendiquée.",
  FEASIBLE_NOT_PROVEN_OPTIMAL:
    "Un plan réalisable est disponible seulement si la vérification indépendante a réussi. L’optimalité n’est pas prouvée.",
  INFEASIBLE:
    "Le solveur a déclaré le modèle infaisable. Aucun plan de décision disponible.",
  UNBOUNDED:
    "Le solveur a déclaré le problème non borné. Aucun optimum fini fourni.",
  TIME_LIMIT_NO_SOLUTION:
    "Limite de temps atteinte sans solution réalisable vérifiée.",
  SOLUTION_FAILED_VALIDATION:
    "Le vérificateur indépendant a refusé le résultat du solveur.",
  INVALID_MODEL: "Le modèle a été refusé avant résolution.",
  SOLVER_ERROR:
    "La résolution n’a pas fourni de résultat mathématique exploitable.",
  UNKNOWN: "Statut insuffisant pour affirmer la faisabilité ou l’optimalité.",
};
const activityLabels: Record<string, string> = {
  SATURATED: "Saturée", SATISFIED: "Respectée", VIOLATED: "Violée",
  UNAVAILABLE: "Mesure indisponible", UNMODELED: "Capacité non modélisée",
};
function Measurements({
  title,
  data,
  columns,
}: {
  title: string;
  data: Record<string, Json>[];
  columns: [string, string][];
}) {
  return (
    <section>
      <h3>{title}</h3>
      {!data.length ? (
        <Empty>Aucune mesure enregistrée disponible.</Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map(([key, name]) => (
                  <th key={key}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={text(row.id)}>
                  {columns.map(([key]) => (
                    <td key={key}>{text(row[key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export function DecisionCockpit({ record }: { record: RunArtifact }) {
  const { mode } = usePresentation();
  const { solve, report } = record.document;
  const trust = assessTrust(record);
  const verified = trust.hasVerifiedPlan;
  const decisions = object(solve.decision_values);
  const declaredDecisions = rows(report.departments).flatMap((department) =>
    rows(department.decisions),
  );
  return (
    <section className="panel run-detail decision-cockpit">
      <span className="eyebrow">
        ÉTAPE 5 · COMPRENDRE LE RÉSULTAT HISTORIQUE
      </span>
      <StatusChip tone={trust.tone}>{trust.label}</StatusChip>
      <h2 data-testid="mathematical-status">{record.status}</h2>
      <p>
        {!verified &&
        ["OPTIMAL", "FEASIBLE_NOT_PROVEN_OPTIMAL"].includes(record.status || "")
          ? "Statut favorable enregistré, mais aucun plan indépendamment vérifié exploitable. Ne pas considérer ce résultat comme une décision validée."
          : descriptions[record.status || ""] ||
            "Statut mathématique non reconnu : aucune garantie supplémentaire n’est déduite."}
      </p>
      <div className="execution-result-context" data-testid="cockpit-context">
        <p>
          Modèle enregistré : {text(solve.model_id)} · version{" "}
          {text(solve.model_version)}
        </p>
        <p>
          Scénario déclaré : {text(solve.scenario_id)} · snapshot :{" "}
          {text(solve.data_snapshot_id)}
        </p>
        <p>
          Résultat du{" "}
          {new Date(record.created_at * 1000).toLocaleString("fr-FR")} ·{" "}
          <Link
            to={`/organizations/${record.organization_id}/history/${record.id}`}
          >
            Consulter ce résultat conservé
          </Link>
        </p>
        <small>
          Chaque résultat porte ses propres hypothèses. Aucun rapprochement
          économique avec une autre version n’est déduit.
        </small>
      </div>
      {solve.status === "TIME_LIMIT" && (
        <p className="notice">
          TIME_LIMIT — résolution interrompue à la limite de temps ; l’existence
          d’un plan vérifié est indiquée séparément.
        </p>
      )}
      <p className="notice" data-testid="independent-verification">
        {verified
          ? "Vérification indépendante réussie — selon les tolérances enregistrées."
          : "Aucun plan vérifié disponible dans cet enregistrement."}
      </p>
      <div className="metrics">
        <div>
          <span>Objectif enregistré</span>
          <strong data-testid="recorded-objective">
            {text(verified ? solve.objective_value : null)}
          </strong>
          <span>{unitLabel(solve.objective_unit)}</span>
          <small>Aucune valeur recalculée par le navigateur</small>
        </div>
        {mode === "expert" && (
          <div>
            <span>Meilleure borne</span>
            <strong>{text(solve.best_bound)}</strong>
          </div>
        )}
        {mode === "expert" && (
          <div>
            <span>Gap relatif</span>
            <strong>{text(solve.relative_gap)}</strong>
          </div>
        )}
      </div>
      {mode === "expert" && (
        <dl>
          <dt>Run immuable</dt>
          <dd>
            <Link
              to={`/organizations/${record.organization_id}/history/${record.id}`}
            >
              {record.id}
            </Link>
          </dd>
          <dt>Identifiant du modèle publié</dt>
          <dd>
            <Link
              to={`/organizations/${record.organization_id}/models/${record.model_version_id}`}
            >
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
          <dt>Statut interne / terminaison</dt>
          <dd>
            {text(solve.status)} / {text(solve.termination_reason)}
          </dd>
          <dt>Libellé d’optimalité enregistré</dt>
          <dd>{text(solve.optimality_label)}</dd>
          <dt>Portée du certificat</dt>
          <dd>{text(solve.certificate_scope)}</dd>
          <dt>Gap absolu</dt>
          <dd>{text(solve.absolute_gap)}</dd>
          <dt>Solveur / version</dt>
          <dd>
            {text(solve.solver_name)} / {text(solve.solver_version)}
          </dd>
          <dt>Durée (ms)</dt>
          <dd>{text(solve.duration_ms)}</dd>
        </dl>
      )}
      {verified && decisions && (
        <>
          <section>
            <h3>Variables de décision vérifiées</h3>
            {mode === "business" ? (
              <div className="execution-decision-grid">
                {Object.entries(decisions).map(([key, value]) => (
                  <article className="v2-decision-card" key={key}>
                    <span>{key}</span>
                    <strong>{text(value)}</strong>
                    <span>
                      {text(declaredDecisions.find((d) => d.id === key)?.unit)}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Valeur enregistrée</th>
                      <th>Unité enregistrée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(decisions).map(([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>{text(value)}</td>
                        <td>
                          {text(
                            declaredDecisions.find(
                              (decision) => decision.id === key,
                            )?.unit,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {mode === "business" ? (
            <>
              <section>
                <h3>Ressources enregistrées</h3>
                <div className="execution-resource-grid">
                  {rows(report.resources).map((resource) => (
                    <article
                      className="execution-resource"
                      key={text(resource.id)}
                    >
                      <h4>{text(resource.name ?? resource.id)}</h4>
                      <StatusChip
                        tone={
                          resource.state === "SATURATED" ? "warning" : "neutral"
                        }
                      >
                        {activityLabels[text(resource.state)] || text(resource.state)}
                      </StatusChip>
                      <dl>
                        <dt>Consommation</dt>
                        <dd>
                          {text(resource.consumption)} {text(resource.unit)}
                        </dd>
                        <dt>Capacité</dt>
                        <dd>
                          {text(resource.capacity)} {text(resource.unit)}
                        </dd>
                        <dt>Marge restante</dt>
                        <dd>
                          {text(resource.remaining)} {text(resource.unit)}
                        </dd>
                      </dl>
                    </article>
                  ))}
                </div>
                {!rows(report.resources).length && (
                  <Empty>Aucune mesure enregistrée disponible.</Empty>
                )}
              </section>
              <section>
                <h3>Contraintes et marges enregistrées</h3>
                <p>
                  Une contrainte saturée est à sa limite selon les tolérances
                  enregistrées. Cela n’implique ni prix d’ombre positif ni gain
                  économique.
                </p>
                <div className="execution-constraint-list">
                  {rows(report.constraints).map((constraint) => (
                    <article key={text(constraint.id)}>
                      <strong>{text(constraint.id)}</strong>
                      <StatusChip
                        tone={
                          constraint.state === "SATURATED"
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {activityLabels[text(constraint.state)] || text(constraint.state)}
                      </StatusChip>
                      <span>
                        {text(constraint.lhs)} / {text(constraint.rhs)}{" "}
                        {text(constraint.unit)}
                      </span>
                      <span>
                        Marge : {text(constraint.slack)} {text(constraint.unit)}
                      </span>
                    </article>
                  ))}
                </div>
                {!rows(report.constraints).length && (
                  <Empty>Aucune mesure enregistrée disponible.</Empty>
                )}
              </section>
            </>
          ) : (
            <>
              <Measurements
                title="Contraintes et marges enregistrées"
                data={rows(report.constraints)}
                columns={[
                  ["id", "Contrainte"],
                  ["owner_department", "Département"],
                  ["state", "État"],
                  ["lhs", "Membre gauche"],
                  ["rhs", "Limite"],
                  ["slack", "Marge"],
                  ["unit", "Unité"],
                  ["tolerance", "Tolérance"],
                ]}
              />
              <Measurements
                title="Ressources enregistrées"
                data={rows(report.resources)}
                columns={[
                  ["id", "Ressource"],
                  ["state", "État"],
                  ["consumption", "Consommation"],
                  ["capacity", "Capacité"],
                  ["remaining", "Restant"],
                  ["unit", "Unité"],
                ]}
              />
              <JsonView
                title="Décisions enregistrées"
                value={solve.decision_values}
              />
            </>
          )}
        </>
      )}
      <section
        className="execution-warnings"
        aria-label="Avertissements et limites"
      >
        <h3>Avertissements et limites de validation</h3>
        <p>
          La faisabilité et l’optimalité restent limitées au modèle, au snapshot
          et aux tolérances enregistrées. Elles ne garantissent pas un gain
          opérationnel.
        </p>
        {Array.isArray(solve.warnings) && solve.warnings.length ? (
          <ul>
            {solve.warnings.map((warning, index) => (
              <li key={index}>{text(warning)}</li>
            ))}
          </ul>
        ) : (
          <p>Aucun avertissement fourni dans ce champ de l’artefact.</p>
        )}
      </section>
      {mode === "expert" && (
        <>
          <JsonView
            title="Tolérances, options et avertissements"
            value={{
              settings: solve.settings,
              solver_options: solve.solver_options,
              warnings: solve.warnings,
            }}
          />
          <JsonView
            title="Rapport de vérification original"
            value={solve.validation_report}
          />
          <JsonView
            title="Document historique original"
            value={record.document}
          />
        </>
      )}
    </section>
  );
}
export function StoredRun({
  client,
  org,
  id,
  expectedModel,
}: {
  client: ApiClient;
  org: string;
  id: string;
  expectedModel?: string;
}) {
  const [revision, setRevision] = useState(0);
  const loaded = useLoad(
    () => client.run(org, id),
    [client, org, id, revision],
  );
  if (loaded.loading)
    return <Skeleton label="Chargement du résultat enregistré…" />;
  if (!loaded.data)
    return (
      <section className="panel">
        <ErrorNotice message={loaded.error} />
        <button onClick={() => setRevision((n) => n + 1)}>
          Réessayer le résultat
        </button>
      </section>
    );
  if (expectedModel && loaded.data.model_version_id !== expectedModel)
    return (
      <ErrorNotice message="Résultat incompatible avec le modèle du job." />
    );
  return (
    <>
      <DecisionCockpit record={loaded.data} />
      <ResultAssistant client={client} org={org} run={id} />
      <ConstraintDiagnostics
        key={loaded.data.id}
        client={client}
        org={org}
        id={id}
        kind="optimization-runs"
        contentHash={loaded.data.content_hash}
      />
    </>
  );
}
