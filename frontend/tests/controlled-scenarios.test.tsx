import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { PresentationProvider } from "../src/shared/presentation/PresentationProvider";
import { ApiClient, ApiError } from "../src/api/client";
import type {
  ChangePolicy,
  ChangePreview,
  ControlledProposal,
  Scenario,
  Role,
} from "../src/api/types";
import { decode } from "../src/api/validation";
import { ControlledScenarios } from "../src/features/scenarios/ControlledScenarios";
import factory from "./fixtures/factory.json";

const org = factory.organization;
const user = "explicit_delegate";
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: PresentationProvider });
}
function policy(): ChangePolicy {
  return {
    id: "policy",
    organization_id: org.id,
    key: "capacity",
    version: "1",
    created_by: "other_creator",
    created_at: 100,
    content_hash: "a".repeat(64),
    state: "PUBLISHED",
    published_by: "approver",
    published_at: 101,
    usable: true,
    unavailability_reasons: [],
    approvals: [
      {
        user_id: "owner",
        created_at: 100,
        policy_content_hash: "a".repeat(64),
      },
    ],
    document: {
      schema_version: "5B.2",
      id: "policy",
      organization_id: org.id,
      key: "capacity",
      version: "1",
      author_id: "other_creator",
      name: "Controlled synthetic policy",
      reason: "Synthetic range",
      source_model_version_id: factory.model.id,
      source_content_hash: factory.model.content_hash,
      rules: [
        {
          id: "delivery",
          target: {
            kind: "RESOURCE_CAPACITY",
            parameter_id: "delivery_capacity_units",
            resource_id: "logistics_resource",
            fragment_id: null,
            path: "shared_parameters.delivery_capacity_units.value",
          },
          operation: "SET",
          domain: "DECIMAL",
          unit: "unit",
          minimum: "1E-10",
          maximum: "70",
          owner_department: "logistics",
          owner_user_id: "owner",
          allowed_user_ids: [user],
          approval: "OWNER_ACK_AND_PUBLICATION",
        },
      ],
    },
  };
}
function preview(): ChangePreview {
  return {
    organization_id: org.id,
    source_model_version_id: factory.model.id,
    source_content_hash: factory.model.content_hash,
    policy_version_id: "policy",
    policy_content_hash: "a".repeat(64),
    parent_scenario_id: null,
    preview_hash: "b".repeat(64),
    model_hash: "c".repeat(64),
    changes: [
      {
        rule_id: "delivery",
        target: policy().document.rules[0]!.target,
        domain: "DECIMAL",
        unit: "unit",
        owner_department: "logistics",
        owner_user_id: "owner",
        original_value: "55",
        previous_value: "55",
        proposed_value: "45.00000000000000001",
        source: "synthetic_source",
        changed_by: user,
      },
    ],
    affected_constraint_ids: ["logistics_delivery"],
    affects_objective: false,
    creates_new_snapshot: true,
    requires_graph_publication: true,
    requires_model_publication: true,
  };
}
function proposal(): ControlledProposal {
  return {
    key: "controlled",
    version: "1",
    name: "Controlled model",
    reason: "Synthetic test",
    source_model_version_id: factory.model.id,
    expected_source_content_hash: factory.model.content_hash,
    policy_version_id: "policy",
    expected_policy_content_hash: "a".repeat(64),
    parent_scenario_id: null,
    changes: [
      {
        rule_id: "delivery",
        unit: "unit",
        operation: "SET",
        value: "45.00000000000000001",
        source: "synthetic_source",
      },
    ],
  };
}
function scenario(): Scenario {
  return {
    id: "scenario",
    organization_id: org.id,
    key: "controlled",
    version: "1",
    created_by: user,
    created_at: 103,
    content_hash: "d".repeat(64),
    source_model_version_id: factory.model.id,
    model_version_id: "derived",
    model_state: "DRAFT",
    document: {
      schema_version: "5B.2",
      kind: "CONTROLLED_CHANGES",
      id: "scenario",
      organization_id: org.id,
      key: "controlled",
      version: "1",
      name: "Controlled model",
      reason: "Synthetic test",
      author_id: user,
      source_model_version_id: factory.model.id,
      source_content_hash: factory.model.content_hash,
      source_graph_snapshot_id: factory.graph.id,
      source_data_snapshot_id: factory.model.data_snapshot_id!,
      model_version_id: "derived",
      model_content_hash: "e".repeat(64),
      graph_snapshot_id: "new_graph",
      graph_content_hash: "f".repeat(64),
      data_snapshot_id: "new_snapshot",
      scenario_id: "scenario_new",
      policy_version_id: "policy",
      policy_content_hash: "a".repeat(64),
      parent_scenario_id: null,
      preview_hash: "b".repeat(64),
      changes: preview().changes,
    },
  };
}
function client(record = policy()) {
  const api = new ApiClient();
  vi.spyOn(api, "model").mockResolvedValue(
    decode("ModelArtifactResponse", factory.model),
  );
  vi.spyOn(api, "changeTargets").mockResolvedValue({
    organization_id: org.id,
    source_model_version_id: factory.model.id,
    source_content_hash: factory.model.content_hash,
    items: [
      {
        target: record.document.rules[0]!.target,
        unit: "unit",
        value: "55",
        owner_department: "logistics",
        registered_owner_user_id: "owner",
        affected_constraint_ids: ["logistics_delivery"],
        affects_objective: false,
      },
    ],
  });
  vi.spyOn(api, "policies").mockResolvedValue({
    items: [record],
    limit: 50,
    offset: 0,
  });
  return api;
}
function mount(
  api: ApiClient,
  currentUser = user,
  role: Role = "BUILDER",
  created = vi.fn(),
) {
  return {
    ...render(
      <ControlledScenarios
        client={api}
        organization={{ ...org, role }}
        userId={currentUser}
        models={[
          decode("ArtifactResponse", { ...factory.model, document: null }),
        ]}
        onCreated={created}
      />,
    ),
    created,
  };
}
async function fill() {
  await screen.findByRole("heading", {
    name: "Controlled synthetic policy · capacity / 1",
  });
  fireEvent.change(screen.getByLabelText("Référence de la politique"), {
    target: { value: factory.model.id },
  });
  fireEvent.change(screen.getByLabelText("Politique publiée à utiliser"), {
    target: { value: "policy" },
  });
  for (const [label, value] of [
    ["Clé du scénario contrôlé", "controlled"],
    ["Version du scénario contrôlé", "1"],
    ["Nom du scénario contrôlé", "Controlled model"],
    ["Justification du scénario contrôlé", "Synthetic test"],
    ["Source des hypothèses", "synthetic_source"],
    ["Valeur proposée · delivery (unit)", "45.00000000000000001"],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
afterEach(() => vi.unstubAllGlobals());

it("decodes exact decimal policy ranges and controlled scenario provenance", () => {
  expect(
    decode("ChangePolicyResponse", policy()).document.rules[0]!.minimum,
  ).toBe("1E-10");
  expect(decode("ScenarioResponse", scenario()).document.kind).toBe(
    "CONTROLLED_CHANGES",
  );
});
it.each(["organization_id", "key", "version", "created_by"] as const)(
  "rejects inconsistent policy %s",
  async (field) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ ...policy(), [field]: "foreign" }],
              limit: 50,
              offset: 0,
            }),
          ),
      ),
    );
    await expect(new ApiClient().policies(org.id)).rejects.toThrow();
  },
);
it("rejects a preview detached from its reference or policy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ...preview(), policy_content_hash: "other" }),
        ),
    ),
  );
  await expect(
    new ApiClient().previewChanges(org.id, proposal()),
  ).rejects.toThrow("politique");
});
it("rejects a committed scenario detached from the approved preview", async () => {
  const record = scenario();
  if (record.document.kind === "CONTROLLED_CHANGES")
    record.document.preview_hash = "other";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(record))),
  );
  await expect(
    new ApiClient().commitChanges(org.id, {
      proposal: proposal(),
      expected_preview_hash: preview().preview_hash,
    }),
  ).rejects.toThrow("prévisualisation");
});
it("never infers a delegation from ADMIN or the creator role", async () => {
  const p = policy();
  p.created_by = p.document.author_id = "creator";
  mount(client(p), "creator", "ADMIN");
  await screen.findByRole("heading", {
    name: "Controlled synthetic policy · capacity / 1",
  });
  fireEvent.change(screen.getByLabelText("Référence de la politique"), {
    target: { value: factory.model.id },
  });
  fireEvent.change(screen.getByLabelText("Politique publiée à utiliser"), {
    target: { value: "policy" },
  });
  expect(screen.getByText(/ne vous délègue aucune/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Prévisualiser les changements" }),
  ).not.toBeInTheDocument();
});
it.each(["DRAFT", "REVOKED"])(
  "does not offer an unusable %s policy",
  async (state) => {
    const p = policy();
    p.usable = false;
    p.state = state === "DRAFT" ? "DRAFT" : "PUBLISHED";
    mount(client(p));
    await screen.findByRole("heading", {
      name: "Controlled synthetic policy · capacity / 1",
    });
    fireEvent.change(screen.getByLabelText("Référence de la politique"), {
      target: { value: factory.model.id },
    });
    expect(
      screen.queryByRole("option", { name: /Controlled synthetic policy/ }),
    ).not.toBeInTheDocument();
  },
);
it("keeps VIEWER read only and shows owner acknowledgements only to named owners", async () => {
  const p = policy();
  p.state = "DRAFT";
  p.usable = false;
  p.approvals = [];
  mount(client(p), "viewer", "VIEWER");
  await screen.findByRole("heading", {
    name: "Controlled synthetic policy · capacity / 1",
  });
  expect(
    screen.queryByText("Nouvelle politique de changement"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /accord de responsable|Publier la politique/,
    }),
  ).not.toBeInTheDocument();
});
it("previews once, preserves exact values, and requires explicit confirmation", async () => {
  const api = client();
  let finish!: (r: ChangePreview) => void;
  const inspect = vi.spyOn(api, "previewChanges").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const commit = vi.spyOn(api, "commitChanges").mockResolvedValue(scenario());
  mount(api);
  await fill();
  const form = screen
    .getByRole("button", { name: "Prévisualiser les changements" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(commit).not.toHaveBeenCalled();
  expect(inspect.mock.calls[0]![1]).toEqual(proposal());
  await act(async () => finish(preview()));
  expect(screen.getByTestId("change-preview")).toHaveTextContent(
    "45.00000000000000001",
  );
  expect(
    screen.getByLabelText("Valeur proposée · delivery (unit)"),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirmer la création contrôlée" }),
  );
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(commit.mock.calls[0]![1]).toEqual({
    proposal: proposal(),
    expected_preview_hash: preview().preview_hash,
  });
});
it("retries the captured commit after an ambiguous response and blocks double clicks", async () => {
  const api = client();
  vi.spyOn(api, "previewChanges").mockResolvedValue(preview());
  let finish!: (r: Scenario) => void;
  const commit = vi
    .spyOn(api, "commitChanges")
    .mockRejectedValueOnce(new Error("uncertain"))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
  const { created } = mount(api);
  await fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Prévisualiser les changements" }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Confirmer la création contrôlée",
    }),
  );
  const retry = await screen.findByRole("button", {
    name: "Réessayer la même création contrôlée",
  });
  expect(screen.getByLabelText("Référence de la politique")).toBeDisabled();
  expect(screen.getByLabelText("Politique publiée à utiliser")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Actualiser les politiques" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Revenir aux hypothèses" }),
  ).toBeDisabled();
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(commit).toHaveBeenCalledTimes(2);
  expect(commit.mock.calls[0]![1]).toEqual(commit.mock.calls[1]![1]);
  await act(async () => finish(scenario()));
  expect(created).toHaveBeenCalledTimes(1);
});
it("invalidates the preview after a definitive rejection and allows correction", async () => {
  const api = client();
  vi.spyOn(api, "previewChanges").mockResolvedValue(preview());
  vi.spyOn(api, "commitChanges").mockRejectedValue(
    new ApiError(403, "POLICY_AUTHORITY_REVOKED"),
  );
  mount(api);
  await fill();
  fireEvent.click(
    screen.getByRole("button", { name: "Prévisualiser les changements" }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Confirmer la création contrôlée",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("révoquée");
  expect(screen.queryByTestId("change-preview")).not.toBeInTheDocument();
  expect(
    screen.getByLabelText("Valeur proposée · delivery (unit)"),
  ).toBeEnabled();
});

it("never grants OWNER_ACK to a named owner whose current role is VIEWER", async () => {
  const p = policy();
  p.state = "DRAFT";
  p.usable = false;
  p.approvals = [];
  const api = client(p);
  const write = vi.spyOn(api, "policyAction");
  mount(api, "owner", "VIEWER");
  await screen.findByRole("heading", {
    name: "Controlled synthetic policy · capacity / 1",
  });
  expect(
    screen.queryByRole("button", { name: "Donner mon accord de responsable" }),
  ).not.toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
});

it("keeps publication disabled until the stored owner acknowledgement exists", async () => {
  const p = policy();
  p.state = "DRAFT";
  p.usable = false;
  p.approvals = [];
  mount(client(p), "approver", "APPROVER");
  await screen.findByRole("heading", {
    name: "Controlled synthetic policy · capacity / 1",
  });
  expect(
    screen.getByRole("button", { name: "Publier la politique" }),
  ).toBeDisabled();
});

it("loads membership data only when policy creation is explicitly opened", async () => {
  const api = client();
  const members = vi.spyOn(api, "memberships").mockResolvedValue([]);
  vi.spyOn(api, "departments").mockResolvedValue([]);
  mount(api);
  await screen.findByRole("heading", {
    name: "Controlled synthetic policy · capacity / 1",
  });
  fireEvent.change(screen.getByLabelText("Référence de la politique"), {
    target: { value: factory.model.id },
  });
  await screen.findByRole("heading", {
    name: factory.model.document.organization_model.model_name,
  });
  expect(members).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByText("Nouvelle politique de changement", { exact: true }),
  );
  await waitFor(() => expect(members).toHaveBeenCalledOnce());
});

it("distinguishes reference and inherited parent values without rounding decimal text", async () => {
  const api = client();
  const result = preview();
  result.parent_scenario_id = "parent";
  result.changes[0]!.previous_value = "54.00000000000000001";
  vi.spyOn(api, "previewChanges").mockResolvedValue(result);
  mount(api);
  await fill();
  await waitFor(() =>
    expect(screen.getByText(/Valeur de référence :/)).toHaveTextContent(
      "55 unit",
    ),
  );
  fireEvent.change(
    screen.getByLabelText("Parent publié facultatif — identifiant"),
    { target: { value: "parent" } },
  );
  expect(
    screen.getByText(/La valeur héritée du parent sera confirmée/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Prévisualiser les changements" }),
  );
  const rendered = await screen.findByTestId("change-preview");
  expect(rendered).toHaveTextContent("54.00000000000000001");
  expect(rendered).toHaveTextContent("45.00000000000000001");
});
it.each(["preview", "commit"])(
  "ignores a late %s after leaving the tenant",
  async (kind) => {
    const api = client();
    let finishPreview!: (r: ChangePreview) => void;
    let finishCommit!: (r: Scenario) => void;
    vi.spyOn(api, "previewChanges").mockReturnValue(
      kind === "preview"
        ? new Promise((r) => {
            finishPreview = r;
          })
        : Promise.resolve(preview()),
    );
    vi.spyOn(api, "commitChanges").mockReturnValue(
      new Promise((r) => {
        finishCommit = r;
      }),
    );
    const { unmount, created } = mount(api);
    await fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Prévisualiser les changements" }),
    );
    if (kind === "commit")
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Confirmer la création contrôlée",
        }),
      );
    unmount();
    await act(async () => {
      if (kind === "preview") finishPreview(preview());
      else finishCommit(scenario());
    });
    expect(created).not.toHaveBeenCalled();
  },
);
it("shows only closed public error codes, without echoing arbitrary server text", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: { code: "CHANGE_OUT_OF_RANGE" } }),
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: { code: "private-server-secret" } }),
          { status: 422 },
        ),
      ),
  );
  const api = new ApiClient();
  await expect(api.previewChanges(org.id, proposal())).rejects.toThrow(
    "bornes autorisées",
  );
  await expect(api.previewChanges(org.id, proposal())).rejects.not.toThrow(
    "private-server-secret",
  );
});
it("aborts a delayed error body before displaying a stale authorization failure", async () => {
  let release!: (r: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 403,
      json: () =>
        new Promise((r) => {
          release = r;
        }),
    })),
  );
  const api = new ApiClient();
  const pending = api.previewChanges(org.id, proposal());
  await waitFor(() => expect(release).toBeDefined());
  api.abort();
  release({ detail: { code: "POLICY_AUTHORITY_REVOKED" } });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
