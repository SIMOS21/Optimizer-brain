import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { decode, parsePrecise } from "../src/api/validation";
import { job } from "./execution-fixtures";

afterEach(() => vi.unstubAllGlobals());
it("decodes decimal JSON solver settings without rounding model or result decimals", () => {
  const value = JSON.stringify(job())
    .replace('"time_limit_seconds":20', '"time_limit_seconds":20.0')
    .replace('"mip_rel_gap":0', '"mip_rel_gap":0.001');
  const decoded = decode("OptimizationJobResponse", parsePrecise(value));
  expect(decoded.settings.time_limit_seconds).toBe(20);
  expect(decoded.settings.mip_rel_gap).toBe(0.001);
  expect(parsePrecise('{"coefficient":1.1234567890123456789}')).toEqual({
    coefficient: "1.1234567890123456789",
  });
  expect(
    decode(
      "Page_OptimizationJobResponse_",
      parsePrecise(`{"items":[${value}],"limit":50,"offset":0}`),
    ).items[0]?.settings.mip_rel_gap,
  ).toBe(0.001);
});
it("sends the supplied idempotency key and encoded scoped model to the secured API", async () => {
  const record = job();
  const fetch = vi.fn(async () => new Response(JSON.stringify(record)));
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient();
  await client.submitJob(
    record.organization_id,
    record.model_version_id,
    record.settings,
    "same-attempt-key",
  );
  await client.submitJob(
    record.organization_id,
    record.model_version_id,
    record.settings,
    "same-attempt-key",
  );
  const calls = fetch.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0]?.[0]).toBe(
    `/api/v1/organizations/${record.organization_id}/model-versions/${record.model_version_id}/optimization-jobs`,
  );
  expect(calls[0]?.[1].headers).toHaveProperty(
    "Idempotency-Key",
    "same-attempt-key",
  );
  expect(calls[1]?.[1].body).toBe(calls[0]?.[1].body);
  expect(calls[0]?.[1].credentials).toBe("omit");
});
it.each(["job", "cancel", "list", "submit"])(
  "rejects a foreign tenant response for %s",
  async (kind) => {
    const record = job();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              kind === "list"
                ? { items: [record], limit: 50, offset: 0 }
                : record,
            ),
          ),
      ),
    );
    const client = new ApiClient();
    const result =
      kind === "job"
        ? client.job("foreign", record.id)
        : kind === "cancel"
          ? client.cancelJob("foreign", record.id)
          : kind === "list"
            ? client.jobs("foreign")
            : client.submitJob(
                "foreign",
                record.model_version_id,
                record.settings,
                "synthetic-key",
              );
    await expect(result).rejects.toThrow("organisation");
  },
);
it("rejects an ambiguous state instead of treating it as success", () => {
  expect(() =>
    decode("OptimizationJobResponse", { ...job(), state: "DONE" }),
  ).toThrow("contrat");
});
it("does not expose a late successful response when transport ignores abort", async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    ),
  );
  const client = new ApiClient();
  const record = job();
  const request = client.job(record.organization_id, record.id);
  client.abort();
  complete(new Response(JSON.stringify(record)));
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
it("supports cancelling a single monitor read without aborting other components", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  );
  const client = new ApiClient();
  const controller = new AbortController();
  const record = job();
  const request = client.job(
    record.organization_id,
    record.id,
    controller.signal,
  );
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
