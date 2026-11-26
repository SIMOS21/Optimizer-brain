import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../src/api/client";
import { useJobMonitor } from "../src/features/execution/useJobMonitor";
import { job } from "./execution-fixtures";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("follows real transitions and stops reading at a terminal state", async () => {
  const client = new ApiClient();
  const read = vi
    .spyOn(client, "job")
    .mockResolvedValueOnce(job())
    .mockResolvedValueOnce(job({ state: "RUNNING" }))
    .mockResolvedValueOnce(job({ state: "CANCELLED" }));
  const { result } = renderHook(() =>
    useJobMonitor(client, job().organization_id, job().id, 100),
  );
  await act(async () => {});
  expect(result.current.job?.state).toBe("QUEUED");
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(result.current.job?.state).toBe("RUNNING");
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(result.current.job?.state).toBe("CANCELLED");
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(read).toHaveBeenCalledTimes(3);
});
it("never overlaps automatic GETs and waits until completion before scheduling", async () => {
  const client = new ApiClient();
  let complete!: (record: ReturnType<typeof job>) => void;
  const read = vi
    .spyOn(client, "job")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(job({ state: "RUNNING" }));
  renderHook(() => useJobMonitor(client, job().organization_id, job().id, 100));
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => complete(job()));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(read).toHaveBeenCalledTimes(2);
});
it("does not overlap a manual refresh with a pending job read", async () => {
  const client = new ApiClient();
  let complete!: (record: ReturnType<typeof job>) => void;
  const read = vi
    .spyOn(client, "job")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(job());
  const { result } = renderHook(() =>
    useJobMonitor(client, job().organization_id, job().id, 100),
  );
  await act(async () => result.current.refresh());
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => complete(job()));
  await act(async () => result.current.refresh());
  expect(read).toHaveBeenCalledTimes(2);
});
it("bounds automatic reads and resumes only on an explicit refresh", async () => {
  const client = new ApiClient();
  const read = vi.spyOn(client, "job").mockResolvedValue(job());
  const { result } = renderHook(() =>
    useJobMonitor(client, job().organization_id, job().id, 100, 2),
  );
  await act(async () => {});
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(read).toHaveBeenCalledTimes(2);
  expect(result.current.paused).toBe(true);
  await act(async () => result.current.refresh());
  expect(read).toHaveBeenCalledTimes(3);
});
it.each([401, 403, 404, 409, 422])(
  "stops and clears previously displayed job on HTTP %s",
  async (status) => {
    const client = new ApiClient();
    const read = vi
      .spyOn(client, "job")
      .mockResolvedValueOnce(job())
      .mockRejectedValue(new ApiError(status));
    const { result } = renderHook(() =>
      useJobMonitor(client, job().organization_id, job().id, 100),
    );
    await act(async () => {});
    expect(result.current.job).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.job).toBeUndefined();
    expect(result.current.error).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(read).toHaveBeenCalledTimes(2);
  },
);
it("invalidates a late old tenant response and aborts its read on navigation", async () => {
  const client = new ApiClient();
  let complete!: (record: ReturnType<typeof job>) => void;
  const read = vi
    .spyOn(client, "job")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(job({ id: "second-job", organization_id: "second" }));
  const { result, rerender } = renderHook(
    ({ org, id }) => useJobMonitor(client, org, id, 100),
    { initialProps: { org: "first", id: "first-job" } },
  );
  rerender({ org: "second", id: "second-job" });
  await act(async () => {});
  expect(read.mock.calls[0]?.[2]?.aborted).toBe(true);
  expect(result.current.job?.organization_id).toBe("second");
  await act(async () => complete(job({ organization_id: "first" })));
  expect(result.current.job?.organization_id).toBe("second");
});
it("pauses while hidden and resumes on visibility without a request burst", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const client = new ApiClient();
  const read = vi.spyOn(client, "job").mockResolvedValue(job());
  renderHook(() => useJobMonitor(client, job().organization_id, job().id, 100));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(read).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(read).toHaveBeenCalledTimes(1);
});
