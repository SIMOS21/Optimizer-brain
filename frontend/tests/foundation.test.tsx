import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../src/api/client";
import type { Organization, Role } from "../src/api/types";
import { AuthenticatedApp } from "../src/app/AuthenticatedApp";
import { OrganizationPicker } from "../src/features/organizations/OrganizationPicker";
import { PresentationProvider } from "../src/shared/presentation/PresentationProvider";
import factory from "./fixtures/factory.json";
import university from "./fixtures/university.json";

const organization: Organization = { ...factory.organization, role: "ADMIN" };
const universityOrg: Organization = {
  ...university.organization,
  role: "ADMIN",
};
const user = {
  id: "synthetic-user",
  username: "synthetic",
  display_name: "Utilisateur synthétique",
};
const tests: Organization[] = Array.from({ length: 24 }, (_, i) => ({
  ...organization,
  id: `test_${i}`,
  key: `studio_import_${i}`,
  name: `Espace test ${String(i).padStart(2, "0")}`,
}));
function picker(items = [organization, universityOrg, ...tests]) {
  const selected = vi.fn();
  render(
    <MemoryRouter>
      <PresentationProvider>
        <OrganizationPicker
          organizations={items}
          loading={false}
          onRetry={vi.fn()}
          onSelect={selected}
        />
      </PresentationProvider>
    </MemoryRouter>,
  );
  return selected;
}
function api(role: Role = "ADMIN") {
  const client = new ApiClient();
  vi.spyOn(client, "organizations").mockResolvedValue([
    { ...organization, role },
    universityOrg,
    ...tests,
  ]);
  vi.spyOn(client, "organization").mockImplementation(async (id) => ({
    ...(id === universityOrg.id ? universityOrg : organization),
    role,
  }));
  vi.spyOn(client, "departments").mockResolvedValue([]);
  vi.spyOn(client, "artifacts").mockResolvedValue([]);
  return client;
}
function mount(client: ApiClient, path = "/", logout = vi.fn()) {
  function Back() {
    const navigate = useNavigate();
    return <button onClick={() => navigate(-1)}>Retour navigateur</button>;
  }
  return {
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <AuthenticatedApp client={client} user={user} logout={logout} />
        <Back />
      </MemoryRouter>,
    ),
    logout,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("groups only reliable test keys and bounds the first screen with 20+ spaces", () => {
  picker();
  expect(
    within(
      screen.getByRole("region", { name: "Vos organisations" }),
    ).getAllByRole("link"),
  ).toHaveLength(2);
  expect(
    within(
      screen.getByRole("region", { name: "Espaces de test" }),
    ).getAllByRole("link"),
  ).toHaveLength(6);
  expect(screen.getByRole("status")).toHaveTextContent("26 résultat(s)");
  expect(screen.getByText(/restent accessibles/)).toBeInTheDocument();
});
it("does not classify a business organization from a suggestive name", () => {
  picker([
    {
      ...organization,
      name: "Organisation synthétique importée",
      key: "business_verified",
    },
  ]);
  expect(
    screen.queryByRole("region", { name: "Espaces de test" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Organisation synthétique importée/ }),
  ).toBeInTheDocument();
});
it.each([20, 100])(
  "bounds rendered rows while keeping global search over %i organizations",
  (count) => {
    const many = Array.from({ length: count - 2 }, (_, i) => ({
      ...organization,
      id: `large_${i}`,
      key: `studio_import_large_${i}`,
      name: `Espace volumineux ${i}`,
    }));
    picker([organization, universityOrg, ...many]);
    expect(screen.getAllByRole("link")).toHaveLength(8);
    fireEvent.change(screen.getByLabelText("Rechercher une organisation"), {
      target: { value: `large_${count - 3}` },
    });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/organizations/large_${count - 3}`,
    );
  },
);
it.each(["universite", "UNIVERSITÉ", universityOrg.id, universityOrg.key])(
  "searches the complete authorized catalogue in French: %s",
  (query) => {
    picker();
    fireEvent.change(screen.getByLabelText("Rechercher une organisation"), {
      target: { value: query },
    });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/organizations/${universityOrg.id}`,
    );
  },
);
it("finds an off-page test space and keeps its real identity", () => {
  const selected = picker();
  fireEvent.change(screen.getByLabelText("Rechercher une organisation"), {
    target: { value: "test 23" },
  });
  fireEvent.click(screen.getByRole("link"));
  expect(selected).toHaveBeenCalledWith(tests[23]);
});
it("paginates without removing spaces and sorts deterministically", () => {
  picker();
  const group = within(screen.getByRole("region", { name: "Espaces de test" }));
  fireEvent.click(group.getByRole("button", { name: "Suivant" }));
  expect(
    group.getByRole("link", { name: /Espace test 06/ }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Trier les organisations"), {
    target: { value: "desc" },
  });
  expect(group.getAllByRole("link")[0]).toHaveTextContent("Espace test 23");
  expect(group.getByText("Page 1 sur 4")).toBeInTheDocument();
});
it("distinguishes no memberships from no search results", () => {
  picker();
  fireEvent.change(screen.getByLabelText("Rechercher une organisation"), {
    target: { value: "absent" },
  });
  expect(
    screen.getByRole("heading", { name: "Aucune organisation ne correspond" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Aucune organisation disponible"),
  ).not.toBeInTheDocument();
});
it("shows explicit loading, error and retry states", () => {
  const retry = vi.fn();
  const { rerender } = render(
    <MemoryRouter>
      <PresentationProvider>
        <OrganizationPicker loading onRetry={retry} onSelect={vi.fn()} />
      </PresentationProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Chargement");
  rerender(
    <MemoryRouter>
      <PresentationProvider>
        <OrganizationPicker
          loading={false}
          error="Service indisponible"
          onRetry={retry}
          onSelect={vi.fn()}
        />
      </PresentationProvider>
    </MemoryRouter>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Réessayer le chargement" }),
  );
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toHaveTextContent("Service indisponible");
});
it.each(["ADMIN", "BUILDER", "APPROVER", "VIEWER"] as const)(
  "keeps role %s and all route permissions unchanged in both modes",
  async (role) => {
    const client = api(role);
    const request = vi.spyOn(client, "request");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    mount(client, `/organizations/${organization.id}`);
    await screen.findByRole("heading", {
      name: "Une organisation. Un modèle commun.",
    });
    const toggle = screen.getByRole("switch", { name: "Mode expert" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("active-role")).toHaveTextContent(role);
    expect(
      !!screen.queryByRole("button", { name: "Enregistrer un département" }),
    ).toBe(role === "ADMIN");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("active-role")).toHaveTextContent(role);
    expect(
      !!screen.queryByRole("button", { name: "Enregistrer un département" }),
    ).toBe(role === "ADMIN");
    expect(storage).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    for (const route of [
      "graphs",
      "models",
      "execution",
      "scenarios",
      "history",
    ])
      expect(
        screen.getByRole("link", {
          name:
            route === "models"
              ? "Modèles & contraintes"
              : {
                  graphs: "Mon organisation",
                  execution: "Optimisation",
                  scenarios: "Scénarios",
                  history: "Décisions & historique",
                }[route],
        }),
      ).toHaveAttribute("href", `/organizations/${organization.id}/${route}`);
  },
);
it("resolves a deep link independently of the organization catalogue", async () => {
  const client = api();
  vi.mocked(client.organizations).mockResolvedValue([organization]);
  mount(client, `/organizations/${universityOrg.id}/graphs`);
  await screen.findByRole("heading", {
    name: "La structure, rendue explicite.",
  });
  expect(screen.getByTestId("active-organization")).toHaveTextContent(
    universityOrg.name,
  );
  expect(client.organization).toHaveBeenCalledWith(universityOrg.id);
});
it("clears the old tenant immediately and ignores a late identity response even without abort support", async () => {
  const client = api();
  let first!: (org: Organization) => void;
  let second!: (org: Organization) => void;
  vi.mocked(client.organization).mockImplementation(
    (id) =>
      new Promise((resolve) => {
        if (id === organization.id) first = resolve;
        else second = resolve;
      }),
  );
  const abort = vi.spyOn(client, "abort");
  mount(client, `/organizations/${organization.id}`);
  await waitFor(() => expect(first).toBeDefined());
  fireEvent.click(
    screen.getByRole("button", { name: "Changer d’organisation" }),
  );
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("link", {
    name: new RegExp(universityOrg.name),
  });
  fireEvent.click(
    within(dialog).getByRole("link", { name: new RegExp(universityOrg.name) }),
  );
  expect(abort).toHaveBeenCalledOnce();
  expect(screen.getByTestId("active-organization")).not.toHaveTextContent(
    organization.name,
  );
  await act(async () => second(universityOrg));
  expect(screen.getByTestId("active-organization")).toHaveTextContent(
    universityOrg.name,
  );
  await act(async () => first(organization));
  expect(screen.getByTestId("active-organization")).toHaveTextContent(
    universityOrg.name,
  );
  expect(screen.getByTestId("active-organization")).not.toHaveTextContent(
    organization.name,
  );
});
it("does not render workspace data for an inaccessible organization", async () => {
  const client = api();
  vi.mocked(client.organization).mockRejectedValue(new ApiError(404));
  mount(client, "/organizations/inaccessible/models/unknown");
  expect(
    await screen.findByRole("heading", { name: "Organisation inaccessible" }),
  ).toBeInTheDocument();
  expect(client.artifacts).not.toHaveBeenCalled();
});
it("keeps pending workspace loads alive when the current organization is selected again", async () => {
  const client = api();
  const abort = vi.spyOn(client, "abort");
  let finish!: () => void;
  vi.mocked(client.departments).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve([]);
      }),
  );
  mount(client, `/organizations/${organization.id}`);
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(
    screen.getByRole("button", { name: "Changer d’organisation" }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    await within(dialog).findByRole("link", {
      name: new RegExp(organization.name),
    }),
  );
  expect(abort).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(
    await screen.findByRole("heading", {
      name: "Une organisation. Un modèle commun.",
    }),
  ).toBeInTheDocument();
});
it("supports keyboard activation of expert mode and logout", async () => {
  const client = api();
  const { logout } = mount(client);
  await screen.findByRole("heading", { name: "Votre espace de décision" });
  const toggle = screen.getByRole("switch", { name: "Mode expert" });
  toggle.focus();
  await userEvent.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-checked", "true");
  await userEvent.click(screen.getByRole("button", { name: "Déconnexion" }));
  expect(logout).toHaveBeenCalledOnce();
});
it("restarts in business mode after a new session is mounted", async () => {
  const client = api();
  const first = mount(client);
  fireEvent.click(screen.getByRole("switch", { name: "Mode expert" }));
  first.unmount();
  mount(client);
  expect(screen.getByRole("switch", { name: "Mode expert" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
