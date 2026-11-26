import type { GraphDocument } from "../../api/types";
import type { StudioNode } from "./projection";

export type GraphSelection = { kind: "node" | "edge"; id: string } | null;
export const relationLabels = {
  DEPENDS_ON: "Dépendance déclarée",
  USES_RESOURCE: "Utilisation déclarée de ressource",
} as const;

export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr")
    .trim();
}

/** A visual perimeter only: ownership/sharing never creates an edge. */
export function visibleNodeIds(
  document: GraphDocument,
  nodes: StudioNode[],
  search: string,
  department: string,
) {
  const scope = new Set<string>([department]);
  if (department) {
    for (const resource of document.graph.resources) {
      if (
        [resource.owner_department, ...resource.shared_with].includes(
          department,
        )
      )
        scope.add(resource.id);
    }
    for (const edge of document.graph.edges) {
      if (edge.source_id === department) scope.add(edge.target_id);
      if (edge.target_id === department) scope.add(edge.source_id);
    }
  }
  const query = normalizeSearch(search);
  return new Set(
    nodes
      .filter(
        (node) =>
          (!department || scope.has(node.id)) &&
          normalizeSearch(
            `${node.data.label} ${node.id} ${node.data.owner} ${node.data.ownerLabel}`,
          ).includes(query),
      )
      .map((node) => node.id),
  );
}

/** Highlight only actual incident relations, with separate node/edge namespaces. */
export function relatedElements(
  document: GraphDocument,
  selection: GraphSelection,
) {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (!selection) return { nodes, edges };
  if (selection.kind === "node") nodes.add(selection.id);
  for (const edge of document.graph.edges) {
    if (
      selection.kind === "edge"
        ? edge.id === selection.id
        : edge.source_id === selection.id || edge.target_id === selection.id
    ) {
      edges.add(edge.id);
      nodes.add(edge.source_id);
      nodes.add(edge.target_id);
    }
  }
  return { nodes, edges };
}
