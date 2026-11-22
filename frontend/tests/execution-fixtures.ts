import type { OptimizationJob } from "../src/api/types";
import factory from "./fixtures/factory.json";

export function job(overrides: Partial<OptimizationJob> = {}): OptimizationJob {
  return {
    id: "synthetic-job",
    organization_id: factory.organization.id,
    model_version_id: factory.model.id,
    created_by: factory.model.created_by,
    state: "QUEUED",
    settings: {
      time_limit_seconds: 20,
      mip_rel_gap: 0,
      presolve: true,
      node_limit: null,
    },
    solver_status: null,
    run_id: null,
    error_code: null,
    cancel_requested: false,
    attempt_number: 0,
    created_at: 1700000000,
    updated_at: 1700000000,
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}
