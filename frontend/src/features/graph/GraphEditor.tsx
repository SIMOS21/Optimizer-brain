import { useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  GraphArtifact,
  GraphDocument,
  Organization,
} from "../../api/types";
import { canonical, decode, parsePrecise } from "../../api/validation";
import { ErrorNotice } from "../../shared/ui";
import { exportGraph } from "./projection";
import { prepareDraft } from "./draft";

export function GraphEditor({
  client,
  organization,
  source,
  onSaved,
  onCancel,
}: {
  client: ApiClient;
  organization: Organization;
  source: GraphArtifact;
  onSaved: (record: GraphArtifact) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<GraphDocument>(() =>
    structuredClone(source.document),
  );
  const [version, setVersion] = useState("");
  const [selected, setSelected] = useState(
    source.document.graph.resources[0]?.id ||
      source.document.graph.departments[0]?.id ||
      "",
  );
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [edge, setEdge] = useState({
    id: "",
    type: "DEPENDS_ON" as "DEPENDS_ON" | "USES_RESOURCE",
    source_id: "",
    target_id: "",
  });
  function change(update: (document: GraphDocument) => void) {
    setDraft((current) => {
      const next = structuredClone(current);
      update(next);
      return next;
    });
  }
  const resource = draft.graph.resources.find((node) => node.id === selected);
  const node =
    resource ||
    draft.graph.departments.find((department) => department.id === selected);
  const parameter =
    resource && draft.shared_parameters[resource.capacity.parameter];
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const document = prepareDraft(source, draft, version);
      const validated = decode("GraphCreate-Input", document);
      const result = await client.request(
        `/organizations/${organization.id}/graphs`,
        "GraphArtifactResponse",
        "POST",
        validated,
      );
      onSaved(result);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Validation refusée.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">NOUVELLE VERSION</span>
          <h2>Préparer un brouillon</h2>
        </div>
        <button onClick={onCancel}>Annuler</button>
      </div>
      <p>
        Copie de {source.key} · v{source.version}. La source reste immuable. Les
        modifications seront validées et enregistrées ensemble par le serveur.
      </p>
      <ErrorNotice message={error} />
      <div className="form-grid">
        <label>
          Nouvelle version du graphe
          <input
            required
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          />
        </label>
        <label>
          Snapshot de données
          <input
            value={draft.graph.organization.data_snapshot_id}
            onChange={(event) =>
              change((copy) => {
                copy.graph.organization.data_snapshot_id = event.target.value;
              })
            }
          />
        </label>
        <label>
          Nom de l’organisation
          <input
            value={draft.graph.organization.name}
            onChange={(event) =>
              change((copy) => {
                copy.graph.organization.name = event.target.value;
              })
            }
          />
        </label>
        <label>
          Objet à modifier
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {[...draft.graph.departments, ...draft.graph.resources].map(
              (item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.id}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      {node && (
        <fieldset>
          <legend>Propriétés · {node.id}</legend>
          <div className="form-grid">
            <label>
              Nom affiché
              <input
                value={node.name}
                onChange={(event) =>
                  change((copy) => {
                    const target = [
                      ...copy.graph.departments,
                      ...copy.graph.resources,
                    ].find((item) => item.id === selected);
                    if (target) target.name = event.target.value;
                  })
                }
              />
            </label>
            <label>
              Source déclarée
              <input
                value={node.source}
                onChange={(event) =>
                  change((copy) => {
                    const target = [
                      ...copy.graph.departments,
                      ...copy.graph.resources,
                    ].find((item) => item.id === selected);
                    if (target) target.source = event.target.value;
                  })
                }
              />
            </label>
            <label>
              Version de l’objet
              <input
                value={node.version}
                onChange={(event) =>
                  change((copy) => {
                    const target = [
                      ...copy.graph.departments,
                      ...copy.graph.resources,
                    ].find((item) => item.id === selected);
                    if (target) target.version = event.target.value;
                  })
                }
              />
            </label>
            {resource && parameter && (
              <>
                <label>
                  Capacité · {resource.capacity.parameter}
                  <input
                    inputMode="decimal"
                    value={parameter.value}
                    onChange={(event) =>
                      change((copy) => {
                        const target =
                          copy.shared_parameters[resource.capacity.parameter];
                        if (target) target.value = event.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  Version de capacité (paramètre et référence)
                  <input
                    value={parameter.version}
                    onChange={(event) =>
                      change((copy) => {
                        const target =
                          copy.shared_parameters[resource.capacity.parameter];
                        if (target) target.version = event.target.value;
                        copy.graph.resources
                          .filter(
                            (item) =>
                              item.capacity.parameter ===
                              resource.capacity.parameter,
                          )
                          .forEach((item) => {
                            item.capacity_version = event.target.value;
                          });
                      })
                    }
                  />
                </label>
                <label>
                  Unité du paramètre
                  <input
                    value={parameter.unit}
                    onChange={(event) =>
                      change((copy) => {
                        const target =
                          copy.shared_parameters[resource.capacity.parameter];
                        if (target) target.unit = event.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  Propriétaire
                  <select
                    value={resource.owner_department}
                    onChange={(event) =>
                      change((copy) => {
                        const target = copy.graph.resources.find(
                          (item) => item.id === selected,
                        );
                        if (target) {
                          target.owner_department = event.target.value;
                          target.shared_with = target.shared_with.filter(
                            (id) => id !== event.target.value,
                          );
                        }
                      })
                    }
                  >
                    {draft.graph.departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <strong>Partage déclaré</strong>
                  {draft.graph.departments
                    .filter(
                      (department) =>
                        department.id !== resource.owner_department,
                    )
                    .map((department) => (
                      <label className="checkbox" key={department.id}>
                        <input
                          type="checkbox"
                          checked={resource.shared_with.includes(department.id)}
                          onChange={(event) =>
                            change((copy) => {
                              const target = copy.graph.resources.find(
                                (item) => item.id === selected,
                              );
                              if (target)
                                target.shared_with = event.target.checked
                                  ? [...target.shared_with, department.id]
                                  : target.shared_with.filter(
                                      (id) => id !== department.id,
                                    );
                            })
                          }
                        />
                        {department.name}
                      </label>
                    ))}
                </div>
              </>
            )}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend>Relations informatives</legend>
        <p>
          Ajouter une relation ne crée aucune contrainte. Une suppression reste
          explicite dans ce nouveau brouillon.
        </p>
        <ul className="relation-list">
          {draft.graph.edges.map((item) => (
            <li key={item.id}>
              <code>{item.id}</code> {item.source_id} → {item.target_id} ·{" "}
              {item.type}
              <button
                onClick={() =>
                  change((copy) => {
                    copy.graph.edges = copy.graph.edges.filter(
                      (current) => current.id !== item.id,
                    );
                  })
                }
                aria-label={`Retirer la relation ${item.id}`}
              >
                Retirer du brouillon
              </button>
            </li>
          ))}
        </ul>
        <div className="form-grid">
          <label>
            Identifiant de relation
            <input
              value={edge.id}
              onChange={(event) => setEdge({ ...edge, id: event.target.value })}
            />
          </label>
          <label>
            Type
            <select
              value={edge.type}
              onChange={(event) =>
                setEdge({
                  ...edge,
                  type: event.target.value as typeof edge.type,
                  target_id: "",
                })
              }
            >
              <option>DEPENDS_ON</option>
              <option>USES_RESOURCE</option>
            </select>
          </label>
          <label>
            Département source
            <select
              value={edge.source_id}
              onChange={(event) =>
                setEdge({ ...edge, source_id: event.target.value })
              }
            >
              <option value="">Choisir</option>
              {draft.graph.departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cible
            <select
              value={edge.target_id}
              onChange={(event) =>
                setEdge({ ...edge, target_id: event.target.value })
              }
            >
              <option value="">Choisir</option>
              {(edge.type === "DEPENDS_ON"
                ? draft.graph.departments
                : draft.graph.resources
              ).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          disabled={!edge.id || !edge.source_id || !edge.target_id}
          onClick={() => {
            change((copy) => {
              copy.graph.edges.push({ ...edge });
            });
            setEdge({ ...edge, id: "" });
          }}
        >
          Ajouter la relation au brouillon
        </button>
      </fieldset>
      <details>
        <summary>Édition structurée complète (JSON)</summary>
        <p>
          Permet d’ajouter des nœuds et paramètres. Les départements doivent
          être enregistrés dans l’organisation. Appliquez avant de sauvegarder.
        </p>
        <button onClick={() => setRaw(canonical(exportGraph(draft)))}>
          Charger le document à éditer
        </button>
        <label>
          Document du brouillon
          <textarea
            rows={14}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
          />
        </label>
        <button
          disabled={!raw}
          onClick={() => {
            try {
              const parsed = decode("GraphCreate-Output", parsePrecise(raw));
              setDraft(parsed);
              setError(undefined);
            } catch (reason) {
              setError(
                reason instanceof Error ? reason.message : "JSON invalide.",
              );
            }
          }}
        >
          Appliquer le JSON au brouillon
        </button>
      </details>
      <div className="notice">
        Si une capacité change, renseignez sa nouvelle version et un nouvel
        identifiant de snapshot. Les modèles et fragments existants ne sont pas
        réécrits.
      </div>
      <button
        className="primary"
        disabled={busy || !version.trim()}
        onClick={() => void save()}
      >
        {busy ? "Validation serveur…" : "Valider et enregistrer le brouillon"}
      </button>
    </section>
  );
}
