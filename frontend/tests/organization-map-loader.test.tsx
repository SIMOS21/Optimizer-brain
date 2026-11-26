import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import type { Artifact, Organization } from "../src/api/types";
import { decode } from "../src/api/validation";
import { OrganizationMap } from "../src/features/organizations/OrganizationMap";
import { PresentationProvider } from "../src/shared/presentation/PresentationProvider";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";

afterEach(() => vi.restoreAllMocks());
const reference = decode("GraphArtifactResponse", factory.graph);
const organization: Organization = { ...factory.organization, role: "ADMIN" };
const metadata = (graph = reference): Artifact => ({ ...graph });
function view(client: ApiClient, records: Artifact[], org = organization) {
  return (
    <MemoryRouter>
      <PresentationProvider>
        <OrganizationMap client={client} organization={org} records={records} />
      </PresentationProvider>
    </MemoryRouter>
  );
}

it("does not request a graph for an empty organization", () => {
  const client = new ApiClient();
  const graph = vi.spyOn(client, "graph");
  render(view(client, []));
  expect(screen.getByText("Aucune carte enregistrée")).toBeVisible();
  expect(graph).not.toHaveBeenCalled();
});

it("opens the latest published snapshot, retaining explicit access to drafts", async () => {
  const draft = {
    ...reference,
    id: "draft",
    version: "draft",
    state: "DRAFT" as const,
    created_at: reference.created_at + 100,
  };
  const client = new ApiClient();
  const load = vi
    .spyOn(client, "graph")
    .mockImplementation(async (_org, id) =>
      id === draft.id ? draft : reference,
    );
  render(view(client, [metadata(draft), metadata()]));
  await screen.findByTestId("graph-canvas");
  expect(screen.getByLabelText("Version de la carte")).toHaveValue(
    reference.id,
  );
  expect(load).toHaveBeenCalledWith(organization.id, reference.id);
  fireEvent.change(screen.getByLabelText("Version de la carte"), {
    target: { value: draft.id },
  });
  await waitFor(() =>
    expect(load).toHaveBeenCalledWith(organization.id, draft.id),
  );
  expect(screen.getByLabelText("Version de la carte")).toHaveValue(draft.id);
});

it("clears an old tenant synchronously and ignores its late graph response", async () => {
  const other = decode("GraphArtifactResponse", university.graph);
  const client = new ApiClient();
  let finish!: (graph: typeof reference) => void;
  vi.spyOn(client, "graph").mockImplementation((_org, id) =>
    id === reference.id
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(other),
  );
  const { rerender } = render(view(client, [metadata()]));
  rerender(
    view(client, [metadata(other)], {
      ...university.organization,
      role: "ADMIN",
    }),
  );
  await screen.findByTestId("graph-canvas");
  finish(reference);
  await waitFor(() =>
    expect(screen.getByLabelText("Version de la carte")).toHaveValue(other.id),
  );
  expect(
    screen.queryByText(reference.document.graph.resources[0]!.name),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(other.document.graph.resources[0]!.name, {
      selector: ".studio-node strong",
    }),
  ).toBeInTheDocument();
});

it("clears a previous snapshot during loading and retries a failed request", async () => {
  const next = {
    ...reference,
    id: "next",
    version: "next",
    created_at: reference.created_at - 1,
  };
  const client = new ApiClient();
  const load = vi
    .spyOn(client, "graph")
    .mockResolvedValueOnce(reference)
    .mockRejectedValueOnce(new Error("Version inaccessible."))
    .mockResolvedValueOnce(next);
  render(view(client, [metadata(), metadata(next)]));
  await screen.findByTestId("graph-canvas");
  fireEvent.change(screen.getByLabelText("Version de la carte"), {
    target: { value: next.id },
  });
  expect(screen.queryByTestId("graph-canvas")).not.toBeInTheDocument();
  await screen.findByText("Version inaccessible.");
  fireEvent.click(screen.getByRole("button", { name: "Réessayer la carte" }));
  await screen.findByTestId("graph-canvas");
  expect(load).toHaveBeenCalledTimes(3);
});
