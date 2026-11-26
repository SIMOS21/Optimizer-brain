import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { PresentationProvider } from "../src/shared/presentation/PresentationProvider";
import { PresentationContext } from "../src/shared/presentation/context";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../src/api/client";
import { decode } from "../src/api/validation";
import { ExecutionPanel } from "../src/features/execution/ExecutionPanel";
import {
  DecisionCockpit,
  StoredRun,
} from "../src/features/execution/DecisionCockpit";
import { JobMonitor } from "../src/features/execution/JobMonitor";
import { OptimizationCenter } from "../src/features/execution/OptimizationCenter";
import { job } from "./execution-fixtures";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";

const organization = decode("OrganizationResponse", factory.organization);
const model = decode("ModelArtifactResponse", factory.model);
function render(ui: ReactElement) { return rtlRender(ui, { wrapper: PresentationProvider }); }
async function launchConfirmed() {
  await userEvent.click(screen.getByRole("button", { name: "Lancer l’optimisation" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirmer le lancement" }));
}
function panel(client: ApiClient, submitted = vi.fn()) {
  return render(
    <ExecutionPanel
      client={client}
      organization={organization}
      model={model}
      onSubmitted={submitted}
    />,
  );
}
it("prevents double submission including immediate successful responses", async () => {
  const client = new ApiClient();
  const submit = vi.spyOn(client, "submitJob").mockResolvedValue(job());
  const saved = vi.fn();
  panel(client, saved);
  await userEvent.dblClick(
    screen.getByRole("button", { name: "Lancer l’optimisation" }),
  );
  expect(submit).not.toHaveBeenCalled();
  await userEvent.dblClick(screen.getByRole("button", { name: "Confirmer le lancement" }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Demande acceptée" }),
  ).toBeDisabled();
});
it("repeats an uncertain request with exactly the same body and key", async () => {
  const client = new ApiClient();
  const submit = vi
    .spyOn(client, "submitJob")
    .mockRejectedValueOnce(new Error("Réponse indisponible"))
    .mockResolvedValueOnce(job());
  panel(client);
  await launchConfirmed();
  expect(screen.getByLabelText("Temps limite (secondes)")).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Réessayer la même demande" }),
  );
  expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
});
it.each(["VIEWER", "APPROVER"] as const)("does not launch for %s", (role) => {
  const client = new ApiClient();
  const submit = vi.spyOn(client, "submitJob");
  render(
    <ExecutionPanel
      client={client}
      organization={{ ...organization, role }}
      model={model}
      onSubmitted={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Lancer l’optimisation" }),
  ).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
it("does not submit a draft or malformed settings", async () => {
  const client = new ApiClient();
  const submit = vi.spyOn(client, "submitJob");
  const view = render(
    <ExecutionPanel
      client={client}
      organization={organization}
      model={{ ...model, state: "DRAFT" }}
      onSubmitted={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Lancer l’optimisation" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <ExecutionPanel
      client={client}
      organization={organization}
      model={model}
      onSubmitted={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Temps limite (secondes)"), {
    target: { value: "301" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Lancer l’optimisation" })
      .closest("form")!,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("contrat");
  expect(submit).not.toHaveBeenCalled();
});
it.each([401, 403, 404, 409, 413, 422])(
  "handles HTTP %s on submission without automatic retries",
  async (status) => {
    const client = new ApiClient();
    const submit = vi
      .spyOn(client, "submitJob")
      .mockRejectedValue(new ApiError(status));
    panel(client);
    await launchConfirmed();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Réessayer la même demande" }),
    ).not.toBeInTheDocument();
  },
);
it("ignores a submission completed after the panel was destroyed", async () => {
  const client = new ApiClient();
  let complete!: (value: ReturnType<typeof job>) => void;
  vi.spyOn(client, "submitJob").mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const saved = vi.fn();
  const view = panel(client, saved);
  await launchConfirmed();
  view.unmount();
  await act(async () => {
    complete(job());
  });
  expect(saved).not.toHaveBeenCalled();
});
it.each([
  [factory, "4100"],
  [university, "17"],
] as const)(
  "renders only recorded verified decisions and margins",
  (fixture, objective) => {
    render(
      <MemoryRouter>
        <PresentationContext.Provider value={{ mode: "expert", setMode: vi.fn() }}><DecisionCockpit
          record={decode("RunArtifactResponse", structuredClone(fixture.run))}
        /></PresentationContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("recorded-objective")).toHaveTextContent(
      objective,
    );
    expect(screen.getByTestId("independent-verification")).toHaveTextContent(
      "réussie",
    );
    expect(
      screen.getByRole("heading", {
        name: "Contraintes et marges enregistrées",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ressources enregistrées" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("SATURATED", { selector: "td" }).length,
    ).toBeGreaterThan(0);
  },
);
it.each([
  "INFEASIBLE",
  "TIME_LIMIT_NO_SOLUTION",
  "UNBOUNDED",
  "SOLUTION_FAILED_VALIDATION",
  "UNKNOWN",
  "UNRECOGNIZED",
])("does not invent a verified plan for %s", (status) => {
  const record = decode("RunArtifactResponse", structuredClone(factory.run));
  record.status = status;
  record.document.solve.public_status = status;
  record.document.solve.status =
    status === "TIME_LIMIT_NO_SOLUTION" ? "TIME_LIMIT" : status;
  record.document.solve.decision_values = null;
  record.document.solve.objective_value = null;
  record.document.solve.best_bound = null;
  record.document.solve.validation_report = null;
  record.document.report.has_verified_plan = false;
  render(
    <MemoryRouter>
      <DecisionCockpit record={record} />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("independent-verification")).toHaveTextContent(
    "Aucun plan vérifié",
  );
  expect(screen.getByTestId("recorded-objective")).toHaveTextContent(
    "Non fourni",
  );
  expect(
    screen.queryByRole("heading", { name: "Variables de décision vérifiées" }),
  ).not.toBeInTheDocument();
});
it("shows TIME_LIMIT with a verified feasible plan separately from optimality", () => {
  const record = decode("RunArtifactResponse", structuredClone(factory.run));
  record.status = "FEASIBLE_NOT_PROVEN_OPTIMAL";
  record.document.solve.public_status = record.status;
  record.document.report.status = record.status;
  record.document.solve.status = "TIME_LIMIT";
  render(
    <MemoryRouter>
      <DecisionCockpit record={record} />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("independent-verification")).toHaveTextContent(
    "réussie",
  );
  expect(screen.getByText(/TIME_LIMIT — résolution/)).toBeInTheDocument();
  expect(
    screen.getByText(/L’optimalité n’est pas prouvée/),
  ).toBeInTheDocument();
});
it.each(["CANCELLED", "SUCCEEDED"] as const)(
  "confirms server %s after a cancellation request",
  async (state) => {
    const client = new ApiClient();
    const read = vi
      .spyOn(client, "job")
      .mockResolvedValueOnce(job({ state: "RUNNING" }))
      .mockResolvedValue(job({ state }));
    const cancel = vi
      .spyOn(client, "cancelJob")
      .mockResolvedValue(job({ state: "RUNNING", cancel_requested: true }));
    render(
      <MemoryRouter>
        <JobMonitor
          client={client}
          organization={organization}
          userId={job().created_by}
          id={job().id}
        />
      </MemoryRouter>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Demander l’annulation" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("job-state")).toHaveTextContent(state),
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
  },
);
it("shows a requested cancellation while the server still reports RUNNING", async () => {
  const client = new ApiClient();
  vi.spyOn(client, "job").mockResolvedValue(
    job({ state: "RUNNING", cancel_requested: true }),
  );
  render(
    <MemoryRouter>
      <JobMonitor
        client={client}
        organization={organization}
        userId={job().created_by}
        id={job().id}
      />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(/Annulation demandée — arrêt non encore confirmé/),
  ).toBeInTheDocument();
  expect(screen.getByTestId("job-state")).toHaveTextContent("RUNNING");
  expect(
    screen.queryByRole("button", { name: "Demander l’annulation" }),
  ).not.toBeInTheDocument();
});
it("hides cancellation for a builder who did not create the job", async () => {
  const client = new ApiClient();
  vi.spyOn(client, "job").mockResolvedValue(job({ state: "RUNNING" }));
  render(
    <MemoryRouter>
      <JobMonitor
        client={client}
        organization={{ ...organization, role: "BUILDER" }}
        userId="another-user"
        id={job().id}
      />
    </MemoryRouter>,
  );
  await screen.findByTestId("job-state");
  expect(
    screen.queryByRole("button", { name: "Demander l’annulation" }),
  ).not.toBeInTheDocument();
});
it("lists only published models and links actual jobs", async () => {
  const client = new ApiClient();
  vi.spyOn(client, "jobs").mockResolvedValue({
    items: [job()],
    limit: 50,
    offset: 0,
  });
  render(
    <MemoryRouter>
      <OptimizationCenter
        client={client}
        organization={organization}
        userId={job().created_by}
        models={[
          model,
          { ...model, id: "draft", state: "DRAFT", key: "Draft model" },
        ]}
      />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("option", { name: /Draft model/ }),
  ).not.toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Consulter ce calcul" })).toHaveAttribute(
    "href",
    `/organizations/${organization.id}/execution/${job().id}`,
  );
});
it("does not treat a favorable status with failed verification as an exploitable plan", () => {
  const record = decode("RunArtifactResponse", structuredClone(factory.run));
  record.document.solve.validation_report = { valid: false };
  render(
    <MemoryRouter>
      <DecisionCockpit record={record} />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("recorded-objective")).toHaveTextContent(
    "Non fourni",
  );
  expect(
    screen.queryByRole("heading", { name: "Variables de décision vérifiées" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      /Ne pas considérer ce résultat comme une décision validée/,
    ),
  ).toBeInTheDocument();
});
it("preserves absent bounds and gaps instead of inventing zeros", () => {
  const record = decode("RunArtifactResponse", structuredClone(factory.run));
  record.document.solve.best_bound = null;
  record.document.solve.relative_gap = null;
  record.document.solve.absolute_gap = null;
  render(
    <MemoryRouter>
      <PresentationContext.Provider value={{ mode: "expert", setMode: vi.fn() }}><DecisionCockpit record={record} /></PresentationContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.getByTestId("recorded-objective")).toHaveTextContent("4100");
  expect(screen.getAllByText("Non fourni").length).toBeGreaterThanOrEqual(3);
});
it("rejects a historical run linked to a different model than the job", async () => {
  const client = new ApiClient();
  vi.spyOn(client, "run").mockResolvedValue(
    decode("RunArtifactResponse", factory.run),
  );
  render(
    <MemoryRouter>
      <StoredRun
        client={client}
        org={organization.id}
        id={factory.run.id}
        expectedModel="another-model"
      />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "incompatible avec le modèle",
  );
  expect(screen.queryByTestId("recorded-objective")).not.toBeInTheDocument();
});
