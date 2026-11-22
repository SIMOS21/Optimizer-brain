import { describe, expect, it } from "vitest";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";
import { canonical, decode, parsePrecise } from "../src/api/validation";
import { exportGraph, project } from "../src/features/graph/projection";
import { prepareDraft } from "../src/features/graph/draft";
import { compareMetadata } from "../src/features/models/comparison";

describe.each([
  ["factory", factory],
  ["university", university],
] as const)("%s API → graph", (_, fixture) => {
  it("uses exactly the canonical identifiers and edges, with actual capacity units", () => {
    const record = decode("GraphArtifactResponse", fixture.graph);
    const { graph } = record.document;
    const projected = project(record.document);
    expect(projected.nodes.map((node) => node.id).sort()).toEqual(
      [...graph.departments, ...graph.resources].map((node) => node.id).sort(),
    );
    expect(
      projected.edges.map((edge) => [edge.id, edge.source, edge.target]).sort(),
    ).toEqual(
      graph.edges
        .map((edge) => [edge.id, edge.source_id, edge.target_id])
        .sort(),
    );
    for (const resource of graph.resources) {
      const parameter =
        record.document.shared_parameters[resource.capacity.parameter];
      expect(
        projected.nodes.find((node) => node.id === resource.id)?.data.capacity,
      ).toBe(`${parameter?.value} ${parameter?.unit}`);
    }
    expect(canonical(exportGraph(record.document))).toBe(
      canonical(
        exportGraph({
          ...record.document,
          graph: {
            ...graph,
            departments: [...graph.departments].reverse(),
            resources: [...graph.resources].reverse(),
            edges: [...graph.edges].reverse(),
          },
        }),
      ),
    );
  });
  it("never derives an edge from ownership, sharing or mathematical resource use", () => {
    const record = decode("GraphArtifactResponse", fixture.graph);
    record.document.graph.edges = [];
    expect(project(record.document).edges).toEqual([]);
  });
  it("validates stored model and run documents against the server schema", () => {
    const model = decode("ModelArtifactResponse", fixture.model);
    const run = decode("RunArtifactResponse", fixture.run);
    expect(
      model.document.dsl.constraints.every((row) => row.kind === "HARD"),
    ).toBe(true);
    expect(run.document.report.has_verified_plan).toBe(true);
    expect(run.document.solve.objective_value).toBe(
      fixture.run.document.solve.objective_value,
    );
  });
});
it("preserves arbitrary decimal and integral tokens rather than silently rounding", () => {
  expect(
    parsePrecise(
      '{"a":123456789012345678901,"b":0.1234567890123456789,"priority":1}',
    ),
  ).toEqual({
    a: "123456789012345678901",
    b: "0.1234567890123456789",
    priority: 1,
  });
  expect(() => parsePrecise('{"a":1,"a":2}')).toThrow();
  expect(() => parsePrecise('{"a":NaN}')).toThrow();
});
it("requires an explicit new version, parameter versions and snapshot for changed data", () => {
  const record = decode("GraphArtifactResponse", factory.graph);
  const before = canonical(record.document);
  expect(() =>
    prepareDraft(record, record.document, record.version || ""),
  ).toThrow();
  const changed = structuredClone(record.document);
  const key = Object.keys(changed.shared_parameters)[0]!;
  const parameter = changed.shared_parameters[key]!;
  parameter.value = "123.456789012345678901";
  expect(() => prepareDraft(record, changed, "new")).toThrow("snapshot");
  changed.graph.organization.data_snapshot_id = "new_data";
  expect(() => prepareDraft(record, changed, "new")).toThrow(
    "nouvelle version",
  );
  parameter.version = "new";
  changed.graph.resources
    .filter((resource) => resource.capacity.parameter === key)
    .forEach((resource) => {
      resource.capacity_version = "new";
      resource.version = "new";
    });
  expect(
    prepareDraft(record, changed, "new").shared_parameters[key]?.value,
  ).toBe(parameter.value);
  expect(canonical(record.document)).toBe(before);
});
it("local positioning cannot mutate the exported mathematical snapshot", () => {
  const graph = decode("GraphArtifactResponse", factory.graph).document;
  const before = canonical(exportGraph(graph));
  const projected = project(graph);
  projected.nodes[0]!.position.x += 200;
  expect(canonical(exportGraph(graph))).toBe(before);
  expect(canonical(exportGraph(graph))).not.toContain("position");
});
it("compares metadata and parameters without calculating scenarios or gains", () => {
  const composition = decode("ModelArtifactResponse", factory.model).document;
  const changed = structuredClone(composition);
  changed.organization_model.model_version = "copy";
  expect(compareMetadata(composition, changed)).toEqual([
    {
      path: "model_version",
      before: composition.organization_model.model_version,
      after: "copy",
    },
  ]);
});
