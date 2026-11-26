import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";
import { decode } from "../src/api/validation";
import { ApiClient } from "../src/api/client";
import { GraphCanvas } from "../src/features/graph/GraphCanvas";
import { GraphEditor } from "../src/features/graph/GraphEditor";
import { ModelInspector } from "../src/features/models/ModelInspector";
import { History } from "../src/features/history/History";
import { ArtifactImport } from "../src/features/organizations/ArtifactImport";

describe.each([
  ["factory", factory],
  ["university", university],
] as const)("%s components", (_, fixture) => {
  it("renders only recorded graph edges and exposes provenance via selection", async () => {
    const record = decode("GraphArtifactResponse", fixture.graph);
    const { container } = render(
      <GraphCanvas document={record.document} mode="expert" />,
    );
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(
      record.document.graph.departments.length +
        record.document.graph.resources.length,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(
        record.document.graph.edges.length,
      ),
    );
    const node = record.document.graph.resources[0]!;
    fireEvent.click(
      container.querySelector(`.react-flow__node[data-id="${node.id}"]`)!,
    );
    expect(
      screen.getByText("Provenance", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent(node.source);
    expect(
      screen.getByText(node.capacity.parameter, { selector: "dd" }),
    ).toBeInTheDocument();
  });
  it("shows the real HARD constraints, units, variables and source traces", () => {
    const record = decode("ModelArtifactResponse", fixture.model);
    render(<ModelInspector document={record.document} />);
    expect(
      screen.getByText(
        "Contraintes compilées · " + record.document.dsl.constraints.length,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(record.document.dsl.variables[0]!.id).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("IR originale enregistrée")).toBeInTheDocument();
  });
});

it("imports a structured draft while preserving precise decimal tokens in the request", async () => {
  const client = new ApiClient();
  const record = decode("GraphArtifactResponse", factory.graph);
  const send = vi.spyOn(client, "request").mockResolvedValue(record);
  const saved = vi.fn();
  render(
    <ArtifactImport
      client={client}
      organization={decode("OrganizationResponse", factory.organization)}
      kind="graphs"
      onSaved={saved}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Importer un graphe JSON" }),
  );
  const document = structuredClone(record.document);
  const key = Object.keys(document.shared_parameters)[0]!;
  document.shared_parameters[key]!.value = "__precise__";
  const raw = JSON.stringify(document).replace(
    '"__precise__"',
    "8000.1234567890123456789",
  );
  fireEvent.change(screen.getByLabelText("Document JSON à importer"), {
    target: { value: raw },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Valider et enregistrer l’import" }),
  );
  const body = decode("GraphCreate-Input", send.mock.calls[0]?.[3]);
  expect(body.shared_parameters[key]?.value).toBe("8000.1234567890123456789");
  expect(saved).toHaveBeenCalledWith(record.id);
});
it("rejects imported executable or malformed content before any API write", async () => {
  const client = new ApiClient();
  const send = vi.spyOn(client, "request");
  render(
    <ArtifactImport
      client={client}
      organization={decode("OrganizationResponse", factory.organization)}
      kind="graphs"
      onSaved={() => undefined}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Importer un graphe JSON" }),
  );
  fireEvent.change(screen.getByLabelText("Document JSON à importer"), {
    target: { value: "function unsafe() { return 1; }" },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Valider et enregistrer l’import" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "JSON invalide ou ambigu",
  );
  expect(send).not.toHaveBeenCalled();
});
it("does not invent run indicators for an empty history", () => {
  render(
    <History
      client={new ApiClient()}
      organization={decode("OrganizationResponse", factory.organization)}
      records={[]}
    />,
  );
  expect(screen.getByText(/Aucun run enregistré/)).toBeInTheDocument();
  expect(screen.queryByTestId("recorded-objective")).not.toBeInTheDocument();
});

it("distinguishes node and edge namespaces even when their canonical identifiers match", async () => {
  const document = decode("GraphArtifactResponse", factory.graph).document;
  const identity = document.graph.departments[0]!.id;
  document.graph.edges[0]!.id = identity;
  const { container } = render(<GraphCanvas document={document} />);
  await waitFor(() =>
    expect(
      container.querySelector(`.react-flow__edge[data-id="${identity}"]`),
    ).not.toBeNull(),
  );
  const edge = container.querySelector(
    `.react-flow__edge[data-id="${identity}"]`,
  )!;
  fireEvent.keyDown(edge, { key: "Enter" });
  await waitFor(() =>
    expect(
      within(container.querySelector(".inspector") as HTMLElement).getByRole(
        "heading",
        { name: "Relation informative" },
      ),
    ).toBeInTheDocument(),
  );
});
it("editing properties does not mutate a stored source and saving requires a new version", async () => {
  const source = decode("GraphArtifactResponse", factory.graph);
  const original = source.document.graph.organization.name;
  render(
    <GraphEditor
      client={new ApiClient()}
      organization={decode("OrganizationResponse", factory.organization)}
      source={source}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />,
  );
  await userEvent.clear(screen.getByLabelText("Nom de l’organisation"));
  await userEvent.type(
    screen.getByLabelText("Nom de l’organisation"),
    "A detached draft",
  );
  expect(source.document.graph.organization.name).toBe(original);
  expect(
    screen.getByRole("button", { name: "Valider et enregistrer le brouillon" }),
  ).toBeDisabled();
});
