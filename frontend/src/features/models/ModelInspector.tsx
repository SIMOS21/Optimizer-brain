import { useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  Artifact,
  Composition,
  ModelArtifact,
  Organization,
  Schemas,
} from "../../api/types";
import { canonical, decode, parsePrecise } from "../../api/validation";
import { ErrorNotice, JsonView } from "../../shared/ui";
import { text } from "../../shared/format";

type Scalar = Schemas["Constraint-Output"]["rhs"];
function scalar(value: Scalar | null) {
  return value && typeof value === "object"
    ? `paramètre(${value.parameter})`
    : text(value);
}
export function ModelInspector({ document }: { document: Composition }) {
  const dsl = document.dsl;
  return (
    <div className="model-inspector">
      <section className="panel">
        <div className="section-title">
          <h2>Formulation mathématique</h2>
          <span className="badge">HARD · objectif unique</span>
        </div>
        {dsl.objectives.map((objective) => (
          <div className="objective" key={objective.id}>
            <span className="eyebrow">
              {objective.sense === "MAX" ? "MAXIMISER" : "MINIMISER"} ·{" "}
              {objective.unit}
            </span>
            <p>
              {objective.terms
                .map((term) => `${scalar(term.coefficient)} × ${term.variable}`)
                .join(" + ")}
            </p>
            <small>
              Source : {objective.source} · version {objective.version}
            </small>
          </div>
        ))}
        <h3>Contraintes compilées · {dsl.constraints.length}</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Identifiant / propriétaire</th>
                <th>Expression canonique</th>
                <th>Unité</th>
                <th>Provenance</th>
              </tr>
            </thead>
            <tbody>
              {dsl.constraints.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.id}</strong>
                    <small>{row.owner_department} · HARD</small>
                  </td>
                  <td>
                    <code>
                      {row.terms
                        .map(
                          (term) =>
                            `${scalar(term.coefficient)} × ${term.variable} [${term.coefficient_unit}]`,
                        )
                        .join(" + ") || "0"}{" "}
                      {row.operator} {scalar(row.rhs)}
                    </code>
                  </td>
                  <td>{row.unit}</td>
                  <td>
                    {row.source}
                    <small>v{row.version}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Liaisons ressources → contraintes</h3>
        <ul>
          {document.resource_traces.map((trace) => (
            <li key={trace.resource_id}>
              <strong>{trace.resource_id}</strong> · paramètre{" "}
              {trace.parameter_id} →{" "}
              {trace.constraint_id &&
              dsl.constraints.some((row) => row.id === trace.constraint_id) ? (
                <code>{trace.constraint_id}</code>
              ) : (
                "Aucune contrainte compilée liée"
              )}
              <small>
                Contributions : {trace.contribution_ids.join(", ") || "Aucune"}
              </small>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Variables de décision</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Domaine</th>
                <th>Bornes</th>
                <th>Unité</th>
                <th>Département</th>
              </tr>
            </thead>
            <tbody>
              {dsl.variables.map((variable) => (
                <tr key={variable.id}>
                  <td>{variable.id}</td>
                  <td>{variable.type}</td>
                  <td>
                    {scalar(variable.lb)} ≤ x ≤ {scalar(variable.ub)}
                  </td>
                  <td>{variable.unit}</td>
                  <td>{variable.department}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>Paramètres et provenance</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Paramètre</th>
                <th>Valeur</th>
                <th>Unité</th>
                <th>Source / version</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(dsl.parameters)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([id, parameter]) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{parameter.value}</td>
                    <td>{parameter.unit}</td>
                    <td>
                      {parameter.source}
                      <small>v{parameter.version}</small>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>Traçabilité</h2>
        <dl>
          <dt>Hash mathématique</dt>
          <dd>{document.model_hash}</dd>
          <dt>Snapshot des données</dt>
          <dd>{dsl.data_snapshot_id}</dd>
          <dt>Manifeste de composition</dt>
          <dd>{document.composition_manifest_hash}</dd>
        </dl>
        <JsonView title="IR originale enregistrée" value={document.ir} />
        <JsonView
          title="Chemins de provenance des contraintes"
          value={document.constraint_traces}
        />
        <JsonView
          title="Source organisationnelle complète"
          value={document.organization_model}
        />
      </section>
    </div>
  );
}

export function ModelEditor({
  client,
  organization,
  source,
  graphs,
  onSaved,
  onCancel,
}: {
  client: ApiClient;
  organization: Organization;
  source: ModelArtifact;
  graphs: Artifact[];
  onSaved: (record: ModelArtifact) => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(canonical(source.document.organization_model));
  const [version, setVersion] = useState("");
  const [graphId, setGraphId] = useState(source.graph_snapshot_id || "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      if (!version.trim() || version === source.version)
        throw new Error("Une nouvelle version de modèle est obligatoire.");
      const model = decode("OrganizationModel-Input", parsePrecise(raw));
      model.model_version = version.trim();
      const record = await client.request(
        `/organizations/${organization.id}/model-versions`,
        "ModelArtifactResponse",
        "POST",
        { graph_snapshot_id: graphId, model },
      );
      onSaved(record);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Validation refusée.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel editor">
      <div className="section-title">
        <h2>Nouvelle version du modèle</h2>
        <button onClick={onCancel}>Annuler</button>
      </div>
      <p>
        Édition structurée des variables, contraintes HARD et fragments. Le
        serveur valide et compile ; aucune équation n’est déduite du dessin.
      </p>
      <ErrorNotice message={error} />
      <div className="form-grid">
        <label>
          Nouvelle version du modèle
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          />
        </label>
        <label>
          Graphe publié référencé
          <select
            value={graphId}
            onChange={(event) => setGraphId(event.target.value)}
          >
            {graphs
              .filter((graph) => graph.state === "PUBLISHED")
              .map((graph) => (
                <option key={graph.id} value={graph.id}>
                  {graph.key} · v{graph.version}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label>
        Source des fragments et contraintes
        <textarea
          rows={20}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          spellCheck={false}
        />
      </label>
      <p className="quiet">
        Le JSON doit reprendre exactement le graphe publié choisi, ses
        paramètres et les versions attendues par les imports. Aucun alignement
        ni assouplissement automatique.
      </p>
      <button
        className="primary"
        disabled={busy || !version.trim()}
        onClick={() => void save()}
      >
        {busy
          ? "Compilation et validation…"
          : "Valider et enregistrer le modèle"}
      </button>
    </section>
  );
}
