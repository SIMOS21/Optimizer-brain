import type { ModelSource } from "../../../src/api/types";
import { factory } from "./fixtures";

/** Shared synthetic inputs; all callers publish through the secured API. */
export function syntheticExecutionSource(
  kind: "infeasible" | "limits",
): ModelSource {
  // Trusted fixture from the real API; every newly constructed input below
  // is validated/compiled again by the secured API before publication.
  const source = structuredClone(
    factory.model.document.organization_model,
  ) as ModelSource;
  const version = `execution_${Date.now()}`;
  source.model_id = `synthetic_execution_${kind}`;
  source.model_name = `Synthetic execution acceptance: ${kind}`;
  source.model_version = version;
  for (const fragment of source.fragments) {
    fragment.version = version;
    for (const ref of fragment.variable_refs ?? [])
      ref.declaration_version = version;
  }
  const sales = source.fragments.find(
    (fragment) => fragment.department_id === "sales",
  )!;
  sales.constraints ??= [];
  if (kind === "infeasible") {
    sales.constraints.push({
      id: "synthetic_impossible_minimum",
      owner_department: "sales",
      kind: "HARD",
      source: "synthetic_execution_acceptance",
      approved: true,
      version,
      terms: [
        {
          variable: "qty_A",
          coefficient: "1",
          coefficient_unit: "unit/unit",
        },
      ],
      operator: ">=",
      rhs: "41",
      unit: "unit",
    });
  } else {
    // Explicit synthetic MILP data, never inferred from business results.
    const finance = source.fragments.find(
      (fragment) => fragment.department_id === "finance",
    )!;
    sales.variables ??= [];
    finance.variable_refs ??= [];
    for (let index = 0; index < 300; index += 1) {
      const id = `synthetic_choice_${index}`;
      sales.variables.push({
        id,
        type: "BINARY",
        lb: "0",
        ub: "1",
        unit: "1",
        department: "sales",
      });
      finance.variable_refs.push({
        variable: id,
        owner_department: "sales",
        declaration_version: version,
        unit: "1",
      });
      source.objective.terms.push({
        variable: id,
        coefficient: String(((index * 19 + 7) % 97) + 1),
        coefficient_unit: "EUR",
      });
    }
    for (let row = 0; row < 15; row += 1) {
      sales.constraints.push({
        id: `synthetic_capacity_${row}`,
        owner_department: "sales",
        kind: "HARD",
        source: "synthetic_execution_acceptance",
        approved: true,
        version,
        terms: Array.from({ length: 300 }, (_, index) => ({
          variable: `synthetic_choice_${index}`,
          coefficient: String(((index * (row * 2 + 31) + row * 13) % 101) + 1),
          coefficient_unit: "1",
        })),
        operator: "<=",
        rhs: "7000",
        unit: "1",
      });
    }
  }
  return source;
}
