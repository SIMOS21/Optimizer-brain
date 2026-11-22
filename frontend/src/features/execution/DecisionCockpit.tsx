import { Link } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import type { Json, RunArtifact } from "../../api/types";
import { useLoad } from "../../shared/async";
import { text, unitLabel } from "../../shared/format";
import { Empty, ErrorNotice, JsonView } from "../../shared/ui";

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
  const { solve, report } = record.document;
  const validation = object(solve.validation_report);
  const verified =
    validation?.valid === true &&
    object(validation.plan)?.feasible === true &&
    report.has_verified_plan === true &&
    object(solve.decision_values) !== undefined &&
    ["OPTIMAL", "FEASIBLE", "TIME_LIMIT"].includes(text(solve.status)) &&
    ["OPTIMAL", "FEASIBLE_NOT_PROVEN_OPTIMAL"].includes(record.status || "") &&
    record.status === solve.public_status &&
    report.status === solve.public_status;
  const decisions = object(solve.decision_values);
  const declaredDecisions = rows(report.departments).flatMap((department) =>
    rows(department.decisions),
  );
  return (
    <section className="panel run-detail decision-cockpit">
      <span className="eyebrow">DECISION COCKPIT · RÉSULTAT HISTORIQUE</span>
      <h2 data-testid="mathematical-status">{record.status}</h2>
      <p>
        {!verified &&
        ["OPTIMAL", "FEASIBLE_NOT_PROVEN_OPTIMAL"].includes(record.status || "")
          ? "Statut favorable enregistré, mais aucun plan indépendamment vérifié exploitable. Ne pas considérer ce résultat comme une décision validée."
          : descriptions[record.status || ""] ||
            "Statut mathématique non reconnu : aucune garantie supplémentaire n’est déduite."}
      </p>
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
        <div>
          <span>Meilleure borne</span>
          <strong>{text(solve.best_bound)}</strong>
        </div>
        <div>
          <span>Gap relatif</span>
          <strong>{text(solve.relative_gap)}</strong>
        </div>
      </div>
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
      {verified && decisions && (
        <>
          <section>
            <h3>Variables de décision vérifiées</h3>
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
          </section>
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
      <JsonView title="Document historique original" value={record.document} />
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
  const loaded = useLoad(() => client.run(org, id), [client, org, id]);
  if (loaded.loading)
    return <p role="status">Chargement du résultat enregistré…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  if (expectedModel && loaded.data.model_version_id !== expectedModel)
    return (
      <ErrorNotice message="Résultat incompatible avec le modèle du job." />
    );
  return <DecisionCockpit record={loaded.data} />;
}
