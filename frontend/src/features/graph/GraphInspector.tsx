import { useId, type RefObject } from "react";
import type { GraphDocument } from "../../api/types";
import type { PresentationMode } from "../../shared/presentation/context";
import { JsonView } from "../../shared/ui";
import { relationLabels, type GraphSelection } from "./map-view";

export function GraphInspector({
  document,
  selection,
  mode,
  onSelect,
  onClose,
  headingRef,
}: {
  document: GraphDocument;
  selection: GraphSelection;
  mode: PresentationMode;
  onSelect: (selection: NonNullable<GraphSelection>) => void;
  onClose: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const headingId = useId();
  const graph = document.graph;
  const allNodes = [...graph.departments, ...graph.resources];
  const node =
    selection?.kind === "node"
      ? allNodes.find((item) => item.id === selection.id)
      : undefined;
  const edge =
    selection?.kind === "edge"
      ? graph.edges.find((item) => item.id === selection.id)
      : undefined;
  const name = (id: string) =>
    allNodes.find((item) => item.id === id)?.name || id;
  const resource = node && "capacity" in node ? node : undefined;
  const parameter = resource
    ? document.shared_parameters[resource.capacity.parameter]
    : undefined;
  const incident = node
    ? graph.edges.filter(
        (item) => item.source_id === node.id || item.target_id === node.id,
      )
    : [];
  const owned =
    node && !resource
      ? graph.resources.filter(
          (item) =>
            item.owner_department === node.id ||
            item.shared_with.includes(node.id),
        )
      : [];
  return (
    <aside className="inspector map-inspector" aria-labelledby={headingId}>
      <div className="map-inspector-heading">
        <span className="eyebrow">FICHE DE L’ÉLÉMENT</span>
        {selection && (
          <button type="button" onClick={onClose} aria-label="Fermer la fiche">
            Fermer ×
          </button>
        )}
      </div>
      <h3 id={headingId} tabIndex={-1} ref={headingRef}>
        {node?.name ||
          (edge ? "Relation informative" : "Explorez l’organisation")}
      </h3>
      {node ? (
        <>
          <p className="map-category">
            {resource ? "Ressource déclarée" : "Département"}
          </p>
          <dl>
            {resource ? (
              <>
                <dt>Capacité déclarée</dt>
                <dd data-testid="map-declared-capacity">
                  {parameter?.value ?? "Non fournie"}{" "}
                  {parameter?.unit || "Unité non fournie"}
                </dd>
                <dt>Département propriétaire</dt>
                <dd>
                  <button
                    type="button"
                    className="map-text-action"
                    onClick={() =>
                      onSelect({ kind: "node", id: resource.owner_department })
                    }
                  >
                    {name(resource.owner_department)}
                  </button>
                </dd>
                <dt>Partagée avec</dt>
                <dd>
                  {resource.shared_with.length
                    ? resource.shared_with.map(name).join(", ")
                    : "Aucun autre département déclaré"}
                </dd>
                <dt>Nature de la valeur</dt>
                <dd>
                  Capacité du snapshot sélectionné, sans consommation calculée.
                </dd>
              </>
            ) : (
              <>
                <dt>Responsable déclaré</dt>
                <dd>
                  {"owner_id" in node
                    ? node.owner_id || "Non renseigné"
                    : "Non renseigné"}
                </dd>
                <dt>Déclaration</dt>
                <dd>
                  Identité descriptive du snapshot ; elle ne confère aucun droit
                  d’accès.
                </dd>
              </>
            )}
            {mode === "expert" && (
              <>
                <dt>Identifiant stable</dt>
                <dd>{node.id}</dd>
                <dt>Provenance</dt>
                <dd>{node.source}</dd>
                <dt>Version déclarée</dt>
                <dd>{node.version}</dd>
                {resource && (
                  <>
                    <dt>Propriétaire</dt>
                    <dd>{resource.owner_department}</dd>
                    <dt>Capacité référencée</dt>
                    <dd>{resource.capacity.parameter}</dd>
                    <dt>Valeur du paramètre</dt>
                    <dd>
                      {parameter?.value ?? "Non fournie"} {parameter?.unit}
                    </dd>
                    <dt>Provenance du paramètre</dt>
                    <dd>{parameter?.source || "Non fournie"}</dd>
                    <dt>Version du paramètre</dt>
                    <dd>{parameter?.version || "Non fournie"}</dd>
                    <dt>Unité de ressource</dt>
                    <dd>{resource.unit}</dd>
                    <dt>Version de capacité</dt>
                    <dd>{resource.capacity_version}</dd>
                    <dt>Contrainte déclarée</dt>
                    <dd>
                      {resource.constraint_id} — à consulter dans le modèle
                      compilé
                    </dd>
                  </>
                )}
              </>
            )}
          </dl>
          {owned.length > 0 && (
            <section>
              <h4>Ressources détenues ou partagées</h4>
              <ul className="map-inspector-links">
                {owned.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: "node", id: item.id })}
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h4>Relations enregistrées</h4>
            {incident.length ? (
              <ul className="map-inspector-links">
                {incident.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect({ kind: "edge", id: item.id })}
                    >
                      {name(item.source_id)} → {name(item.target_id)}
                      <small>
                        {mode === "expert"
                          ? item.type
                          : relationLabels[item.type]}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Aucune relation enregistrée pour cet élément.</p>
            )}
          </section>
          {mode === "expert" && (
            <JsonView
              title={`Provenance · graph.${resource ? "resources" : "departments"}[${node.id}]`}
              value={node}
            />
          )}
        </>
      ) : edge ? (
        <>
          <p>{relationLabels[edge.type]}</p>
          <dl>
            <dt>Source → cible</dt>
            <dd>
              {name(edge.source_id)} → {name(edge.target_id)}
            </dd>
            {mode === "expert" && (
              <>
                <dt>Identifiant</dt>
                <dd>{edge.id}</dd>
                <dt>Type</dt>
                <dd>{edge.type}</dd>
                <dt>Identifiants source → cible</dt>
                <dd>
                  {edge.source_id} → {edge.target_id}
                </dd>
                <dt>Version du graphe</dt>
                <dd>{graph.organization.version}</dd>
                <dt>Provenance du graphe</dt>
                <dd>{graph.organization.source}</dd>
              </>
            )}
          </dl>
          <p>Aucune équation ni consommation n’est ajoutée par cette arête.</p>
          <div className="actions">
            <button
              type="button"
              onClick={() => onSelect({ kind: "node", id: edge.source_id })}
            >
              Voir la source
            </button>
            <button
              type="button"
              onClick={() => onSelect({ kind: "node", id: edge.target_id })}
            >
              Voir la cible
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Sélectionnez un département, une ressource ou une relation pour
            consulter sa fiche.
          </p>
          <p>
            Les capacités viennent du snapshot enregistré. Aucune consommation
            ni résultat d’optimisation n’est déduit de cette carte.
          </p>
          <p className="quiet">
            Clavier : Tab puis Entrée. Échap ferme la fiche. La liste des
            éléments permet également de parcourir la carte.
          </p>
        </>
      )}
    </aside>
  );
}
