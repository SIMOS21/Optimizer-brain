import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, canBuild, canPublish } from "../src/api/client";
import fixture from "./fixtures/factory.json";

afterEach(() => vi.unstubAllGlobals());
it.each(["ADMIN", "BUILDER", "APPROVER", "VIEWER"] as const)(
  "exposes only supported actions for %s",
  (role) => {
    expect(canBuild(role)).toBe(["ADMIN", "BUILDER"].includes(role));
    expect(canPublish(role)).toBe(["ADMIN", "APPROVER"].includes(role));
  },
);
describe.each([401, 403, 404, 409, 413, 422, 500])("HTTP %i", (status) => {
  it("shows a safe actionable error without reflecting the server body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("private content must not appear", { status }),
      ),
    );
    const client = new ApiClient();
    const error = await client
      .request("/organizations", "Page_OrganizationResponse_")
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).message).not.toContain("private content");
  });
});
it("does not use browser storage and removes authentication after clear", async () => {
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    async (url) =>
      new Response(
        JSON.stringify(
          url.endsWith("/login")
            ? {
                access_token: "synthetic-session",
                expires_at: 9999999999,
                token_type: "bearer",
              }
            : { id: "user", username: "test", display_name: "Synthetic test" },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const client = new ApiClient();
  await client.login("synthetic", "synthetic-password");
  expect(storage).not.toHaveBeenCalled();
  client.clear();
  await client.request("/auth/me", "UserResponse");
  const options = fetch.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  expect(options?.headers).not.toHaveProperty("Authorization");
  storage.mockRestore();
});
it("rejects stale requests after tenant switch abort", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  );
  const client = new ApiClient();
  const request = client.organizations();
  client.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
it("rejects a response from another tenant before exposing its document", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify(fixture.graph), { status: 200 }),
    ),
  );
  await expect(
    new ApiClient().graph("another-organization", fixture.graph.id),
  ).rejects.toThrow("organisation");
});
it("encodes untrusted route identities as a single path component", async () => {
  const fetch = vi.fn<(url: string) => Promise<Response>>(
    async () => new Response("", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  await new ApiClient()
    .graph("organization", "../../auth/me")
    .catch(() => undefined);
  expect(fetch.mock.calls[0]?.[0]).toContain("..%2F..%2Fauth%2Fme");
});
it("reports an unconfirmed remote revocation while still discarding the local token", async () => {
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    async (url) =>
      new Response(
        JSON.stringify(
          url.endsWith("/login")
            ? {
                access_token: "synthetic-session",
                expires_at: 9999999999,
                token_type: "bearer",
              }
            : { id: "user", username: "test", display_name: "Synthetic test" },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient();
  await client.login("synthetic", "synthetic-password");
  fetch.mockRejectedValueOnce(new Error("offline"));
  expect(await client.logout()).toBe(false);
  await client.request("/auth/me", "UserResponse");
  expect(fetch.mock.calls.at(-1)?.[1].headers).not.toHaveProperty(
    "Authorization",
  );
});
