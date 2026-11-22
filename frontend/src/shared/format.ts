import { canonical } from "../api/validation";

export function text(value: unknown) {
  return value === null || value === undefined
    ? "Non fourni"
    : typeof value === "object"
      ? canonical(value)
      : String(value);
}

export function unitLabel(value: unknown): string {
  if (!value || typeof value !== "object") return "Unité non fournie";
  const fields: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  if (!Array.isArray(fields.dimensions)) return "Unité non fournie";
  const labels = fields.dimensions.map((dimension: unknown) => {
    if (
      !Array.isArray(dimension) ||
      typeof dimension[0] !== "string" ||
      typeof dimension[1] !== "number"
    )
      return "?";
    return dimension[1] === 1
      ? dimension[0]
      : `${dimension[0]}^${dimension[1]}`;
  });
  return `${labels.join(" · ") || "1"}${fields.scale && fields.scale !== "1" ? ` (échelle enregistrée : ${text(fields.scale)})` : ""}`;
}
