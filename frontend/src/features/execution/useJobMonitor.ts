import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { OptimizationJob } from "../../api/types";

export function isTerminal(job: OptimizationJob) {
  return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state);
}
export function useJobMonitor(
  client: ApiClient,
  org: string,
  id: string,
  interval = 1500,
  maxReads = 300,
) {
  const [revision, setRevision] = useState(0);
  const reading = useRef<AbortController | null>(null);
  // A fresh identity immediately hides state from another resource/refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const identity = useMemo(() => ({}), [client, org, id, revision]);
  const [state, setState] = useState<{
    identity: object;
    job?: OptimizationJob;
    error?: string;
    paused?: boolean;
    received?: string;
  }>({ identity });
  useEffect(() => {
    let active = true;
    let busy = false;
    let stopped = false;
    let reads = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function read() {
      if (!active || busy || stopped || document.hidden) return;
      if (timer !== undefined) clearTimeout(timer);
      busy = true;
      reading.current = controller;
      reads += 1;
      try {
        const job = await client.job(org, id, controller.signal);
        if (!active) return;
        stopped = isTerminal(job) || reads >= maxReads;
        setState({
          identity,
          job,
          received: new Date().toLocaleTimeString("fr-FR"),
          paused: !isTerminal(job) && stopped,
        });
      } catch (error) {
        if (!active) return;
        stopped = true;
        setState({
          identity,
          error:
            error instanceof Error
              ? error.message
              : "Consultation indisponible.",
        });
      } finally {
        if (reading.current === controller) reading.current = null;
        busy = false;
        if (active && !stopped && !document.hidden)
          timer = setTimeout(() => void read(), interval);
      }
    }
    const visibility = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (!document.hidden) void read();
    };
    document.addEventListener("visibilitychange", visibility);
    void read();
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [client, org, id, identity, interval, maxReads]);
  const current: Partial<typeof state> =
    state.identity === identity ? state : {};
  return {
    ...current,
    refresh: () => {
      if (!reading.current || reading.current.signal.aborted)
        setRevision((value) => value + 1);
    },
  };
}
