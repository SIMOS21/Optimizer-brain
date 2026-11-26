// Dev-only harness, outside the production HTML entry. Input comes from real
// synthetic GraphDocuments provisioned through the isolated, secured E2E API.
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { createRoot } from "react-dom/client";
import { GraphCanvas } from "../../src/features/graph/GraphCanvas";
import type { GraphDocument } from "../../src/api/types";
import "@xyflow/react/dist/style.css";
import "../../src/style.css";
import "../../src/styles/tokens.css";
import "../../src/styles/foundation.css";

type Commit = { phase: string; actualDuration: number; baseDuration: number };
type Metrics = { commits: Commit[]; lastCommitAt: number };
declare global {
  interface Window {
    graphBenchmark: {
      load: (document: GraphDocument) => void;
      read: () => Metrics;
      reset: () => void;
    };
  }
}
let metrics: Metrics = { commits: [], lastCommitAt: performance.now() };
const root = createRoot(document.getElementById("graph-benchmark")!);
const onRender: ProfilerOnRenderCallback = (
  _id,
  phase,
  actualDuration,
  baseDuration,
) => {
  metrics.commits.push({ phase, actualDuration, baseDuration });
  metrics.lastCommitAt = performance.now();
};
window.graphBenchmark = {
  load: (document) => {
    metrics = { commits: [], lastCommitAt: performance.now() };
    root.render(
      <Profiler id="GraphCanvas" onRender={onRender}>
        <GraphCanvas document={document} />
      </Profiler>,
    );
  },
  read: () => structuredClone(metrics),
  reset: () => {
    metrics = { commits: [], lastCommitAt: performance.now() };
  },
};
