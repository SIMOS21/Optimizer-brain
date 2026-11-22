import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import type { Diagnostics } from "../src/api/types";
import { decode } from "../src/api/validation";
import { ConstraintDiagnostics } from "../src/features/diagnostics/ConstraintDiagnostics";

function diagnostic(): Diagnostics {
  return {
    id: "model",
    organization_id: "org",
    artifact_kind: "MODEL_VERSION",
    model_version_id: "model",
    content_hash: "immutable",
    model_content_hash: "immutable",
    report: {
      schema_version: "5A.1",
      model_id: "model",
      model_version: "1",
      model_hash: "math",
      manifest_hash: "manifest",
      data_snapshot_id: "synthetic_v1",
      scenario_id: "base",
      composition_manifest_hash: "composition",
      validation: "VALID",
      static_conclusion: "NO_CONCLUSION",
      findings: [],
      activities: [
        {
          constraint: {
            constraint_id: "production",
            department: "factory",
            source: "synthetic_only",
            approved: true,
            version: "1",
            fragment_ids: ["original_fragment"],
            contribution_ids: [],
            parameter_ids: [],
            resource_id: "machine",
            source_paths: ["fragments[0].constraints[0]"],
          },
          state: "UNAVAILABLE",
          lhs: null,
          rhs: "10",
          slack: null,
          violation: null,
          tolerance: null,
          unit_dimensions: [["time", 1]],
          unit_scale: "1/60",
          cost_status: "NOT_EVALUATED",
        },
      ],
      solver_status: null,
      infeasibility_evidence: "NONE",
      iis_available: false,
      plan_checked: false,
      plan_valid: null,
      plan_issues: [],
      limitations: [
        "Aucune faisabilité déduite de l'absence de contradiction.",
      ],
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

it("preserves exact rational facts and rejects an invented IIS or costly label", () => {
  const body = diagnostic();
  expect(
    decode("DiagnosticsResponse", body).report.activities[0]?.unit_scale,
  ).toBe("1/60");
  expect(() =>
    decode("DiagnosticsResponse", {
      ...body,
      report: { ...body.report, iis_available: true },
    }),
  ).toThrow();
  body.report.activities[0]!.cost_status = "COSTLY" as "NOT_EVALUATED";
  expect(() => decode("DiagnosticsResponse", body)).toThrow();
});
it.each([
  "organization_id",
  "id",
  "artifact_kind",
  "model_version_id",
] as const)("rejects mismatched diagnostic identity: %s", async (field) => {
  const body = {
    ...diagnostic(),
    [field]: field === "artifact_kind" ? "RUN" : "foreign",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body))),
  );
  await expect(
    new ApiClient().diagnostics("org", "model", "model-versions"),
  ).rejects.toThrow("incohérente");
});
it("loads diagnostics only on request and uses a read-only secured GET", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(diagnostic())));
  vi.stubGlobal("fetch", fetch);
  render(
    <ConstraintDiagnostics
      client={new ApiClient()}
      org="org"
      id="model"
      kind="model-versions"
      contentHash="immutable"
    />,
  );
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Consulter les diagnostics" }),
  );
  expect(await screen.findByTestId("static-conclusion")).toHaveTextContent(
    "non concluante",
  );
  expect(screen.getByText("UNAVAILABLE")).toBeInTheDocument();
  expect(screen.getByText("NOT_EVALUATED")).toBeInTheDocument();
  expect(screen.queryByText("SATURATED")).not.toBeInTheDocument();
  const [path, options] = fetch.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(path).toBe(
    "/api/v1/organizations/org/model-versions/model/diagnostics",
  );
  expect(options.method).toBe("GET");
  expect(options.credentials).toBe("omit");
  expect(options.cache).toBe("no-store");
});
it("shows violated versus saturated activities, recorded tolerance and explicit unavailable costs", async () => {
  const body = diagnostic();
  body.report.activities[0] = {
    ...body.report.activities[0]!,
    state: "SATURATED",
    lhs: "10",
    slack: "0",
    violation: "0",
    tolerance: "1/10000000",
  };
  body.report.activities.push({
    ...body.report.activities[0]!,
    constraint: {
      ...body.report.activities[0]!.constraint,
      constraint_id: "violated",
    },
    state: "VIOLATED",
    violation: "1/3",
  });
  body.report.plan_checked = true;
  body.report.plan_valid = false;
  body.report.plan_issues = ["Contrainte violée : violated"];
  const client = new ApiClient();
  vi.spyOn(client, "diagnostics").mockResolvedValue(body);
  render(
    <ConstraintDiagnostics
      client={client}
      org="org"
      id="model"
      kind="model-versions"
      contentHash="immutable"
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("SATURATED");
  expect(screen.getByText("VIOLATED")).toBeInTheDocument();
  expect(screen.getByText("1/3")).toBeInTheDocument();
  expect(screen.getByText(/Plan refusé/)).toBeInTheDocument();
  expect(
    screen.getByText(/une contrainte saturée ne prouve/),
  ).toBeInTheDocument();
});
it("shows exact proof provenance without claiming an IIS", async () => {
  const body = diagnostic();
  body.report.static_conclusion = "CONTRADICTION_PROVEN";
  body.report.infeasibility_evidence = "STATIC_PROOF";
  body.report.findings = [
    {
      code: "PARALLEL_ROWS_CONTRADICTION",
      message: "Conflict demonstrated",
      constraints: [body.report.activities[0]!.constraint],
      variable_ids: [],
      variable_departments: [],
      path: null,
      facts: [["required_minimum", "11/3"]],
    },
  ];
  const client = new ApiClient();
  vi.spyOn(client, "diagnostics").mockResolvedValue(body);
  render(
    <ConstraintDiagnostics
      client={client}
      org="org"
      id="model"
      kind="model-versions"
      contentHash="immutable"
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("PARALLEL_ROWS_CONTRADICTION");
  expect(screen.getByText(/source synthetic_only/)).toBeInTheDocument();
  expect(screen.getByText(/Fragments : original_fragment/)).toBeInTheDocument();
  expect(screen.getByText(/Aucun IIS fourni/)).toBeInTheDocument();
});
it("rejects diagnostics for a different content hash", async () => {
  const client = new ApiClient();
  vi.spyOn(client, "diagnostics").mockResolvedValue(diagnostic());
  render(
    <ConstraintDiagnostics
      client={client}
      org="org"
      id="model"
      kind="model-versions"
      contentHash="changed"
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent("empreinte");
  expect(
    screen.queryByTestId("constraint-diagnostics"),
  ).not.toBeInTheDocument();
});
it.each([401, 403, 404, 409, 500])(
  "shows a safe error for HTTP %s",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private-error-body", { status })),
    );
    render(
      <ConstraintDiagnostics
        client={new ApiClient()}
        org="org"
        id="model"
        kind="model-versions"
        contentHash="immutable"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    expect(screen.queryByText("private-error-body")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("constraint-diagnostics"),
    ).not.toBeInTheDocument();
  },
);
it("hides previous tenant data immediately and ignores late responses", async () => {
  let resolve!: (value: Diagnostics) => void;
  const pending = new Promise<Diagnostics>((complete) => {
    resolve = complete;
  });
  const client = new ApiClient();
  vi.spyOn(client, "diagnostics").mockImplementation((org) =>
    org === "org"
      ? pending
      : Promise.resolve({ ...diagnostic(), organization_id: "next" }),
  );
  const { rerender } = render(
    <ConstraintDiagnostics
      client={client}
      org="org"
      id="model"
      kind="model-versions"
      contentHash="immutable"
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  rerender(
    <ConstraintDiagnostics
      client={client}
      org="next"
      id="model"
      kind="model-versions"
      contentHash="immutable"
    />,
  );
  await screen.findByTestId("constraint-diagnostics");
  const foreign = diagnostic();
  foreign.report.activities[0]!.constraint.constraint_id = "foreign-constraint";
  await act(async () => {
    resolve(foreign);
  });
  expect(screen.queryByText("foreign-constraint")).not.toBeInTheDocument();
});
