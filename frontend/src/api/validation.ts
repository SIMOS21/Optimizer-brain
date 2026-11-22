import Ajv from "ajv/dist/2020";
import { parse } from "lossless-json";
import contract from "./openapi.json";
import type { Schemas, GraphDocument } from "./types";
import type { components } from "./generated";

function normalizeGraph(
  document: components["schemas"]["GraphCreate-Output"],
): GraphDocument {
  return {
    ...document,
    graph: {
      ...document.graph,
      edges: document.graph.edges ?? [],
      resources: (document.graph.resources ?? []).map((resource) => ({
        ...resource,
        shared_with: resource.shared_with ?? [],
      })),
    },
  };
}

const ajv = new Ajv({
  strict: false,
  validateFormats: false,
  allErrors: false,
});
// OpenAPI 3.1 component schemas are JSON Schema; preserve the original contract.
ajv.addSchema({ $id: "urn:brain:contract", components: contract.components });

export function decode<K extends keyof Schemas>(
  schema: K,
  value: unknown,
): Schemas[K] {
  const validate = ajv.getSchema<Schemas[K]>(
    `urn:brain:contract#/components/schemas/${schema}`,
  );
  if (!validate || validate(value) !== true) {
    const path = validate?.errors?.[0]?.instancePath || "/";
    throw new Error(`Document incompatible avec le contrat (${path}).`);
  }
  // Assertions follow runtime validation against the generated server schema.
  if (schema === "GraphCreate-Output")
    return normalizeGraph(
      value as components["schemas"]["GraphCreate-Output"],
    ) as Schemas[K];
  if (schema === "GraphArtifactResponse") {
    const record = value as components["schemas"]["GraphArtifactResponse"];
    return {
      ...record,
      document: normalizeGraph(record.document),
    } as Schemas[K];
  }
  return value as Schemas[K];
}

export function parsePrecise(text: string): unknown {
  // Decimal values stay textual; only safe integral JSON metadata becomes a number.
  try {
    return parse(text, undefined, (value: string) => {
      const number = Number(value);
      return /^-?\d+$/.test(value) && Number.isSafeInteger(number)
        ? number
        : value;
    });
  } catch {
    throw new Error(
      "JSON invalide ou ambigu. Contrôlez la structure et les valeurs.",
    );
  }
}

export function canonical(value: unknown): string {
  function sort(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, sort(entry)]),
      );
    return item;
  }
  return JSON.stringify(sort(value), null, 2);
}
