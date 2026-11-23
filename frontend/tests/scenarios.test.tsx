import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../src/api/client";
import type { Organization, Scenario, ScenarioCreate } from "../src/api/types";
import { decode } from "../src/api/validation";
import { ScenarioLab } from "../src/features/scenarios/ScenarioLab";
import factory from "./fixtures/factory.json";

const org = factory.organization;
function scenario(): Scenario {
  return {
    id: "clone",
    organization_id: org.id,
    key: "trial",
    version: "1",
    created_by: "author",
    created_at: 100,
    content_hash: "canonical",
    source_model_version_id: factory.model.id,
    model_version_id: "derived",
    model_state: "DRAFT",
    document: {
      schema_version: "5B.1",
      kind: "IDENTICAL_CLONE",
      id: "clone",
      organization_id: org.id,
      key: "trial",
      version: "1",
      name: "Synthetic clone",
      reason: "Synthetic test",
      author_id: "author",
      source_model_version_id: factory.model.id,
      source_content_hash: factory.model.content_hash,
      model_version_id: "derived",
      model_content_hash: "derived_hash",
      graph_snapshot_id: factory.graph.id,
      graph_content_hash: factory.graph.content_hash,
      data_snapshot_id: "synthetic_v1",
      scenario_id: "scenario_clone",
      changes: [],
    },
  };
}
function request(): ScenarioCreate {
  return {
    key: "trial",
    version: "1",
    name: "Synthetic clone",
    reason: "Synthetic test",
    source_model_version_id: factory.model.id,
    expected_source_content_hash: factory.model.content_hash,
  };
}
function client() {
  const result = new ApiClient();
  vi.spyOn(result, "scenarios").mockResolvedValue({
    items: [],
    limit: 50,
    offset: 0,
  });
  return result;
}
function mount(
  api: ApiClient,
  organization: Organization = { ...org, role: "BUILDER" },
  path = "/",
) {
  return render(
    <MemoryRouter
      initialEntries={[
        `/organizations/${organization.id}/scenarios${path === "/" ? "" : path}`,
      ]}
    >
      <Routes>
        <Route
          path="/organizations/:organizationId/scenarios/:id?"
          element={
            <ScenarioLab
              client={api}
              organization={organization}
              models={[
                decode("ArtifactResponse", {
                  ...factory.model,
                  document: null,
                }),
              ]}
              refresh={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText("Modèle publié de référence"), {
    target: { value: factory.model.id },
  });
  for (const [label, value] of [
    ["Clé du scénario", "trial"],
    ["Version du scénario", "1"],
    ["Nom du scénario", "Synthetic clone"],
    ["Justification du scénario", "Synthetic test"],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
afterEach(() => vi.unstubAllGlobals());

it.each([" 1 ", "\u00851\u0085", "\u00a01\u00a0"])(
  "accepts the canonical version returned by the API for %j and can repeat it",
  async (version) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(scenario())));
    vi.stubGlobal("fetch", fetch);
    const api = new ApiClient();
    const submitted = { ...request(), version };
    expect((await api.createScenario(org.id, submitted)).id).toBe("clone");
    expect((await api.createScenario(org.id, submitted)).id).toBe("clone");
    expect(submitted.version).toBe(version);
  },
);
it("keeps non-whitespace version characters significant and rejects another version", async () => {
  const record = scenario();
  const fetch = vi.fn(async () => new Response(JSON.stringify(record)));
  vi.stubGlobal("fetch", fetch);
  const api = new ApiClient();
  record.version = record.document.version = "\ufeff1\ufeff";
  expect(
    (
      await api.createScenario(org.id, {
        ...request(),
        version: "\ufeff1\ufeff",
      })
    ).version,
  ).toBe("\ufeff1\ufeff");
  record.version = record.document.version = "2";
  await expect(
    api.createScenario(org.id, { ...request(), version: " 1 " }),
  ).rejects.toThrow("demande");
});

it("validates an empty change set and rejects hidden model overrides", () => {
  expect(decode("ScenarioResponse", scenario()).document.changes).toEqual([]);
  const invalid = scenario() as unknown as { document: { changes: unknown[] } };
  invalid.document.changes = [{ parameter: "capacity", value: "999" }];
  expect(() => decode("ScenarioResponse", invalid)).toThrow();
});
it.each([
  "organization_id",
  "id",
  "model_version_id",
  "source_model_version_id",
] as const)("rejects inconsistent scenario provenance: %s", async (field) => {
  const record = { ...scenario(), [field]: "foreign" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(record))),
  );
  await expect(new ApiClient().scenario(org.id, "clone")).rejects.toThrow();
});
it("binds creation to the expected reference hash and uses only the secured API", async () => {
  const record = scenario();
  const fetch = vi.fn(async () => new Response(JSON.stringify(record)));
  vi.stubGlobal("fetch", fetch);
  await new ApiClient().createScenario(org.id, request());
  const [path, options] = fetch.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(path).toBe(`/api/v1/organizations/${org.id}/scenarios`);
  expect(options.method).toBe("POST");
  expect(options.credentials).toBe("omit");
  expect(JSON.parse(String(options.body))).toEqual(request());
  record.document.source_content_hash = "other";
  await expect(
    new ApiClient().createScenario(org.id, request()),
  ).rejects.toThrow();
});
it.each(["VIEWER", "APPROVER"] as const)(
  "keeps the creation form unavailable to %s",
  async (role) => {
    mount(client(), { ...org, role });
    await screen.findByText("Aucun scénario enregistré.");
    expect(
      screen.queryByRole("button", { name: "Créer la copie isolée" }),
    ).not.toBeInTheDocument();
  },
);
it("guards double submission while awaiting the API", async () => {
  const api = client();
  let finish!: (record: Scenario) => void;
  const pending = new Promise<Scenario>((resolve) => {
    finish = resolve;
  });
  const create = vi.spyOn(api, "createScenario").mockReturnValue(pending);
  vi.spyOn(api, "scenario").mockResolvedValue(scenario());
  mount(api);
  fill();
  const form = screen
    .getByRole("button", { name: "Créer la copie isolée" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Clé du scénario")).toBeDisabled();
  await act(async () => {
    finish(scenario());
  });
  expect(await screen.findByTestId("scenario-detail")).toHaveTextContent(
    "publié explicitement",
  );
});
it("repeats the captured request after an ambiguous failure", async () => {
  const api = client();
  const create = vi
    .spyOn(api, "createScenario")
    .mockRejectedValueOnce(new Error("Uncertain transport"))
    .mockResolvedValueOnce(scenario());
  vi.spyOn(api, "scenario").mockResolvedValue(scenario());
  mount(api);
  fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Créer la copie isolée" }),
  );
  await screen.findByRole("button", { name: "Réessayer la même création" });
  expect(screen.getByLabelText("Version du scénario")).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Réessayer la même création" }),
  );
  await screen.findByTestId("scenario-detail");
  expect(create.mock.calls[0]?.[1]).toEqual(create.mock.calls[1]?.[1]);
});
it("allows correction after an explicit version conflict, without automatic retry", async () => {
  const api = client();
  const create = vi
    .spyOn(api, "createScenario")
    .mockRejectedValue(new ApiError(409));
  mount(api);
  fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Créer la copie isolée" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Version du scénario")).toBeEnabled();
  expect(create).toHaveBeenCalledTimes(1);
});
it("ignores a completed mutation after destruction", async () => {
  const api = client();
  let finish!: (record: Scenario) => void;
  vi.spyOn(api, "createScenario").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const detail = vi.spyOn(api, "scenario");
  const { unmount } = mount(api);
  fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Créer la copie isolée" }),
  );
  unmount();
  await act(async () => {
    finish(scenario());
  });
  expect(detail).not.toHaveBeenCalled();
});
it("does not display any calculated gain or a fabricated result", async () => {
  const api = client();
  vi.spyOn(api, "scenario").mockResolvedValue(scenario());
  mount(api, { ...org, role: "VIEWER" }, "/clone");
  await screen.findByTestId("scenario-detail");
  expect(
    screen.getByText(/comparaison et les gains ne sont pas encore/),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("recorded-objective")).not.toBeInTheDocument();
  expect(screen.getByTestId("scenario-model-link")).toHaveAttribute(
    "href",
    `/organizations/${org.id}/models/derived`,
  );
});
it("paginates the scenario history explicitly", async () => {
  const api = client();
  vi.mocked(api.scenarios)
    .mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({
        ...scenario(),
        id: String(index),
      })),
      limit: 50,
      offset: 0,
    })
    .mockResolvedValue({ items: [], limit: 50, offset: 50 });
  mount(api, { ...org, role: "VIEWER" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Versions suivantes" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Versions suivantes" }));
  await screen.findByText("Aucun scénario enregistré.");
  expect(api.scenarios).toHaveBeenLastCalledWith(org.id, 50);
});
