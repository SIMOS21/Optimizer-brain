import { useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps,
} from "@xyflow/react";
import type { GraphDocument } from "../../api/types";
import { JsonView } from "../../shared/ui";
import { project, type StudioNode } from "./projection";

function OrganizationNode({ data }: NodeProps<StudioNode>) {
  return (
    <div className={`studio-node ${data.kind}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="node-kicker">
        <span>{data.kind === "department" ? "DÉPARTEMENT" : "RESSOURCE"}</span>
        <span className="node-symbol">
          {data.kind === "department" ? "D" : "R"}
        </span>
      </div>
      <strong>{data.label}</strong>
      <small>{data.capacity || `Responsable · ${data.owner}`}</small>
      <span className="node-version">v{data.version}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
const nodeTypes = { studio: OrganizationNode };
type Selection = { kind: "node" | "edge"; id: string } | null;

export function GraphCanvas({ document }: { document: GraphDocument }) {
  const [nodes, setNodes] = useState(() => project(document).nodes);
  const [selection, setSelection] = useState<Selection>(null);
  function select(next: Selection) {
    setSelection((current) =>
      current?.kind === next?.kind && current?.id === next?.id ? current : next,
    );
  }
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [edges, setEdges] = useState(() => project(document).edges);
  const graph = document.graph;
  const filtered = nodes.map((node) => ({
    ...node,
    hidden:
      !`${node.data.label} ${node.id} ${node.data.owner}`
        .toLowerCase()
        .includes(search.toLowerCase()) ||
      (!!department &&
        node.id !== department &&
        !graph.resources.some(
          (resource) =>
            resource.id === node.id &&
            [resource.owner_department, ...resource.shared_with].includes(
              department,
            ),
        )),
  }));
  const visible = new Set(
    filtered.filter((node) => !node.hidden).map((node) => node.id),
  );
  const selectedNode =
    selection?.kind === "node"
      ? [...graph.departments, ...graph.resources].find(
          (node) => node.id === selection.id,
        )
      : undefined;
  const selectedEdge =
    selection?.kind === "edge"
      ? graph.edges.find((edge) => edge.id === selection.id)
      : undefined;
  return (
    <div className="graph-studio">
      <div className="graph-toolbar">
        <label>
          Rechercher
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nom, identifiant, propriétaire…"
          />
        </label>
        <label>
          Périmètre
          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">Tous les départements</option>
            {graph.departments.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
        </label>
        <span className="quiet">
          {visible.size}/{nodes.length} nœuds · {graph.edges.length} relations
          enregistrées
        </span>
      </div>
      <div className="canvas-and-inspector">
        <div
          className="canvas"
          aria-label="Graphe organisationnel interactif"
          data-testid="graph-canvas"
        >
          <ReactFlow<StudioNode>
            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
            nodes={filtered}
            edges={edges.filter(
              (edge) => visible.has(edge.source) && visible.has(edge.target),
            )}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) =>
              setNodes((current) => changes.applyTo(current))
            }
            onEdgesChange={(changes) =>
              setEdges((current) => changes.applyTo(current))
            }
            onNodeClick={(_, node) => select({ kind: "node", id: node.id })}
            onEdgeClick={(_, edge) => select({ kind: "edge", id: edge.id })}
            onSelectionChange={({ nodes: chosen, edges: chosenEdges }) =>
              select(
                chosen[0]
                  ? { kind: "node", id: chosen[0].id }
                  : chosenEdges[0]
                    ? { kind: "edge", id: chosenEdges[0].id }
                    : null,
              )
            }
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            nodesFocusable
            edgesFocusable
            ariaLabelConfig={{
              "controls.zoomIn.ariaLabel": "Agrandir",
              "controls.zoomOut.ariaLabel": "Réduire",
              "controls.fitView.ariaLabel": "Cadrer le graphe",
              "node.a11yDescription.default":
                "Entrée pour sélectionner ; flèches pour déplacer localement ; Échap pour désélectionner.",
              "edge.a11yDescription.default":
                "Entrée pour sélectionner cette relation informative.",
            }}
          >
            <Background gap={22} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              style={{ width: 110, height: 75 }}
              pannable
              zoomable
              nodeColor={(node) =>
                node.data.kind === "resource" ? "#b9ded3" : "#b8c8de"
              }
            />
          </ReactFlow>
        </div>
        <aside className="inspector">
          <span className="eyebrow">INSPECTEUR</span>
          {selectedNode ? (
            <>
              <h3>{selectedNode.name}</h3>
              <dl>
                <dt>Identifiant stable</dt>
                <dd>{selectedNode.id}</dd>
                <dt>Provenance</dt>
                <dd>{selectedNode.source}</dd>
                <dt>Version déclarée</dt>
                <dd>{selectedNode.version}</dd>
                {"capacity" in selectedNode ? (
                  <>
                    <dt>Propriétaire</dt>
                    <dd>{selectedNode.owner_department}</dd>
                    <dt>Partagée avec</dt>
                    <dd>
                      {selectedNode.shared_with.join(", ") ||
                        "Aucun autre département"}
                    </dd>
                    <dt>Capacité référencée</dt>
                    <dd>{selectedNode.capacity.parameter}</dd>
                    <dt>Valeur du paramètre</dt>
                    <dd>
                      {
                        document.shared_parameters[
                          selectedNode.capacity.parameter
                        ]?.value
                      }{" "}
                      {
                        document.shared_parameters[
                          selectedNode.capacity.parameter
                        ]?.unit
                      }
                    </dd>
                    <dt>Unité de ressource</dt>
                    <dd>{selectedNode.unit}</dd>
                    <dt>Version de capacité</dt>
                    <dd>{selectedNode.capacity_version}</dd>
                    <dt>Contrainte déclarée</dt>
                    <dd>
                      {selectedNode.constraint_id} — à consulter dans le modèle
                      compilé
                    </dd>
                  </>
                ) : (
                  <>
                    <dt>Responsable descriptif</dt>
                    <dd>{selectedNode.owner_id}</dd>
                  </>
                )}
              </dl>
              <JsonView
                title={`Provenance · graph.${"capacity" in selectedNode ? "resources" : "departments"}[${selectedNode.id}]`}
                value={selectedNode}
              />
            </>
          ) : selectedEdge ? (
            <>
              <h3>Relation informative</h3>
              <dl>
                <dt>Identifiant</dt>
                <dd>{selectedEdge.id}</dd>
                <dt>Type</dt>
                <dd>{selectedEdge.type}</dd>
                <dt>Source → cible</dt>
                <dd>
                  {selectedEdge.source_id} → {selectedEdge.target_id}
                </dd>
              </dl>
              <p>
                Aucune équation ni consommation n’est ajoutée par cette arête.
              </p>
            </>
          ) : (
            <>
              <h3>Explorez l’organisation</h3>
              <p>
                Sélectionnez un département, une ressource ou une relation pour
                consulter ses propriétés.
              </p>
              <p className="quiet">
                Navigation clavier : Tab, Entrée, Échap. Les déplacements
                restent locaux.
              </p>
            </>
          )}
        </aside>
      </div>
      <div className="graph-legend">
        <span>
          <i className="line dashed" /> DEPENDS_ON · dépendance informative
        </span>
        <span>
          <i className="line" /> USES_RESOURCE · relation déclarée
        </span>
        <span>
          Seuls les fragments et ResourceUse définissent les équations.
        </span>
      </div>
    </div>
  );
}
