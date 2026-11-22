import type { GraphArtifact, GraphDocument } from "../../api/types";
import { canonical } from "../../api/validation";
import { exportGraph } from "./projection";

export function prepareDraft(
  source: GraphArtifact,
  draft: GraphDocument,
  version: string,
): GraphDocument {
  if (!version.trim() || version.trim() === source.version)
    throw new Error(
      "Indiquez une nouvelle version explicite, différente de la source.",
    );
  const document = exportGraph(draft);
  document.graph.organization.version = version.trim();
  const previous = source.document;
  const dataChanged =
    canonical(document.shared_parameters) !==
    canonical(previous.shared_parameters);
  if (
    dataChanged &&
    document.graph.organization.data_snapshot_id ===
      previous.graph.organization.data_snapshot_id
  )
    throw new Error(
      "Un changement de paramètres exige un nouvel identifiant de snapshot de données.",
    );
  for (const [id, parameter] of Object.entries(document.shared_parameters)) {
    const old = previous.shared_parameters[id];
    if (
      old &&
      canonical(old) !== canonical(parameter) &&
      old.version === parameter.version
    )
      throw new Error(`Le paramètre ${id} doit porter une nouvelle version.`);
  }
  for (const node of [
    ...document.graph.departments,
    ...document.graph.resources,
  ]) {
    const old = [
      ...previous.graph.departments,
      ...previous.graph.resources,
    ].find((item) => item.id === node.id);
    if (
      old &&
      canonical(old) !== canonical(node) &&
      old.version === node.version
    )
      throw new Error(`L’objet ${node.id} doit porter une nouvelle version.`);
  }
  return document;
}
