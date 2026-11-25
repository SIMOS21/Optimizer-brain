import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import type { Artifact, Organization, Role, RunArtifact } from "../src/api/types";
import { AuthenticatedApp } from "../src/app/AuthenticatedApp";
import { Dashboard } from "../src/features/dashboard/Dashboard";
import { PresentationProvider } from "../src/shared/presentation/PresentationProvider";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";

const factoryOrg: Organization = { ...factory.organization, role: "ADMIN" };
const universityOrg: Organization = { ...university.organization, role: "ADMIN" };
const factoryRun: RunArtifact = factory.run as unknown as RunArtifact;
const universityRun: RunArtifact = university.run as unknown as RunArtifact;

const user = {
  id: "synthetic-user",
  username: "synthetic",
  display_name: "Utilisateur synthétique",
};

function makeRunMeta(run: RunArtifact, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: run.id,
    organization_id: run.organization_id,
    created_at: run.created_at,
    created_by: run.created_by,
    content_hash: run.content_hash,
    key: run.key ?? null,
    version: run.version ?? null,
    state: run.state ?? null,
    published_by: run.published_by ?? null,
    published_at: run.published_at ?? null,
    graph_snapshot_id: run.graph_snapshot_id ?? null,
    model_hash: run.model_hash ?? null,
    data_snapshot_id: run.data_snapshot_id ?? null,
    model_version_id: run.model_version_id ?? null,
    status: run.status ?? null,
    ...overrides,
  };
}

function renderDashboard(client: ApiClient, org: Organization = factoryOrg) {
  return render(
    <MemoryRouter initialEntries={[`/organizations/${org.id}`]}>
      <PresentationProvider>
        <Dashboard client={client} organization={org} />
      </PresentationProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("displays real verified factory results (4100 EUR, decisions, resources, saturated constraints) without fetching unused collections", async () => {
  const client = new ApiClient();
  const artifactsSpy = vi
    .spyOn(client, "artifacts")
    .mockResolvedValue([makeRunMeta(factoryRun)]);
  vi.spyOn(client, "run").mockResolvedValue(factoryRun);
  const deptsSpy = vi.spyOn(client, "departments");

  renderDashboard(client, factoryOrg);

  await waitFor(() =>
    expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("4100"),
  );
  expect(screen.getByTestId("dashboard-objective-unit")).toHaveTextContent("EUR");
  expect(screen.getByTestId("dashboard-decisions")).toHaveTextContent("qty_A");
  expect(screen.getByTestId("dashboard-decisions")).toHaveTextContent("40");
  expect(screen.getByTestId("dashboard-decisions")).toHaveTextContent("qty_B");
  expect(screen.getByTestId("dashboard-decisions")).toHaveTextContent("15");
  expect(screen.getByTestId("dashboard-resources")).toHaveTextContent("95 / 100 hour");
  expect(screen.getByTestId("dashboard-resources")).toHaveTextContent("7000 / 8000 EUR");
  expect(screen.getByTestId("dashboard-resources")).toHaveTextContent("55 / 55 unit");
  expect(screen.getByTestId("dashboard-saturated")).toHaveTextContent("logistics_delivery");
  expect(screen.getByTestId("dashboard-model-version")).toHaveTextContent("v1.0.0");

  // Only optimization-runs fetched, not departments/graphs/models
  expect(artifactsSpy).toHaveBeenCalledTimes(1);
  expect(artifactsSpy).toHaveBeenCalledWith(factoryOrg.id, "optimization-runs");
  expect(deptsSpy).not.toHaveBeenCalled();
});

it("displays real verified university results (objective 17)", async () => {
  const client = new ApiClient();
  vi.spyOn(client, "artifacts").mockResolvedValue([makeRunMeta(universityRun)]);
  vi.spyOn(client, "run").mockResolvedValue(universityRun);

  renderDashboard(client, universityOrg);

  await waitFor(() =>
    expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("17"),
  );
  expect(screen.getByTestId("dashboard-latest-run")).toHaveTextContent(
    "Dernier run = Dernier plan vérifié",
  );
});

it("displays pedagogical empty state when organization has no runs and never fabricates KPIs", async () => {
  const client = new ApiClient();
  vi.spyOn(client, "artifacts").mockResolvedValue([]);

  renderDashboard(client, factoryOrg);

  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Aucun résultat disponible" }),
    ).toBeVisible(),
  );
  expect(screen.queryByTestId("dashboard-objective")).not.toBeInTheDocument();
  expect(screen.queryByText(/4100/)).not.toBeInTheDocument();
  expect(screen.queryByText(/17/)).not.toBeInTheDocument();
});

it.each([
  ["INFEASIBLE", "Modèle infaisable"],
  ["TIME_LIMIT_NO_SOLUTION", "Temps dépassé"],
  ["SOLUTION_FAILED_VALIDATION", "Vérification refusée"],
] as const)(
  "hides decisions and objective for %s status",
  async (status, expectedLabel) => {
    const badRun: RunArtifact = {
      ...factoryRun,
      id: `run-${status}`,
      status,
      document: {
        ...factoryRun.document,
        solve: {
          ...factoryRun.document.solve,
          public_status: status,
          status: status === "TIME_LIMIT_NO_SOLUTION" ? "TIME_LIMIT" : status,
          decision_values: null,
          objective_value: null,
          validation_report: { valid: false, plan: { feasible: false } },
        },
        report: {
          ...factoryRun.document.report,
          has_verified_plan: false,
          status,
        },
      },
    };
    const client = new ApiClient();
    vi.spyOn(client, "artifacts").mockResolvedValue([makeRunMeta(badRun)]);
    vi.spyOn(client, "run").mockResolvedValue(badRun);

    renderDashboard(client, factoryOrg);

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-math-status")).toHaveTextContent(
        status,
      ),
    );
    expect(screen.getByText(expectedLabel)).toBeVisible();
    expect(screen.queryByTestId("dashboard-objective")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-decisions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-resources")).not.toBeInTheDocument();
  },
);

it("never treats OPTIMAL without independent verification as a valid plan", async () => {
  const unverifiedRun: RunArtifact = {
    ...factoryRun,
    id: "run-unverified",
    status: "OPTIMAL",
    document: {
      ...factoryRun.document,
      solve: {
        ...factoryRun.document.solve,
        validation_report: { valid: false, plan: { feasible: false } },
      },
      report: {
        ...factoryRun.document.report,
        has_verified_plan: false,
      },
    },
  };
  const client = new ApiClient();
  vi.spyOn(client, "artifacts").mockResolvedValue([makeRunMeta(unverifiedRun)]);
  vi.spyOn(client, "run").mockResolvedValue(unverifiedRun);

  renderDashboard(client, factoryOrg);

  await waitFor(() =>
    expect(screen.getByText("Non vérifié")).toBeVisible(),
  );
  expect(screen.queryByTestId("dashboard-objective")).not.toBeInTheDocument();
  expect(screen.queryByTestId("dashboard-decisions")).not.toBeInTheDocument();
});

it("distinguishes latest unverified/infeasible run from earlier verified plan", async () => {
  const infeasibleRun: RunArtifact = {
    ...factoryRun,
    id: "run-latest-infeasible",
    created_at: factoryRun.created_at + 100,
    status: "INFEASIBLE",
    document: {
      ...factoryRun.document,
      solve: {
        ...factoryRun.document.solve,
        public_status: "INFEASIBLE",
        status: "INFEASIBLE",
        decision_values: null,
        objective_value: null,
        validation_report: { valid: false, plan: { feasible: false } },
      },
      report: {
        ...factoryRun.document.report,
        has_verified_plan: false,
        status: "INFEASIBLE",
      },
    },
  };
  const client = new ApiClient();
  vi.spyOn(client, "artifacts").mockResolvedValue([
    makeRunMeta(factoryRun),
    makeRunMeta(infeasibleRun),
  ]);
  vi.spyOn(client, "run").mockImplementation(async (_org, id) =>
    id === infeasibleRun.id ? infeasibleRun : factoryRun,
  );

  renderDashboard(client, factoryOrg);

  await waitFor(() =>
    expect(screen.getByTestId("dashboard-math-status")).toHaveTextContent(
      "INFEASIBLE",
    ),
  );
  expect(screen.getByText("Dernier run disponible")).toBeVisible();
  expect(screen.getByTestId("dashboard-verified-plan")).toHaveTextContent("4100");
  expect(screen.queryByTestId("dashboard-objective")).not.toBeInTheDocument();
});

it("supports FEASIBLE_NOT_PROVEN_OPTIMAL with verified plan", async () => {
  const feasibleRun: RunArtifact = {
    ...factoryRun,
    id: "run-feasible",
    status: "FEASIBLE_NOT_PROVEN_OPTIMAL",
    document: {
      ...factoryRun.document,
      solve: {
        ...factoryRun.document.solve,
        public_status: "FEASIBLE_NOT_PROVEN_OPTIMAL",
        status: "TIME_LIMIT",
      },
      report: {
        ...factoryRun.document.report,
        status: "FEASIBLE_NOT_PROVEN_OPTIMAL",
      },
    },
  };
  const client = new ApiClient();
  vi.spyOn(client, "artifacts").mockResolvedValue([makeRunMeta(feasibleRun)]);
  vi.spyOn(client, "run").mockResolvedValue(feasibleRun);

  renderDashboard(client, factoryOrg);

  await waitFor(() =>
    expect(screen.getByText("Réalisable vérifié")).toBeVisible(),
  );
  expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("4100");
});

it("provides local retry when loading runs fails", async () => {
  const userActor = userEvent.setup();
  const client = new ApiClient();
  const artifactsSpy = vi
    .spyOn(client, "artifacts")
    .mockRejectedValueOnce(new Error("Erreur réseau simulée"))
    .mockResolvedValueOnce([makeRunMeta(factoryRun)]);
  vi.spyOn(client, "run").mockResolvedValue(factoryRun);

  renderDashboard(client, factoryOrg);

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Erreur réseau simulée"),
  );
  await userActor.click(screen.getByTestId("dashboard-retry"));
  await waitFor(() =>
    expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("4100"),
  );
  expect(artifactsSpy).toHaveBeenCalledTimes(2);
});

it("respects VIEWER vs BUILDER permissions in business and expert modes", async () => {
  const userActor = userEvent.setup();
  const client = new ApiClient();
  vi.spyOn(client, "organizations").mockResolvedValue([
    { ...factoryOrg, role: "VIEWER" },
  ]);
  vi.spyOn(client, "organization").mockResolvedValue({
    ...factoryOrg,
    role: "VIEWER",
  });
  vi.spyOn(client, "artifacts").mockResolvedValue([makeRunMeta(factoryRun)]);
  vi.spyOn(client, "run").mockResolvedValue(factoryRun);

  render(
    <MemoryRouter initialEntries={[`/organizations/${factoryOrg.id}`]}>
      <AuthenticatedApp client={client} user={user} logout={vi.fn()} />
    </MemoryRouter>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("4100"),
  );
  expect(
    screen.queryByRole("link", { name: "Lancer une optimisation" }),
  ).not.toBeInTheDocument();

  // Switch to expert mode: reveals provenance, still no write CTA for VIEWER
  await userActor.click(screen.getByRole("switch", { name: "Mode expert" }));
  expect(screen.getByTestId("dashboard-expert-provenance")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Lancer une optimisation" }),
  ).not.toBeInTheDocument();
});

it("isolates organizations on switch without leaking previous tenant values", async () => {
  const userActor = userEvent.setup();
  const client = new ApiClient();
  vi.spyOn(client, "organizations").mockResolvedValue([
    factoryOrg,
    universityOrg,
  ]);
  vi.spyOn(client, "organization").mockImplementation(async (id) =>
    id === universityOrg.id ? universityOrg : factoryOrg,
  );
  vi.spyOn(client, "artifacts").mockImplementation(async (orgId) =>
    orgId === universityOrg.id
      ? [makeRunMeta(universityRun)]
      : [makeRunMeta(factoryRun)],
  );
  vi.spyOn(client, "run").mockImplementation(async (orgId) =>
    orgId === universityOrg.id ? universityRun : factoryRun,
  );

  render(
    <MemoryRouter initialEntries={[`/organizations/${factoryOrg.id}`]}>
      <AuthenticatedApp client={client} user={user} logout={vi.fn()} />
    </MemoryRouter>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("4100"),
  );

  await userActor.click(
    screen.getByRole("button", { name: "Changer d’organisation" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Choisir une organisation" });
  await userActor.click(
    within(dialog).getByRole("link", { name: new RegExp(universityOrg.name) }),
  );

  await waitFor(() =>
    expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("17"),
  );
  expect(screen.queryByText("4100")).not.toBeInTheDocument();
});

it("paginates recent runs deterministically", async () => {
  const runs: Artifact[] = Array.from({ length: 7 }, (_, i) =>
    makeRunMeta(factoryRun, {
      id: `run-${i}`,
      created_at: 1700000000 + i * 10,
      status: i === 6 ? "OPTIMAL" : "INFEASIBLE",
    }),
  );
  const client = new ApiClient();
  vi.spyOn(client, "artifacts").mockResolvedValue(runs);
  vi.spyOn(client, "run").mockResolvedValue(factoryRun);

  renderDashboard(client, factoryOrg);

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /Runs récents \(7\)/ })).toBeVisible(),
  );
  const region = screen.getByRole("region", { name: "Runs récents" });
  expect(within(region).getAllByRole("button", { pressed: undefined })).toBeTruthy();
  expect(within(region).getByText("Page 1 / 2")).toBeVisible();
  fireEvent.click(within(region).getByRole("button", { name: "Suivant" }));
  expect(within(region).getByText("Page 2 / 2")).toBeVisible();
});

it("works for BUILDER role with optimization CTA", async () => {
  const builderOrg: Organization = { ...factoryOrg, role: "BUILDER" as Role };
  const client = new ApiClient();
  vi.spyOn(client, "artifacts").mockResolvedValue([makeRunMeta(factoryRun)]);
  vi.spyOn(client, "run").mockResolvedValue(factoryRun);

  renderDashboard(client, builderOrg);

  await waitFor(() =>
    expect(screen.getByTestId("dashboard-objective")).toHaveTextContent("4100"),
  );
  expect(
    screen.getByRole("link", { name: "Lancer une optimisation" }),
  ).toBeVisible();
});
