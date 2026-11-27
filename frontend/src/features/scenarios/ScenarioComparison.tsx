import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../../api/client";
import type {
  Artifact,
  ComparedRun,
  Organization,
  ScenarioComparison as Report,
} from "../../api/types";
import { useLoad } from "../../shared/async";
import {
  PageHeader,
  Skeleton,
  StatusChip,
  EmptyState,
} from "../../shared/design-system";
import { ErrorNotice, JsonView } from "../../shared/ui";
import { usePresentation } from "../../shared/presentation/context";
import "../../styles/scenario-comparison.css";

function amount(
  value: string | null | undefined,
  unit?: string | null,
): string {
  return value == null ? "Non fourni" : `${value}${unit ? ` ${unit}` : ""}`;
}

function RunCard({ run, label }: { run: ComparedRun | null; label: string }) {
  const { mode } = usePresentation();
  return (
    <article className="panel comparison-run">
      <h2>{label}</h2>
      {!run ? (
        <p>Aucun run sélectionné.</p>
      ) : (
        <>
          <h3>{run.model_name}</h3>
          <p>
            {run.scenario_name || "Modèle publié sans scénario enregistré"} ·
            version {run.model_version}
          </p>
          <p>
            Enregistré le{" "}
            {new Date(run.created_at * 1000).toLocaleString("fr-FR")}
          </p>
          <StatusChip tone={run.verified_plan ? "positive" : "danger"}>
            {run.verified_plan
              ? "Plan revérifié"
              : "Plan non vérifié ou absent"}
          </StatusChip>
          <p>
            Statut mathématique enregistré :{" "}
            <strong>{run.public_status}</strong>
          </p>
          <p>
            Objectif {run.objective_sense} · {run.objective_id}
          </p>
          <p
            className="comparison-objective"
            data-testid={`comparison-${label === "Référence" ? "baseline" : "candidate"}-objective`}
          >
            {amount(
              run.verified_plan ? run.objective_value : null,
              run.objective_unit,
            )}
          </p>
          <p>Snapshot : {run.data_snapshot_id}</p>
          <Link
            to={`/organizations/${encodeURIComponent(run.organization_id)}/history/${encodeURIComponent(run.run_id)}`}
          >
            Consulter le résultat complet · {label}
          </Link>
          <p>
            <Link
              to={`/organizations/${encodeURIComponent(run.organization_id)}/models/${encodeURIComponent(run.model_version_id)}`}
            >
              Consulter le modèle · {label}
            </Link>
            {run.scenario_version_id && (
              <>
                {" "}
                ·{" "}
                <Link
                  to={`/organizations/${encodeURIComponent(run.organization_id)}/scenarios/${encodeURIComponent(run.scenario_version_id)}`}
                >
                  Consulter la filiation du scénario · {label}
                </Link>
              </>
            )}
          </p>
          {!run.verified_plan && (
            <ul>
              {run.verification_issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {!!run.assumptions.length && (
            <details>
              <summary>Hypothèses enregistrées · {label}</summary>
              {run.assumptions.map((change, i) => (
                <article key={i} className="comparison-assumption">
                  <p>Règle : {String(change.rule_id ?? "Non fourni")}</p>
                  <p>
                    Référence : {String(change.original_value ?? "Non fourni")}{" "}
                    {String(change.unit ?? "")}
                  </p>
                  <p>
                    Précédente : {String(change.previous_value ?? "Non fourni")}{" "}
                    {String(change.unit ?? "")}
                  </p>
                  <p>
                    Proposée : {String(change.proposed_value ?? "Non fourni")}{" "}
                    {String(change.unit ?? "")}
                  </p>
                  <p>
                    Source : {String(change.source ?? "Non fourni")} · auteur :{" "}
                    {String(change.changed_by ?? "Non fourni")}
                  </p>
                </article>
              ))}
            </details>
          )}
          {mode === "expert" && (
            <>
              <p>Statut natif : {run.native_status}</p>
              <JsonView
                title={`Provenance et vérification · ${label}`}
                value={run}
              />
            </>
          )}
        </>
      )}
    </article>
  );
}

function Matrix({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel comparison-matrix">
      <h2>{title}</h2>
      <p className="comparison-table-hint">
        Sur petit écran, faites défiler le tableau horizontalement pour lire les
        deux plans.
      </p>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Élément</th>
              <th scope="col">Référence</th>
              <th scope="col">Candidat</th>
              <th scope="col">Variation observée</th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonResult({ report }: { report: Report }) {
  const { mode } = usePresentation();
  const labels = {
    COMPARABLE: "Cadre identique",
    QUALIFIED: "Hypothèses différentes",
    NOT_COMPARABLE: "Non comparable",
    INCOMPLETE: "Sélection incomplète",
  };
  return (
    <div data-testid="scenario-comparison-result">
      <section className="panel comparison-conclusion" aria-live="polite">
        <StatusChip
          tone={
            report.comparability === "NOT_COMPARABLE" ? "danger" : "warning"
          }
        >
          {mode === "expert"
            ? report.comparability
            : labels[report.comparability]}
        </StatusChip>
        <h2>Qualification de la comparaison</h2>
        <p data-testid="comparison-message">{report.message}</p>
        <p>
          L’optimalité reste celle attestée dans les tolérances enregistrées,
          sans nouvelle preuve d’optimalité exacte.
        </p>
        <ul>
          {report.reasons.map((r, i) => (
            <li key={i}>
              {r.side === "BASELINE"
                ? "Référence : "
                : r.side === "CANDIDATE"
                  ? "Candidat : "
                  : ""}
              {r.message}
              {mode === "expert" ? ` (${r.code})` : ""}
            </li>
          ))}
        </ul>
      </section>
      <div className="comparison-sides">
        <RunCard label="Référence" run={report.baseline} />
        <RunCard label="Candidat" run={report.candidate} />
      </div>
      <section className="panel comparison-differences">
        <h2>Écarts calculés côté serveur</h2>
        <dl>
          <dt>Candidat − référence</dt>
          <dd data-testid="comparison-observed-delta">
            {amount(report.observed_objective_delta, report.objective_unit)}
          </dd>
          <dt>Écart orienté selon MAX/MIN</dt>
          <dd>
            {amount(report.oriented_objective_delta, report.objective_unit)}
          </dd>
          <dt>Amélioration de l’objectif dans le même cadre</dt>
          <dd>{amount(report.objective_improvement, report.objective_unit)}</dd>
          <dt>Ratio de cette amélioration / valeur absolue de la référence</dt>
          <dd>{amount(report.objective_improvement_percent, "%")}</dd>
          <dt>Gain économique réel</dt>
          <dd>Non démontré</dd>
        </dl>
        <p>
          Un ratio non décimal est conservé sous forme de fraction exacte. Aucun
          montant, delta ou pourcentage n’est recalculé par le navigateur.
        </p>
      </section>
      {!!report.decisions.length && (
        <Matrix title="Décisions des plans vérifiés">
          {report.decisions.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {r.id}
                <small>{r.department}</small>
              </th>
              <td>{amount(r.baseline_value, r.baseline_unit)}</td>
              <td>{amount(r.candidate_value, r.candidate_unit)}</td>
              <td>{amount(r.delta, r.unit)}</td>
            </tr>
          ))}
        </Matrix>
      )}
      {!!report.resources.length && (
        <Matrix title="Ressources et marges">
          {report.resources.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {r.id}
                <small>{r.department}</small>
              </th>
              {[r.baseline, r.candidate].map((v, i) => (
                <td key={i}>
                  {!v ? (
                    "Non fourni"
                  ) : (
                    <>
                      <p>Capacité : {amount(v.capacity, v.unit)}</p>
                      <p>Consommation : {amount(v.consumption, v.unit)}</p>
                      <p>Marge : {amount(v.remaining, v.unit)}</p>
                      <p>{v.state}</p>
                    </>
                  )}
                </td>
              ))}
              <td>
                <p>Capacité : {amount(r.capacity_delta, r.unit)}</p>
                <p>Consommation : {amount(r.consumption_delta, r.unit)}</p>
                <p>Marge : {amount(r.remaining_delta, r.unit)}</p>
              </td>
            </tr>
          ))}
        </Matrix>
      )}
      {!!report.constraints.length && (
        <Matrix title="Contraintes et saturation">
          {report.constraints.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                {r.id}
                <small>{r.department}</small>
              </th>
              {[r.baseline, r.candidate].map((v, i) => (
                <td key={i}>
                  {!v ? (
                    "Non fourni"
                  ) : (
                    <>
                      <p>{v.state}</p>
                      <p>Activité : {amount(v.lhs, v.unit)}</p>
                      <p>Seuil : {amount(v.rhs, v.unit)}</p>
                      <p>Marge : {amount(v.slack, v.unit)}</p>
                      <p>Tolérance : {amount(v.tolerance, v.unit)}</p>
                    </>
                  )}
                </td>
              ))}
              <td>{amount(r.slack_delta, r.unit)}</td>
            </tr>
          ))}
        </Matrix>
      )}
      <section className="panel">
        <h2>Portée et limites</h2>
        <ul>
          {report.limitations?.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {mode === "expert" && (
          <JsonView title="Rapport canonique de comparaison" value={report} />
        )}
      </section>
    </div>
  );
}

export function ScenarioComparison({
  client,
  organization,
  records,
}: {
  client: ApiClient;
  organization: Organization;
  records: Artifact[];
}) {
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState("");
  const [request, setRequest] = useState<{
    baseline: string | null;
    candidate: string | null;
    revision: number;
  }>();
  const loaded = useLoad(
    () =>
      request
        ? client.compareRuns(
            organization.id,
            request.baseline,
            request.candidate,
          )
        : Promise.resolve(null),
    [client, organization.id, request],
  );
  const authorized = records
    .filter((r) => r.organization_id === organization.id)
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  return (
    <div className="scenario-comparison">
      <PageHeader
        eyebrow="SCENARIO LAB · COMPARAISON VÉRIFIÉE"
        title="Comparer deux résultats enregistrés"
      >
        <p>
          Choisissez explicitement la référence et le candidat. Le serveur
          vérifie leur provenance, les plans et la signification de leur
          objectif avant de calculer un écart.
        </p>
      </PageHeader>
      <Link to={`/organizations/${organization.id}/history`}>
        Revenir à l’historique
      </Link>
      <p className="notice">
        Lecture seule pour tous les membres autorisés. Un scénario sans run doit
        d’abord être publié et exécuté. Aucune nouvelle optimisation n’est
        déclenchée ici.
      </p>
      {!authorized.length ? (
        <EmptyState title="Aucun résultat enregistré à comparer">
          Consultez Scenario Lab et Optimization Center pour préparer puis
          exécuter un modèle publié.
        </EmptyState>
      ) : (
        <form
          className="panel comparison-selection"
          onSubmit={(e) => {
            e.preventDefault();
            if (request && loaded.loading) return;
            setRequest((r) => ({
              baseline: baseline || null,
              candidate: candidate || null,
              revision: (r?.revision || 0) + 1,
            }));
          }}
        >
          {(["Référence", "Candidat"] as const).map((label) => (
            <label key={label}>
              Run de {label === "Référence" ? "référence" : "scénario candidat"}
              <select
                aria-label={`Run de ${label === "Référence" ? "référence" : "scénario candidat"}`}
                value={label === "Référence" ? baseline : candidate}
                onChange={(e) => {
                  if (label === "Référence") setBaseline(e.target.value);
                  else setCandidate(e.target.value);
                  setRequest(undefined);
                }}
              >
                <option value="">Choisir un résultat enregistré</option>
                {authorized.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.created_at * 1000).toLocaleString("fr-FR")} ·{" "}
                    {r.status} · {r.id}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            disabled={
              (!baseline && !candidate) || (!!request && loaded.loading)
            }
          >
            Vérifier la comparaison
          </button>
        </form>
      )}
      {request && loaded.loading && (
        <Skeleton label="Revérification des plans et comparaison serveur…" />
      )}
      {request && loaded.error && (
        <section className="panel">
          <ErrorNotice message={loaded.error} />
          <button
            onClick={() =>
              setRequest((r) => r && { ...r, revision: r.revision + 1 })
            }
          >
            Réessayer cette comparaison
          </button>
        </section>
      )}
      {request && loaded.data && <ComparisonResult report={loaded.data} />}
    </div>
  );
}
