import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { PresentationProvider } from "../src/shared/presentation/PresentationProvider";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { decode } from "../src/api/validation";
import { ExecutionPanel } from "../src/features/execution/ExecutionPanel";
import { DecisionCockpit } from "../src/features/execution/DecisionCockpit";
import factory from "./fixtures/factory.json";
function render(ui: ReactElement) { return rtlRender(ui, { wrapper: PresentationProvider }); }

it("requires an explicit confirmation before any submission", async () => {
  const client = new ApiClient();
  const submit = vi.spyOn(client, "submitJob");
  render(
    <ExecutionPanel
      client={client}
      organization={decode("OrganizationResponse", factory.organization)}
      model={decode("ModelArtifactResponse", factory.model)}
      onSubmitted={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Lancer l’optimisation" }),
  );
  expect(submit).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("dialog", { name: "Confirmer le lancement" }),
  ).toBeVisible();
});

it("uses the UX-F2 native optimality guard in the historical cockpit", () => {
  const record = decode("RunArtifactResponse", structuredClone(factory.run));
  record.document.solve.status = "FEASIBLE";
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
});
