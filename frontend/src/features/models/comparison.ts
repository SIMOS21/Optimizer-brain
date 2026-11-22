import type { Composition } from "../../api/types";
import { canonical } from "../../api/validation";
import { text } from "../../shared/format";

export function compareMetadata(first: Composition, second: Composition) {
  const paths: { path: string; before: string; after: string }[] = [];
  const fields = (document: Composition): Record<string, unknown> => ({
    model_name: document.organization_model.model_name,
    model_version: document.organization_model.model_version,
    graph_version: document.organization_model.graph.organization.version,
    data_snapshot_id:
      document.organization_model.graph.organization.data_snapshot_id,
    parameters: document.dsl.parameters,
  });
  function diff(a: unknown, b: unknown, path: string) {
    if (canonical(a) === canonical(b)) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      const before: Record<string, unknown> = Object.fromEntries(
        Object.entries(a),
      );
      const after: Record<string, unknown> = Object.fromEntries(
        Object.entries(b),
      );
      [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .sort()
        .forEach((key) =>
          diff(before[key], after[key], path ? `${path}.${key}` : key),
        );
    } else paths.push({ path, before: text(a), after: text(b) });
  }
  diff(fields(first), fields(second), "");
  return paths;
}
