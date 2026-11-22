import { text, unitLabel } from "../../shared/format";
import { useState } from "react";
import type { ApiClient } from "../../api/client";
import type { Artifact, Json, Organization } from "../../api/types";
import { useLoad } from "../../shared/async";
import { Empty, ErrorNotice, JsonView } from "../../shared/ui";

function object(value: Json | undefined): { [key: string]: Json } | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}
function RunDetail({
  client,
  org,
  id,
}: {
  client: ApiClient;
  org: string;
  id: string;
}) {
  const loaded = useLoad(() => client.run(org, id), [client, org, id]);
  if (loaded.loading)
    return <p role="status">Chargement du résultat enregistré…</p>;
  if (!loaded.data) return <ErrorNotice message={loaded.error} />;
  const record = loaded.data;
  const { solve, report } = record.document;
  const verified =
    object(solve.validation_report)?.valid === true &&
    report.has_verified_plan === true;
  return (
    <section className="panel run-detail">
      <span className="eyebrow">RÉSULTAT HISTORIQUE</span>
      <h2>{record.status}</h2>
      <p className="notice">
        {verified
          ? "Vérification indépendante réussie — selon les tolérances enregistrées."
          : "Aucun plan vérifié disponible dans cet enregistrement."}
      </p>
      <div className="metrics">
        <div>
          <span>Objectif enregistré</span>
          <strong data-testid="recorded-objective">
            {text(solve.objective_value)}
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
        <dt>Run</dt>
        <dd>{record.id}</dd>
        <dt>Version du modèle</dt>
        <dd>{text(solve.model_version)}</dd>
        <dt>Snapshot</dt>
        <dd>{text(solve.data_snapshot_id)}</dd>
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
      <JsonView title="Décisions enregistrées" value={solve.decision_values} />
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
        title="Ressources et marges du rapport enregistré"
        value={report.resources}
      />
      <JsonView value={record.document} />
    </section>
  );
}
export function History({
  client,
  organization,
  records,
}: {
  client: ApiClient;
  organization: Organization;
  records: Artifact[];
}) {
  const [selected, select] = useState("");
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">HISTORIQUE VÉRIFIÉ</span>
        <h1>Les résultats conservés</h1>
        <p>
          Les valeurs proviennent uniquement des runs stockés. Le lancement de
          calcul sera disponible en Phase 4C.
        </p>
      </div>
      {!records.length ? (
        <Empty>
          Aucun run enregistré pour cette organisation. Aucun indicateur n’est
          extrapolé.
        </Empty>
      ) : (
        <>
          <section className="panel">
            <label>
              Résultat à consulter
              <select
                aria-label="Résultat historique"
                value={selected}
                onChange={(event) => select(event.target.value)}
              >
                <option value="">Choisir un run</option>
                {records.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.status} · {record.id}
                  </option>
                ))}
              </select>
            </label>
          </section>
          {selected && (
            <RunDetail
              key={selected}
              client={client}
              org={organization.id}
              id={selected}
            />
          )}
        </>
      )}
    </>
  );
}
