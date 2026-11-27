import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../src/api/client";
import type {
  ScenarioComparison as Report,
  Organization,
} from "../src/api/types";
import { decode } from "../src/api/validation";
import { ScenarioComparison } from "../src/features/scenarios/ScenarioComparison";
import {
  PresentationContext,
  type PresentationMode,
} from "../src/shared/presentation/context";
import factory from "./fixtures/comparison-factory.json";
import university from "./fixtures/comparison-university.json";
import oldFactory from "./fixtures/factory.json";

afterEach(() => vi.unstubAllGlobals());
const report = () => decode("ComparisonReport", structuredClone(factory));
function organization(r = report()): Organization {
  return {
    ...decode("OrganizationResponse", oldFactory.organization),
    id: r.organization_id,
  };
}
function records(r = report()) {
  return [r.baseline, r.candidate].flatMap((run) =>
    run
      ? [
          decode("ArtifactResponse", {
            id: run.run_id,
            organization_id: run.organization_id,
            content_hash: run.content_hash,
            model_version_id: run.model_version_id,
            created_at: run.created_at,
            created_by: run.created_by,
            status: run.public_status,
            document: null,
          }),
        ]
      : [],
  );
}
function view(
  api: ApiClient,
  r = report(),
  mode: PresentationMode = "business",
  org = organization(r),
) {
  return (
    <MemoryRouter>
      <PresentationContext.Provider value={{ mode, setMode: vi.fn() }}>
        <ScenarioComparison
          client={api}
          organization={org}
          records={records(r)}
        />
      </PresentationContext.Provider>
    </MemoryRouter>
  );
}
function submit(r = report()) {
  fireEvent.change(screen.getByLabelText("Run de référence"), {
    target: { value: r.baseline_run_id },
  });
  fireEvent.change(screen.getByLabelText("Run de scénario candidat"), {
    target: { value: r.candidate_run_id },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Vérifier la comparaison" }),
  );
}

it.each(["ADMIN", "BUILDER", "APPROVER", "VIEWER"] as const)(
  "%s can read real comparison artifacts without any mutation or invented gain",
  async (role) => {
    const r = report();
    const api = new ApiClient();
    const call = vi.spyOn(api, "compareRuns").mockResolvedValue(r);
    render(view(api, r, "business", { ...organization(r), role }));
    expect(call).not.toHaveBeenCalled();
    submit(r);
    await screen.findByTestId("scenario-comparison-result");
    expect(call).toHaveBeenCalledExactlyOnceWith(
      r.organization_id,
      r.baseline_run_id,
      r.candidate_run_id,
    );
    expect(
      screen.getByTestId("comparison-baseline-objective"),
    ).toHaveTextContent("4100 EUR");
    expect(
      screen.getByTestId("comparison-candidate-objective"),
    ).toHaveTextContent("3500 EUR");
    expect(screen.getByTestId("comparison-observed-delta")).toHaveTextContent(
      "-600 EUR",
    );
    expect(screen.getByTestId("comparison-message")).toHaveTextContent(
      "gain non démontré",
    );
    expect(
      screen.queryByText("Rapport canonique de comparaison"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/2200\/19/)).not.toBeInTheDocument();
  },
);

it("expert mode reveals recorded bounds, hashes and verification without another request", async () => {
  const api = new ApiClient();
  const call = vi.spyOn(api, "compareRuns").mockResolvedValue(report());
  const mounted = render(view(api));
  submit();
  await screen.findByTestId("scenario-comparison-result");
  mounted.rerender(view(api, report(), "expert"));
  expect(
    screen.getByText("Rapport canonique de comparaison"),
  ).toBeInTheDocument();
  const proof = screen.getByText("Provenance et vérification · Candidat");
  fireEvent.click(proof);
  expect(proof.parentElement).toHaveTextContent('"best_bound"');
  expect(call).toHaveBeenCalledTimes(1);
});

it("university retains the real 17 and 10 with no economic percentage", async () => {
  const r = decode("ComparisonReport", university);
  const api = new ApiClient();
  vi.spyOn(api, "compareRuns").mockResolvedValue(r);
  render(view(api, r));
  submit(r);
  await screen.findByTestId("scenario-comparison-result");
  expect(screen.getByTestId("comparison-baseline-objective")).toHaveTextContent(
    "17 unit",
  );
  expect(
    screen.getByTestId("comparison-candidate-objective"),
  ).toHaveTextContent("10 unit");
  expect(screen.getByTestId("comparison-observed-delta")).toHaveTextContent(
    "-7 unit",
  );
});

it("keeps exact fractions returned by the server as text", async () => {
  const r = report();
  r.observed_objective_delta = "1/3";
  const api = new ApiClient();
  vi.spyOn(api, "compareRuns").mockResolvedValue(r);
  render(view(api, r));
  submit(r);
  expect(
    await screen.findByTestId("comparison-observed-delta"),
  ).toHaveTextContent("1/3 EUR");
});

it.each(["INFEASIBLE", "TIME_LIMIT_NO_SOLUTION", "SOLUTION_FAILED_VALIDATION"])(
  "does not show an objective for the candidate status %s",
  async (status) => {
    const r = report();
    if (!r.candidate) throw new Error("Fixture must have a candidate");
    r.candidate.public_status = status;
    r.candidate.verified_plan = false;
    r.candidate.objective_value = null;
    r.candidate.verification_issues = [
      "INDEPENDENT_VERIFICATION_FAILED_OR_ABSENT",
    ];
    r.comparability = "NOT_COMPARABLE";
    r.claim = "NONE";
    r.message = "Comparaison non concluante";
    r.observed_objective_delta = r.oriented_objective_delta = null;
    r.decisions = [];
    r.resources = [];
    r.constraints = [];
    const api = new ApiClient();
    vi.spyOn(api, "compareRuns").mockResolvedValue(r);
    render(view(api, r));
    submit(r);
    expect(
      await screen.findByTestId("comparison-candidate-objective"),
    ).toHaveTextContent("Non fourni");
    expect(screen.getByTestId("comparison-observed-delta")).toHaveTextContent(
      "Non fourni",
    );
    expect(
      screen.getAllByText(`Statut mathématique enregistré :`, { exact: false }),
    ).toHaveLength(2);
  },
);

it("erases a result immediately when selection changes and ignores its delayed response", async () => {
  const api = new ApiClient();
  let finish!: (r: Report) => void;
  vi.spyOn(api, "compareRuns").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(view(api));
  submit();
  expect(
    screen.getByRole("button", { name: "Vérifier la comparaison" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Run de scénario candidat"), {
    target: { value: "" },
  });
  await act(async () => {
    finish(report());
  });
  expect(
    screen.queryByTestId("scenario-comparison-result"),
  ).not.toBeInTheDocument();
});

it("ignores a comparison response from the previous tenant", async () => {
  const api = new ApiClient();
  let finish!: (r: Report) => void;
  vi.spyOn(api, "compareRuns")
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockRejectedValue(new ApiError(404));
  const mounted = render(view(api));
  submit();
  const next = decode("ComparisonReport", university);
  mounted.rerender(view(api, next));
  expect(
    screen.queryByTestId("scenario-comparison-result"),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish(report());
  });
  expect(
    screen.queryByTestId("comparison-baseline-objective"),
  ).not.toBeInTheDocument();
});

it("shows a safe error and explicit retry for the same pair", async () => {
  const api = new ApiClient();
  const call = vi
    .spyOn(api, "compareRuns")
    .mockRejectedValueOnce(new ApiError(404))
    .mockResolvedValue(report());
  render(view(api));
  submit();
  fireEvent.click(
    await screen.findByRole("button", { name: "Réessayer cette comparaison" }),
  );
  await screen.findByTestId("scenario-comparison-result");
  expect(call.mock.calls[1]).toEqual(call.mock.calls[0]);
});

it("has an explicit empty state and no fabricated baseline", () => {
  const api = new ApiClient();
  const call = vi.spyOn(api, "compareRuns");
  render(
    <MemoryRouter>
      <PresentationContext.Provider
        value={{ mode: "business", setMode: vi.fn() }}
      >
        <ScenarioComparison
          client={api}
          organization={organization()}
          records={[]}
        />
      </PresentationContext.Provider>
    </MemoryRouter>,
  );
  expect(
    screen.getByText("Aucun résultat enregistré à comparer"),
  ).toBeInTheDocument();
  expect(call).not.toHaveBeenCalled();
});

it("transport uses one secured GET and preserves exact result values", async () => {
  const r = report();
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(JSON.stringify(r)),
  );
  vi.stubGlobal("fetch", fetch);
  const actual = await new ApiClient().compareRuns(
    r.organization_id,
    r.baseline_run_id,
    r.candidate_run_id,
  );
  expect(actual.observed_objective_delta).toBe("-600");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    method: "GET",
    credentials: "omit",
    cache: "no-store",
  });
});

it.each(["organization_id", "baseline_run_id", "candidate_run_id"] as const)(
  "rejects a comparison detached from requested %s",
  async (field) => {
    const r = report();
    r[field] = "foreign";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(r))),
    );
    await expect(
      new ApiClient().compareRuns(
        factory.organization_id,
        factory.baseline_run_id,
        factory.candidate_run_id,
      ),
    ).rejects.toThrow("incompatible");
  },
);

it.each([
  "foreign_run",
  "false_improvement",
  "unverified_objective",
  "failed_verification",
  "false_optimality",
])("fails closed on inconsistent response %s", async (kind) => {
  const r = report();
  if (!r.candidate) throw new Error("Fixture candidate required");
  if (kind === "foreign_run") r.candidate.run_id = "foreign";
  if (kind === "false_improvement") r.objective_improvement = "100";
  if (kind === "unverified_objective") r.candidate.verified_plan = false;
  if (kind === "failed_verification") r.candidate.verification.valid = false;
  if (kind === "false_optimality") {
    r.candidate.public_status = "OPTIMAL";
    r.candidate.native_status = "FEASIBLE";
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(r))),
  );
  await expect(
    new ApiClient().compareRuns(
      factory.organization_id,
      factory.baseline_run_id,
      factory.candidate_run_id,
    ),
  ).rejects.toThrow(/incompatible|incohérente/);
});

it("does not echo an integrity error body or expose a delta", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: "private historical values" }), {
          status: 409,
        }),
    ),
  );
  const r = report();
  const error = await new ApiClient()
    .compareRuns(r.organization_id, r.baseline_run_id, r.candidate_run_id)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as Error).message).toContain("intégrité");
  expect((error as Error).message).not.toContain("private historical values");
});
