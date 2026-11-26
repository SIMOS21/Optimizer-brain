import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphCanvas } from "../src/features/graph/GraphCanvas";
import { decode, canonical } from "../src/api/validation";
import {
  relatedElements,
  visibleNodeIds,
} from "../src/features/graph/map-view";
import * as projection from "../src/features/graph/projection";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";

afterEach(() => vi.restoreAllMocks());

describe.each([
  ["factory", factory],
  ["university", university],
] as const)("%s organization map", (_, fixture) => {
  it("shows recorded names, declared capacity and owning department in business mode", async () => {
    const doc = decode("GraphArtifactResponse", fixture.graph).document;
    const original = canonical(doc);
    const { container } = render(<GraphCanvas document={doc} />);
    const resource = doc.graph.resources[0]!;
    fireEvent.click(
      container.querySelector(`.react-flow__node[data-id="${resource.id}"]`)!,
    );
    const inspector = within(
      container.querySelector(".inspector") as HTMLElement,
    );
    expect(
      inspector.getByRole("heading", { name: resource.name }),
    ).toBeInTheDocument();
    const parameter = doc.shared_parameters[resource.capacity.parameter]!;
    expect(screen.getByTestId("map-declared-capacity")).toHaveTextContent(
      `${parameter.value} ${parameter.unit}`,
    );
    expect(
      inspector.getByRole("button", {
        name: doc.graph.departments.find(
          (d) => d.id === resource.owner_department,
        )!.name,
      }),
    ).toBeInTheDocument();
    expect(inspector.queryByText("Identifiant stable")).not.toBeInTheDocument();
    expect(
      inspector.getByText(/sans consommation calculée/),
    ).toBeInTheDocument();
    expect(canonical(doc)).toBe(original);
  });
  it("highlights only stored incident edges and preserves exact relation types in expert mode", async () => {
    const doc = decode("GraphArtifactResponse", fixture.graph).document;
    const { container } = render(<GraphCanvas document={doc} mode="expert" />);
    await waitFor(() =>
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(
        doc.graph.edges.length,
      ),
    );
    const node = doc.graph.departments[0]!;
    fireEvent.click(
      container.querySelector(`.react-flow__node[data-id="${node.id}"]`)!,
    );
    const incident = doc.graph.edges.filter(
      (e) => e.source_id === node.id || e.target_id === node.id,
    );
    expect(
      Array.from(container.querySelectorAll(".react-flow__edge.map-related"))
        .map((e) => e.getAttribute("data-id"))
        .sort(),
    ).toEqual(incident.map((e) => e.id).sort());
    const edge = doc.graph.edges[0]!;
    fireEvent.click(
      container.querySelector(`.react-flow__edge[data-id="${edge.id}"]`)!,
    );
    const inspector = within(
      container.querySelector(".inspector") as HTMLElement,
    );
    expect(
      inspector.getByText("Type", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent(edge.type);
    expect(
      inspector.getByText(/Aucune équation ni consommation/),
    ).toBeInTheDocument();
    expect(
      inspector.getByText("Identifiant", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent(edge.id);
  });
});

it("keeps projection and canonical identity stable during selection, search and mode changes", async () => {
  const doc = decode("GraphArtifactResponse", factory.graph).document;
  const project = vi.spyOn(projection, "project");
  const { container, rerender } = render(<GraphCanvas document={doc} />);
  await waitFor(() =>
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(7),
  );
  expect(project).toHaveBeenCalledTimes(1);
  fireEvent.click(container.querySelector(".react-flow__node")!);
  fireEvent.change(screen.getByLabelText("Rechercher dans la carte"), {
    target: { value: "finance" },
  });
  rerender(<GraphCanvas document={doc} mode="expert" />);
  expect(project).toHaveBeenCalledTimes(1);
});

it("resets selection, filters and local positions when snapshot content changes", async () => {
  const doc = decode("GraphArtifactResponse", factory.graph).document;
  const { container, rerender } = render(<GraphCanvas document={doc} />);
  fireEvent.click(container.querySelector(".react-flow__node")!);
  fireEvent.change(screen.getByLabelText("Rechercher dans la carte"), {
    target: { value: "finance" },
  });
  const next = structuredClone(doc);
  next.graph.organization.data_snapshot_id = "new_snapshot";
  next.graph.departments[0]!.name = "Nom de la nouvelle version";
  rerender(<GraphCanvas document={next} />);
  expect(screen.getByLabelText("Rechercher dans la carte")).toHaveValue("");
  expect(
    screen.getByRole("heading", { name: "Explorez l’organisation" }),
  ).toBeInTheDocument();
  expect(container.querySelectorAll(".react-flow__node")).toHaveLength(7);
  expect(container.querySelector(".react-flow__node")!).toHaveTextContent(
    "Nom de la nouvelle version",
  );
});

it("preserves exact decimal strings and descriptive responsibility without invented users", () => {
  const doc = decode("GraphArtifactResponse", factory.graph).document;
  const resource = doc.graph.resources[0]!;
  doc.shared_parameters[resource.capacity.parameter]!.value =
    "0.12345678901234567890123456789";
  const { container } = render(<GraphCanvas document={doc} />);
  fireEvent.click(
    container.querySelector(`.react-flow__node[data-id="${resource.id}"]`)!,
  );
  expect(screen.getByTestId("map-declared-capacity")).toHaveTextContent(
    "0.12345678901234567890123456789",
  );
  const department = doc.graph.departments[0]!;
  fireEvent.click(
    container.querySelector(`.react-flow__node[data-id="${department.id}"]`)!,
  );
  expect(
    screen.getByText("Responsable déclaré", { selector: "dt" })
      .nextElementSibling,
  ).toHaveTextContent(department.owner_id);
  expect(screen.queryByText("Administrateur")).not.toBeInTheDocument();
});

it("provides an explicit no-results state and restores all stored elements", () => {
  const doc = decode("GraphArtifactResponse", factory.graph).document;
  const { container } = render(<GraphCanvas document={doc} />);
  fireEvent.change(screen.getByLabelText("Rechercher dans la carte"), {
    target: { value: "absent_synthetic" },
  });
  expect(
    screen.getByRole("heading", { name: "Aucun élément dans ce périmètre" }),
  ).toBeInTheDocument();
  expect(container.querySelectorAll(".react-flow__node")).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Afficher toute la carte" }),
  );
  expect(container.querySelectorAll(".react-flow__node")).toHaveLength(7);
});

it("reveals both endpoints when inspecting a relation outside the search perimeter", async () => {
  const doc = decode("GraphArtifactResponse", factory.graph).document;
  const edge = doc.graph.edges.find((item) => item.type === "DEPENDS_ON")!;
  const target = doc.graph.departments.find(
    (node) => node.id === edge.target_id,
  )!;
  const source = doc.graph.departments.find(
    (node) => node.id === edge.source_id,
  )!;
  const { container } = render(<GraphCanvas document={doc} />);
  fireEvent.change(screen.getByLabelText("Rechercher dans la carte"), {
    target: { value: target.name },
  });
  fireEvent.click(
    container.querySelector(`.react-flow__node[data-id="${target.id}"]`)!,
  );
  fireEvent.click(
    within(container.querySelector(".inspector") as HTMLElement).getByRole(
      "button",
      { name: new RegExp(`${source.name} → ${target.name}`) },
    ),
  );
  expect(screen.getByLabelText("Rechercher dans la carte")).toHaveValue("");
  await waitFor(() =>
    expect(
      container.querySelector(`.react-flow__edge[data-id="${edge.id}"]`),
    ).toBeInTheDocument(),
  );
});

it("has separate dependency/use semantics, French search and an honest visual department perimeter", () => {
  const doc = decode("GraphArtifactResponse", factory.graph).document;
  const graph = doc.graph;
  const department = graph.departments[0]!;
  department.name = "Équipe synthétique";
  const projected = projection.project(doc);
  expect(visibleNodeIds(doc, projected.nodes, "equipe", "")).toEqual(
    new Set([
      department.id,
      ...graph.resources
        .filter((r) => r.owner_department === department.id)
        .map((r) => r.id),
    ]),
  );
  const view = visibleNodeIds(doc, projected.nodes, "", department.id);
  for (const resource of graph.resources.filter(
    (r) =>
      r.owner_department === department.id ||
      r.shared_with.includes(department.id),
  ))
    expect(view.has(resource.id)).toBe(true);
  expect(new Set(projected.edges.map((e) => e.data?.relation))).toEqual(
    new Set(graph.edges.map((e) => e.type)),
  );
  const noEdges = { ...doc, graph: { ...graph, edges: [] } };
  expect(projection.project(noEdges).edges).toEqual([]);
  expect(
    relatedElements(noEdges, { kind: "node", id: department.id }).edges.size,
  ).toBe(0);
});

it("allows keyboard inspection and closes the panel without modifying the snapshot", async () => {
  const doc = decode("GraphArtifactResponse", university.graph).document;
  const { container } = render(<GraphCanvas document={doc} />);
  const node = container.querySelector(".react-flow__node") as HTMLElement;
  node.focus();
  fireEvent.keyDown(node, { key: "Enter" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Fermer la fiche" }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Consulter la fiche" }));
  expect(container.querySelector(".inspector h3")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Fermer la fiche" }));
  expect(
    screen.getByRole("heading", { name: "Explorez l’organisation" }),
  ).toBeInTheDocument();
  expect(node).toHaveFocus();
});
