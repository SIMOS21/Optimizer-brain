import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { decode } from "../src/api/validation";
import { ResultAssistant } from "../src/features/assistant/ResultAssistant";
import { PresentationContext } from "../src/shared/presentation/context";
import factory from "./fixtures/assistant-factory.json";
import university from "./fixtures/assistant-university.json";

afterEach(() => vi.unstubAllGlobals());

it("historical integrity errors never echo an API body", async () => {
  const api = new ApiClient();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: "PRIVATE_CANARY" }), {
          status: 409,
        }),
      ),
  );
  await expect(
    api.previewExplanation(
      factory.preview.organization_id,
      decode("ExplanationPreview", factory.preview).selection,
    ),
  ).rejects.toThrow("intégrité des artefacts");
});

it.each(["organization_id", "context_hash"] as const)(
  "client rejects mismatched %s",
  async (field) => {
    const api = new ApiClient();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...factory.explanation, [field]: "wrong" }),
            { status: 200 },
          ),
        ),
    );
    await expect(
      api.explain(
        factory.preview.organization_id,
        decode("ExplanationPreview", factory.preview),
      ),
    ).rejects.toThrow("faits revérifiés");
  },
);
const preview = () =>
  decode("ExplanationPreview", structuredClone(factory.preview));
const explanation = () =>
  decode("ExplanationResponse", structuredClone(factory.explanation));
function view(
  api: ApiClient,
  org = factory.preview.organization_id,
  run = factory.preview.selection.run_id,
  mode: "business" | "expert" = "business",
) {
  return (
    <MemoryRouter>
      <PresentationContext.Provider value={{ mode, setMode: vi.fn() }}>
        <ResultAssistant
          client={api}
          org={org}
          run={run}
          baseline={factory.preview.selection.baseline_run_id}
        />
      </PresentationContext.Provider>
    </MemoryRouter>
  );
}
function setup() {
  const api = new ApiClient();
  const prepared = vi
    .spyOn(api, "previewExplanation")
    .mockResolvedValue(preview());
  const send = vi.spyOn(api, "explain").mockResolvedValue(explanation());
  const rendered = render(view(api));
  return { api, prepared, send, ...rendered };
}
async function activate() {
  fireEvent.click(screen.getByRole("button", { name: "Ouvrir l’assistant" }));
  await screen.findByText(
    "NVIDIA disponible pour les artefacts publics ou synthétiques autorisés.",
  );
  fireEvent.click(screen.getByRole("checkbox"));
}

it("stays closed and never sends without explicit per-question consent", async () => {
  const { prepared, send } = setup();
  expect(prepared).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ouvrir l’assistant" }));
  await screen.findByRole("checkbox");
  expect(
    screen.getByRole("button", { name: "Demander l’explication à NVIDIA" }),
  ).toBeDisabled();
  expect(send).not.toHaveBeenCalled();
});

it.each([
  ["factory", factory, "4100", "3500"],
  ["university", university, "17", "10"],
] as const)(
  "%s renders server facts separately with no arithmetic",
  async (_sector, fixture, a, b) => {
    const api = new ApiClient();
    const p = decode("ExplanationPreview", structuredClone(fixture.preview));
    const e = decode(
      "ExplanationResponse",
      structuredClone(fixture.explanation),
    );
    vi.spyOn(api, "previewExplanation").mockResolvedValue(p);
    vi.spyOn(api, "explain").mockResolvedValue(e);
    render(view(api, p.organization_id, p.selection.run_id));
    await activate();
    fireEvent.click(
      screen.getByRole("button", { name: "Demander l’explication à NVIDIA" }),
    );
    const result = await screen.findByRole("region", {
      name: "Explication contrôlée",
    });
    expect(result).toHaveTextContent(a);
    expect(result).toHaveTextContent(b);
    expect(result).toHaveTextContent("Aucun gain économique démontré");
    expect(
      screen.getByText("Faits numériques revérifiés · source serveur"),
    ).toBeInTheDocument();
  },
);

it("rejects double clicks while an explanation is pending", async () => {
  const { send } = setup();
  let resolve!: (value: ReturnType<typeof explanation>) => void;
  send.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await activate();
  const button = screen.getByRole("button", {
    name: "Demander l’explication à NVIDIA",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => resolve(explanation()));
  await screen.findByRole("region", { name: "Explication contrôlée" });
});

it("discards a late explanation and consent immediately when the tenant changes", async () => {
  const { api, send, rerender } = setup();
  let resolve!: (value: ReturnType<typeof explanation>) => void;
  send.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await activate();
  fireEvent.click(
    screen.getByRole("button", { name: "Demander l’explication à NVIDIA" }),
  );
  rerender(view(api, "another-tenant", "other-run"));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await act(async () => resolve(explanation()));
  expect(
    screen.queryByRole("region", { name: "Explication contrôlée" }),
  ).not.toBeInTheDocument();
});

it("changing the question resets consent and previous text", async () => {
  setup();
  await activate();
  fireEvent.change(screen.getByLabelText("Question guidée"), {
    target: { value: "RESOURCES" },
  });
  await screen.findByRole("checkbox");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("retries a network error through the explanation API only", async () => {
  const { api, send } = setup();
  const solve = vi.spyOn(api, "submitJob");
  send.mockRejectedValueOnce(new Error("NVIDIA indisponible"));
  await activate();
  fireEvent.click(
    screen.getByRole("button", { name: "Demander l’explication à NVIDIA" }),
  );
  await screen.findByText("NVIDIA indisponible");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Réessayer l’explication sans résoudre",
    }),
  );
  await screen.findByRole("region", { name: "Explication contrôlée" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(solve).not.toHaveBeenCalled();
});

it.each(["DISABLED", "NOT_AUTHORIZED", "MISSING_API_KEY"] as const)(
  "%s blocks the outgoing call",
  async (availability) => {
    const { prepared, send } = setup();
    prepared.mockResolvedValue({ ...preview(), enabled: false, availability });
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir l’assistant" }));
    await screen.findByRole("checkbox");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  },
);

it("expert diagnostics contain provider and schema, never a key", async () => {
  const { api, rerender } = setup();
  rerender(view(api, undefined, undefined, "expert"));
  await activate();
  fireEvent.click(screen.getByText("Passerelle · diagnostics non sensibles"));
  expect(
    screen.getByText(/nvidia\/nemotron-3.5-lightning-30b-a3b/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/NVIDIA_API_KEY/)).not.toBeInTheDocument();
});

it("client rejects a forged generated numeric assertion", async () => {
  const api = new ApiClient();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ...explanation(), paragraphs: ["gain 999999 EUR"] }),
          { status: 200 },
        ),
      ),
  );
  await expect(
    api.explain(factory.preview.organization_id, preview()),
  ).rejects.toThrow("faits revérifiés");
});

it("session expiration clears the in-memory session", async () => {
  const expired = vi.fn();
  const api = new ApiClient(expired);
  const fetcher = vi.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        access_token: "synthetic-token",
        token_type: "bearer",
        expires_at: 9999999999,
      }),
      { status: 200 },
    ),
  );
  // Use the existing client login contract to establish a session, then expire it.
  const user = { id: "actor", username: "viewer", display_name: "Viewer" };
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify(user), { status: 200 }),
  );
  fetcher.mockResolvedValueOnce(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await api.login("viewer", "synthetic-password");
  await expect(
    api.explain(factory.preview.organization_id, preview()),
  ).rejects.toMatchObject({ name: "AbortError" });
  await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
});
