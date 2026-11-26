import { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { GraphDocument } from "../../api/types";
import { canonical } from "../../api/validation";
import { EmptyState } from "../../shared/design-system";
import type { PresentationMode } from "../../shared/presentation/context";
import { GraphInspector } from "./GraphInspector";
import { OrganizationNode } from "./GraphNode";
import { GraphModeContext } from "./graph-view-context";
import {
  relatedElements,
  relationLabels,
  visibleNodeIds,
  type GraphSelection,
} from "./map-view";
import { project, type StudioNode } from "./projection";
import "../../styles/organization-map.css";

// Never construct renderer registries/options in the component render path.
const nodeTypes = { studio: OrganizationNode };
const edgeOptions = { markerEnd: { type: MarkerType.ArrowClosed } };
const fitOptions = { padding: 0.2, maxZoom: 1 };
const miniMapStyle = { width: 110, height: 75 };
const miniMapColor = (node: StudioNode) =>
  node.data.kind === "resource" ? "#b9ded3" : "#b8c8de";

export function GraphCanvas({
  document,
  mode = "business",
}: {
  document: GraphDocument;
  mode?: PresentationMode;
}) {
  // One projection per immutable document. Canonical content is a UI session
  // key, not a mathematical hash/certificate. Changes reset all local state.
  const initial = useMemo(
    () => ({ ...project(document), identity: canonical(document) }),
    [document],
  );
  return (
    <GraphSession
      key={initial.identity}
      document={document}
      initial={initial}
      mode={mode}
    />
  );
}

function GraphSession({
  document,
  initial,
  mode,
}: {
  document: GraphDocument;
  initial: ReturnType<typeof project>;
  mode: PresentationMode;
}) {
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [flow, setFlow] = useState<ReactFlowInstance<StudioNode> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const graph = document.graph;

  const rememberFocus = useCallback(() => {
    const active = window.document.activeElement;
    const element = active?.closest(
      ".react-flow__node, .react-flow__edge, .map-element-list button",
    );
    if (element instanceof HTMLElement) lastFocus.current = element;
  }, []);
  const updateSelection = useCallback((next: GraphSelection) => {
    setSelection((current) =>
      current?.kind === next?.kind && current?.id === next?.id ? current : next,
    );
  }, []);
  const choose = useCallback(
    (next: GraphSelection) => {
      if (next) rememberFocus();
      updateSelection(next);
      setNodes((current) =>
        current.map((node) => {
          const selected = next?.kind === "node" && next.id === node.id;
          return !!node.selected === selected ? node : { ...node, selected };
        }),
      );
      setEdges((current) =>
        current.map((edge) => {
          const selected = next?.kind === "edge" && next.id === edge.id;
          return !!edge.selected === selected ? edge : { ...edge, selected };
        }),
      );
    },
    [rememberFocus, updateSelection],
  );
  const onNodesChange = useCallback<OnNodesChange<StudioNode>>(
    (changes) => setNodes((current) => changes.applyTo(current)),
    [],
  );
  const onEdgesChange = useCallback<OnEdgesChange>(
    (changes) => setEdges((current) => changes.applyTo(current)),
    [],
  );
  const onSelectionChange = useCallback(
    ({
      nodes: chosen,
      edges: chosenEdges,
    }: {
      nodes: StudioNode[];
      edges: Edge[];
    }) => {
      const next: GraphSelection = chosen[0]
        ? { kind: "node", id: chosen[0].id }
        : chosenEdges[0]
          ? { kind: "edge", id: chosenEdges[0].id }
          : null;
      if (next) rememberFocus();
      updateSelection(next);
    },
    [rememberFocus, updateSelection],
  );

  const visible = useMemo(
    () => visibleNodeIds(document, nodes, search, department),
    [document, nodes, search, department],
  );
  const related = useMemo(
    () => relatedElements(document, selection),
    [document, selection],
  );
  const names = useMemo(
    () =>
      new Map(
        [...graph.departments, ...graph.resources].map((node) => [
          node.id,
          node.name,
        ]),
      ),
    [graph],
  );
  const displayedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        hidden: !visible.has(node.id),
        className: selection
          ? related.nodes.has(node.id)
            ? "map-related"
            : "map-muted"
          : "",
        ariaLabel:
          mode === "expert"
            ? node.ariaLabel
            : `${node.data.kind === "department" ? "Département" : "Ressource"} ${node.data.label}`,
      })),
    [nodes, visible, selection, related, mode],
  );
  const displayedEdges = useMemo(
    () =>
      edges
        .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
        .map((edge) => {
          const relation =
            edge.data?.relation === "DEPENDS_ON"
              ? "DEPENDS_ON"
              : "USES_RESOURCE";
          return {
            ...edge,
            label: mode === "expert" ? relation : relationLabels[relation],
            ariaLabel:
              mode === "expert"
                ? edge.ariaLabel
                : `${relationLabels[relation]} : ${names.get(edge.source) || edge.source} vers ${names.get(edge.target) || edge.target}`,
            className: selection
              ? related.edges.has(edge.id)
                ? "map-related"
                : "map-muted"
              : "",
            style: selection
              ? {
                  ...edge.style,
                  strokeWidth: related.edges.has(edge.id) ? 3.2 : 1.5,
                  opacity: related.edges.has(edge.id) ? 1 : 0.25,
                }
              : edge.style,
          };
        }),
    [edges, visible, selection, related, mode, names],
  );
  const visibleNodes = displayedNodes.filter((node) => !node.hidden);
  const selectedLabel = selection
    ? selection.kind === "node"
      ? names.get(selection.id)
      : "Relation informative"
    : undefined;
  function clearFilters() {
    setSearch("");
    setDepartment("");
    choose(null);
  }
  function closeInspector() {
    choose(null);
    if (lastFocus.current?.isConnected)
      lastFocus.current.focus({ preventScroll: true });
    else canvasRef.current?.focus({ preventScroll: true });
  }
  function inspect() {
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView?.({
      block: "nearest",
      behavior: "instant",
    });
  }
  function reveal(next: NonNullable<GraphSelection>) {
    const edge =
      next.kind === "edge"
        ? graph.edges.find((item) => item.id === next.id)
        : undefined;
    const ids =
      next.kind === "node"
        ? [next.id]
        : edge
          ? [edge.source_id, edge.target_id]
          : [];
    if (ids.some((id) => !visible.has(id))) {
      setSearch("");
      setDepartment("");
    }
    choose(next);
    const targets = nodes.filter((item) => ids.includes(item.id));
    if (targets.length)
      void flow?.fitView({
        nodes: targets,
        includeHiddenNodes: true,
        padding: 0.5,
        minZoom: 0.02,
        maxZoom: 1,
        duration: 0,
      });
  }
  return (
    <GraphModeContext.Provider value={mode}>
      <section
        className="graph-studio organization-map"
        aria-label="Carte organisationnelle"
        onKeyDown={(event) => {
          if (event.key === "Escape" && selection) {
            event.stopPropagation();
            closeInspector();
          }
        }}
      >
        <div className="map-introduction">
          <strong>Départements, ressources et liens déclarés</strong>
          <p>
            Explorez ce snapshot. Les relations décrivent l’organisation ; les
            équations appartiennent au modèle compilé.
          </p>
        </div>
        <div className="graph-toolbar">
          <label>
            Rechercher
            <input
              aria-label="Rechercher dans la carte"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                choose(null);
              }}
              placeholder="Nom, ressource, responsable…"
            />
          </label>
          <label>
            Périmètre
            <select
              aria-label="Périmètre"
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value);
                choose(null);
              }}
            >
              <option value="">Tous les départements</option>
              {graph.departments.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!search && !department}
          >
            Effacer les filtres
          </button>
        </div>
        <div className="map-status" role="status">
          <span>
            {visible.size}/{nodes.length} éléments · {displayedEdges.length}/
            {graph.edges.length} relations affichées
          </span>
          <span>
            {selectedLabel
              ? `Sélection : ${selectedLabel}`
              : "Sélectionnez un élément pour afficher sa fiche."}
          </span>
          {selection && (
            <button type="button" onClick={inspect}>
              Consulter la fiche
            </button>
          )}
        </div>
        <div className="canvas-and-inspector">
          <div
            className="canvas"
            aria-label="Graphe organisationnel interactif"
            data-testid="graph-canvas"
            ref={canvasRef}
            tabIndex={-1}
          >
            {visible.size ? (
              <ReactFlow<StudioNode>
                defaultEdgeOptions={edgeOptions}
                nodes={displayedNodes}
                edges={displayedEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => choose({ kind: "node", id: node.id })}
                onEdgeClick={(_, edge) => choose({ kind: "edge", id: edge.id })}
                onSelectionChange={onSelectionChange}
                onPaneClick={() => choose(null)}
                onInit={setFlow}
                fitView
                fitViewOptions={fitOptions}
                minZoom={0.02}
                maxZoom={2}
                nodesConnectable={false}
                edgesReconnectable={false}
                deleteKeyCode={null}
                nodesFocusable
                edgesFocusable
                ariaLabelConfig={{
                  "controls.zoomIn.ariaLabel": "Agrandir",
                  "controls.zoomOut.ariaLabel": "Réduire",
                  "controls.fitView.ariaLabel": "Ajuster la vue",
                  "node.a11yDescription.default":
                    "Entrée pour sélectionner ; flèches pour déplacer localement ; Échap pour fermer la fiche.",
                  "edge.a11yDescription.default":
                    "Entrée pour sélectionner cette relation informative.",
                }}
              >
                <Background gap={22} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                  style={miniMapStyle}
                  pannable
                  zoomable
                  nodeColor={miniMapColor}
                />
              </ReactFlow>
            ) : (
              <EmptyState
                title="Aucun élément dans ce périmètre"
                action={
                  <button type="button" onClick={clearFilters}>
                    Afficher toute la carte
                  </button>
                }
              >
                Changez la recherche ou le département. Aucun élément du
                snapshot n’a été supprimé.
              </EmptyState>
            )}
          </div>
          <GraphInspector
            document={document}
            selection={selection}
            mode={mode}
            onSelect={reveal}
            onClose={closeInspector}
            headingRef={headingRef}
          />
        </div>
        <details className="map-element-list">
          <summary>Parcourir les éléments ({visible.size})</summary>
          <ul>
            {visibleNodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  aria-pressed={
                    selection?.kind === "node" && selection.id === node.id
                  }
                  onClick={() => reveal({ kind: "node", id: node.id })}
                >
                  <span>
                    {node.data.kind === "department"
                      ? "Département"
                      : "Ressource"}
                  </span>
                  <strong>{node.data.label}</strong>
                  {node.data.capacity && (
                    <small>Capacité déclarée : {node.data.capacity}</small>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <div className="graph-legend">
          <span>
            <i className="line dashed" />
            {mode === "expert" ? "DEPENDS_ON · " : ""}Dépendance déclarée
          </span>
          <span>
            <i className="line" />
            {mode === "expert" ? "USES_RESOURCE · " : ""}Utilisation déclarée de
            ressource
          </span>
          <span>
            Seules les relations enregistrées sont dessinées. Aucun calcul de
            consommation.
          </span>
        </div>
      </section>
    </GraphModeContext.Provider>
  );
}
