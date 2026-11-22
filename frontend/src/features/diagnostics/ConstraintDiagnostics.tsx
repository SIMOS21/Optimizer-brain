import { useState } from "react";
import type { ApiClient } from "../../api/client";
import { useLoad } from "../../shared/async";
import { ErrorNotice, JsonView } from "../../shared/ui";

function Report({
  client,
  org,
  id,
  kind,
  contentHash,
}: {
  client: ApiClient;
  org: string;
  id: string;
  kind: "model-versions" | "optimization-runs";
  contentHash: string;
}) {
  const loaded = useLoad(
    () => client.diagnostics(org, id, kind),
    [client, org, id, kind, contentHash],
  );
  if (loaded.loading) return <p role="status">Chargement des diagnostics…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  if (loaded.data.content_hash !== contentHash)
    return (
      <ErrorNotice message="Diagnostics incompatibles avec l'empreinte de l'artefact ouvert." />
    );
  const report = loaded.data.report;
  return (
    <div data-testid="constraint-diagnostics">
      <p data-testid="static-conclusion">
        {report.static_conclusion === "CONTRADICTION_PROVEN"
          ? "Contradiction démontrée sur le modèle rationnel exact."
          : report.static_conclusion === "NOT_ANALYZED"
            ? "Modèle invalide : analyse statique non effectuée."
            : "Analyse statique non concluante : aucune preuve de faisabilité ni d'infaisabilité."}
      </p>
      <p>
        Statut solveur enregistré : {report.solver_status ?? "non disponible"}.
        Aucun IIS fourni.
      </p>
      <p>
        {report.plan_checked
          ? report.plan_valid
            ? "Plan contrôlé indépendamment selon les tolérances enregistrées."
            : "Plan refusé par le vérificateur indépendant."
          : "Aucun plan à contrôler : mesures de contraintes indisponibles."}
      </p>
      {report.plan_issues.length > 0 && (
        <ul>
          {report.plan_issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {report.findings.map((finding, index) => (
        <article className="panel compact" key={`${finding.code}-${index}`}>
          <h3>{finding.code}</h3>
          <p>{finding.message}</p>
          {finding.constraints.map((link) => (
            <p key={link.constraint_id}>
              {link.constraint_id} · département {link.department} · source{" "}
              {link.source} · version {link.version}
              <br />
              Fragments : {link.fragment_ids.join(", ") || "non disponibles"} ·
              ressources : {link.resource_id ?? "aucune"}
              <br />
              Provenance : {link.source_paths.join(", ")}
            </p>
          ))}
          {finding.variable_ids.length > 0 && (
            <p>Variables : {finding.variable_ids.join(", ")}</p>
          )}
          <JsonView title="Éléments de preuve exacts" value={finding.facts} />
        </article>
      ))}
      <p className="notice">
        Coûts non évalués : une contrainte saturée ne prouve aucun coût
        d'opportunité ni prix d'ombre positif.
      </p>
      <div className="table-scroll">
        <table>
          <caption>Activité des contraintes du plan contrôlé</caption>
          <thead>
            <tr>
              <th>Contrainte</th>
              <th>Département</th>
              <th>État</th>
              <th>Membre gauche</th>
              <th>Limite</th>
              <th>Marge</th>
              <th>Violation</th>
              <th>Tolérance</th>
              <th>Unité IR (dimensions × échelle)</th>
              <th>Coût</th>
            </tr>
          </thead>
          <tbody>
            {report.activities.map((activity) => (
              <tr key={activity.constraint.constraint_id}>
                <td>{activity.constraint.constraint_id}</td>
                <td>{activity.constraint.department}</td>
                <td>{activity.state}</td>
                <td>{activity.lhs ?? "—"}</td>
                <td>{activity.rhs}</td>
                <td>{activity.slack ?? "—"}</td>
                <td>{activity.violation ?? "—"}</td>
                <td>{activity.tolerance ?? "—"}</td>
                <td>
                  {activity.unit_dimensions
                    .map(([dimension, power]) => `${dimension}^${power}`)
                    .join(" · ") || "1"}{" "}
                  × {activity.unit_scale}
                </td>
                <td>{activity.cost_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul>
        {report.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
      <JsonView
        title="Rapport de diagnostic et traçabilité"
        value={loaded.data}
      />
    </div>
  );
}

export function ConstraintDiagnostics(props: Parameters<typeof Report>[0]) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel" aria-label="Diagnostics des contraintes">
      <h2>Diagnostics des contraintes</h2>
      <p>
        Consultation en lecture seule du modèle original. Aucune contrainte
        n'est modifiée.
      </p>
      <button onClick={() => setOpen(!open)}>
        {open ? "Masquer les diagnostics" : "Consulter les diagnostics"}
      </button>
      {open && <Report {...props} />}
    </section>
  );
}
