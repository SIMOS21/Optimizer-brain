import type { Edge, Node } from "@xyflow/react";
import type { GraphDocument } from "../../api/types";

export type StudioNode = Node<
  {
    label: string;
    kind: "department" | "resource";
    owner: string;
    capacity?: string;
    source: string;
    version: string;
  },
  "studio"
>;
export function project(document: GraphDocument): {
  nodes: StudioNode[];
  edges: Edge[];
} {
  const graph = document.graph;
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const departments: StudioNode[] = [...graph.departments]
    .sort(byId)
    .map((node, index) => ({
      id: node.id,
      type: "studio",
      position: { x: 0, y: index * 160 },
      data: {
        label: node.name,
        kind: "department",
        owner: node.owner_id,
        source: node.source,
        version: node.version,
      },
      ariaLabel: `Département ${node.name}, ${node.id}`,
      deletable: false,
    }));
  const resources: StudioNode[] = [...graph.resources]
    .sort(byId)
    .map((node, index) => {
      const parameter = document.shared_parameters[node.capacity.parameter];
      return {
        id: node.id,
        type: "studio",
        position: { x: 420, y: index * 190 + 30 },
        data: {
          label: node.name,
          kind: "resource",
          owner: node.owner_department,
          source: node.source,
          version: node.version,
          capacity: parameter
            ? `${parameter.value} ${parameter.unit}`
            : "Paramètre absent",
        },
        ariaLabel: `Ressource ${node.name}, ${node.id}`,
        deletable: false,
      };
    });
  const edges: Edge[] = [...graph.edges].sort(byId).map((edge) => ({
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
    type: "smoothstep",
    label: edge.type === "DEPENDS_ON" ? "Dépendance" : "Utilise la ressource",
    data: { relation: edge.type },
    style: {
      stroke: edge.type === "DEPENDS_ON" ? "#78879c" : "#247568",
      strokeDasharray: edge.type === "DEPENDS_ON" ? "6 5" : undefined,
      strokeWidth: 1.8,
    },
    ariaLabel: `${edge.type} : ${edge.source_id} vers ${edge.target_id}`,
    deletable: false,
    reconnectable: false,
  }));
  return { nodes: [...departments, ...resources], edges };
}
export function exportGraph(document: GraphDocument): GraphDocument {
  const copy = structuredClone(document);
  for (const field of ["departments", "resources", "edges"] as const)
    copy.graph[field].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  copy.graph.resources.forEach((resource) => resource.shared_with.sort());
  return copy;
}
