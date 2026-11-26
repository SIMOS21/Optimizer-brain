import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import type { RunArtifact } from "../src/api/types";
import { decode } from "../src/api/validation";
import { History } from "../src/features/history/History";
import {
  PresentationContext,
  type PresentationMode,
} from "../src/shared/presentation/context";
import { job } from "./execution-fixtures";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";

const original = () =>
  decode("RunArtifactResponse", structuredClone(factory.run));
const organization = decode("OrganizationResponse", factory.organization);
function metadata(record: RunArtifact) {
  return decode("ArtifactResponse", { ...record, document: null });
}
function view(
  api: ApiClient,
  records: RunArtifact[],
  mode: PresentationMode = "business",
  org = organization,
) {
  return (
    <MemoryRouter>
      <PresentationContext.Provider value={{ mode, setMode: vi.fn() }}>
        <History
          client={api}
          organization={org}
          records={records.map(metadata)}
        />
      </PresentationContext.Provider>
    </MemoryRouter>
  );
}
function client(records: RunArtifact[]) {
  const api = new ApiClient();
  vi.spyOn(api, "run").mockImplementation(async (_org, id) =>
    records.find((r) => r.id === id)!,
  );
  vi.spyOn(api, "jobs").mockResolvedValue({ items: [], limit: 50, offset: 0 });
  return api;
}

for (const mode of ["business", "expert"] as const) {
  it.each([
    ["OPTIMAL", "OPTIMAL", true],
    ["FEASIBLE_NOT_PROVEN_OPTIMAL", "TIME_LIMIT", true],
    ["INFEASIBLE", "INFEASIBLE", false],
    ["TIME_LIMIT_NO_SOLUTION", "TIME_LIMIT", false],
    ["SOLUTION_FAILED_VALIDATION", "SOLUTION_FAILED_VALIDATION", false],
    ["UNBOUNDED", "UNBOUNDED", false],
    ["SOLVER_ERROR", "ERROR", false],
    ["OPTIMAL", "FEASIBLE", false],
  ] as const)(
    `${mode}: qualifies %s independently from a SUCCEEDED job (%s)`,
    async (status, native, verified) => {
      const record = original();
      record.status =
        record.document.solve.public_status =
        record.document.report.status =
          status;
      record.document.solve.status = native;
      const api = client([record]);
      vi.mocked(api.jobs).mockResolvedValue({
        items: [job({ state: "SUCCEEDED", run_id: record.id })],
        limit: 50,
        offset: 0,
      });
      const rendered = render(view(api, [record], mode));
      const card = await screen.findByTestId("history-card");
      await waitFor(() =>
        expect(within(card).getByTestId("history-job-state")).toHaveTextContent(
          "SUCCEEDED",
        ),
      );
      expect(card).toHaveTextContent(status);
      expect(
        rendered.container.querySelector(".history-objective") !== null,
      ).toBe(verified);
      expect(
        within(card).getByRole("link", { name: "Ouvrir le résultat complet" }),
      ).toHaveAttribute(
        "href",
        `/organizations/${organization.id}/history/${record.id}`,
      );
    },
  );
}

it.each(["FEASIBLE", "TIME_LIMIT"])(
  "displays a verified feasible plan with the actual native report status %s",
  async (native) => {
    const record = original();
    record.status = record.document.solve.public_status =
      "FEASIBLE_NOT_PROVEN_OPTIMAL";
    record.document.solve.status = record.document.report.status = native;
    render(view(client([record]), [record]));
    const card = await screen.findByTestId("history-card");
    expect(card).toHaveTextContent("Réalisable vérifié");
    expect(card.querySelector(".history-objective")).not.toBeNull();
    expect(card).not.toHaveTextContent("Optimal vérifié");
  },
);

it.each(["UNKNOWN", "OPTIMAL", "INFEASIBLE"])(
  "rejects a feasible run with an inconsistent native report status %s",
  async (reportStatus) => {
    const record = original();
    record.status = record.document.solve.public_status =
      "FEASIBLE_NOT_PROVEN_OPTIMAL";
    record.document.solve.status = "FEASIBLE";
    record.document.report.status = reportStatus;
    render(view(client([record]), [record]));
    const card = await screen.findByTestId("history-card");
    expect(card).toHaveTextContent("Non vérifié");
    expect(card.querySelector(".history-objective")).toBeNull();
  },
);

it("does not infer a technical success from a stored run without a matching job", async () => {
  const record = original();
  const api = client([record]);
  render(view(api, [record]));
  const card = await screen.findByTestId("history-card");
  expect(within(card).getByTestId("history-job-state")).toHaveTextContent(
    "Non fourni",
  );
  expect(card).not.toHaveTextContent("SUCCEEDED");
});

it("rejects a job linked to another model even if its run id matches", async () => {
  const record = original();
  const api = client([record]);
  vi.mocked(api.jobs).mockResolvedValue({
    items: [
      job({ state: "SUCCEEDED", run_id: record.id, model_version_id: "other" }),
    ],
    limit: 50,
    offset: 0,
  });
  render(view(api, [record]));
  expect(
    within(await screen.findByTestId("history-card")).getByTestId(
      "history-job-state",
    ),
  ).toHaveTextContent("Non fourni");
});

it("reads at most five summaries per page and preserves direct access to older runs", async () => {
  const records = Array.from({ length: 7 }, (_, i) => ({
    ...original(),
    id: `run_${i}`,
    created_at: i + 10,
  }));
  const api = client(records);
  render(view(api, records));
  await waitFor(() =>
    expect(screen.getAllByTestId("history-card")).toHaveLength(5),
  );
  expect(api.run).toHaveBeenCalledTimes(5);
  expect(
    screen.getByLabelText("Résultat historique").querySelectorAll("option"),
  ).toHaveLength(8);
  fireEvent.click(screen.getByRole("button", { name: "Résultats suivants" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("history-card")).toHaveLength(2),
  );
  expect(api.run).toHaveBeenCalledTimes(7);
  fireEvent.change(
    screen.getByLabelText("Rechercher un run, un modèle ou un snapshot"),
    { target: { value: "absent" } },
  );
  expect(screen.getByText("Aucun résultat pour ces filtres")).toBeVisible();
  expect(screen.queryByTestId("recorded-objective")).not.toBeInTheDocument();
});

it("does not display favorable metadata as a verified plan after an invalid independent check", async () => {
  const record = original();
  record.document.solve.validation_report = {
    valid: false,
    plan: { feasible: false },
  };
  const api = client([record]);
  const rendered = render(view(api, [record]));
  const card = await screen.findByTestId("history-card");
  expect(card).toHaveTextContent("Non vérifié");
  expect(rendered.container.querySelector(".history-objective")).toBeNull();
});

it("removes an old tenant immediately and ignores its late summary", async () => {
  const old = original();
  const next = decode("RunArtifactResponse", university.run);
  const nextOrg = decode("OrganizationResponse", university.organization);
  const api = client([old, next]);
  let finish!: (record: RunArtifact) => void;
  vi.mocked(api.run).mockImplementation((_org, id) =>
    id === old.id
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(next),
  );
  const rendered = render(view(api, [old]));
  rendered.rerender(view(api, [next], "business", nextOrg));
  await screen.findByTestId("history-card");
  await act(async () => finish(old));
  expect(rendered.container).not.toHaveTextContent(
    old.document.solve.model_id as string,
  );
  expect(rendered.container).toHaveTextContent(
    next.document.solve.model_id as string,
  );
});

it("retains exact recorded fractional and decimal objective strings", async () => {
  const record = original();
  record.document.solve.objective_value = "1/3";
  const api = client([record]);
  const rendered = render(view(api, [record]));
  await screen.findByTestId("history-card");
  expect(
    rendered.container.querySelector(".history-objective"),
  ).toHaveTextContent("1/3");
});
