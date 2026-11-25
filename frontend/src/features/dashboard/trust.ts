/**
 * Trust qualification for optimization run artifacts.
 *
 * Reuses the exact verification logic from DecisionCockpit: a run is only
 * considered to have a verified plan when every link in the chain — solver
 * status, public status, report status, independent verification and decision
 * values — agrees. No shortcut: SUCCEEDED ≠ OPTIMAL.
 */

import type { Json, RunArtifact } from "../../api/types";

function object(value: Json | undefined): Record<string, Json> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function rows(value: Json | undefined) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const row = object(item);
        return row && typeof row.id === "string" ? [row] : [];
      })
    : [];
}

export type TrustLevel =
  | "VERIFIED_OPTIMAL"
  | "VERIFIED_FEASIBLE"
  | "INFEASIBLE"
  | "NO_SOLUTION"
  | "FAILED_VALIDATION"
  | "UNVERIFIED";

export interface TrustAssessment {
  level: TrustLevel;
  hasVerifiedPlan: boolean;
  label: string;
  description: string;
  tone: "positive" | "warning" | "danger" | "neutral";
}

/**
 * Assess the trust level of a run artifact using the same chain of checks
 * as DecisionCockpit. Never treats SUCCEEDED as OPTIMAL.
 */
export function assessTrust(record: RunArtifact): TrustAssessment {
  const { solve, report } = record.document;
  const validation = object(solve.validation_report);

  // Exact same verification chain as DecisionCockpit
  const verified =
    validation?.valid === true &&
    object(validation.plan)?.feasible === true &&
    report.has_verified_plan === true &&
    object(solve.decision_values) !== undefined &&
    ["OPTIMAL", "FEASIBLE", "TIME_LIMIT"].includes(String(solve.status)) &&
    ["OPTIMAL", "FEASIBLE_NOT_PROVEN_OPTIMAL"].includes(record.status || "") &&
    record.status === solve.public_status &&
    report.status === solve.public_status;

  if (record.status === "INFEASIBLE") {
    return {
      level: "INFEASIBLE",
      hasVerifiedPlan: false,
      label: "Modèle infaisable",
      description:
        "Le solveur a prouvé que le modèle n'admet aucune solution réalisable.",
      tone: "danger",
    };
  }

  if (
    record.status === "TIME_LIMIT_NO_SOLUTION" ||
    record.status === "SOLVER_ERROR" ||
    record.status === "UNKNOWN" ||
    record.status === "UNBOUNDED" ||
    record.status === "CANCELLED"
  ) {
    return {
      level: "NO_SOLUTION",
      hasVerifiedPlan: false,
      label: statusLabels[record.status || ""] || "Sans solution",
      description:
        statusDescriptions[record.status || ""] ||
        "Aucune solution exploitable.",
      tone: "danger",
    };
  }

  if (record.status === "SOLUTION_FAILED_VALIDATION") {
    return {
      level: "FAILED_VALIDATION",
      hasVerifiedPlan: false,
      label: "Vérification refusée",
      description:
        "Le vérificateur indépendant a refusé le résultat du solveur.",
      tone: "danger",
    };
  }

  if (record.status === "INVALID_MODEL") {
    return {
      level: "NO_SOLUTION",
      hasVerifiedPlan: false,
      label: "Modèle invalide",
      description: "Le modèle a été refusé avant résolution.",
      tone: "danger",
    };
  }

  if (verified && record.status === "OPTIMAL") {
    return {
      level: "VERIFIED_OPTIMAL",
      hasVerifiedPlan: true,
      label: "Optimal vérifié",
      description:
        "Optimalité selon les tolérances enregistrées du solveur. Vérification indépendante réussie.",
      tone: "positive",
    };
  }

  if (verified && record.status === "FEASIBLE_NOT_PROVEN_OPTIMAL") {
    return {
      level: "VERIFIED_FEASIBLE",
      hasVerifiedPlan: true,
      label: "Réalisable vérifié",
      description:
        "Un plan réalisable vérifié est disponible. L'optimalité n'est pas prouvée.",
      tone: "warning",
    };
  }

  return {
    level: "UNVERIFIED",
    hasVerifiedPlan: false,
    label: "Non vérifié",
    description:
      "Statut favorable enregistré, mais aucun plan indépendamment vérifié exploitable.",
    tone: "neutral",
  };
}

/** Extract verified decisions from report departments. */
export function extractDecisions(
  record: RunArtifact,
): { id: string; value: Json; unit: string }[] {
  const { report } = record.document;
  const seen = new Set<string>();
  const result: { id: string; value: Json; unit: string }[] = [];
  for (const department of rows(report.departments)) {
    for (const decision of rows(department.decisions)) {
      const id = String(decision.id);
      if (!seen.has(id)) {
        seen.add(id);
        result.push({
          id,
          value: decision.value,
          unit: typeof decision.unit === "string" ? decision.unit : "",
        });
      }
    }
  }
  return result;
}

/** Extract resources from report. */
export function extractResources(
  record: RunArtifact,
): {
  id: string;
  state: string;
  consumption: string;
  capacity: string;
  remaining: string;
  unit: string;
  owner: string;
}[] {
  const { report } = record.document;
  return rows(report.resources).map((r) => ({
    id: String(r.id),
    state: typeof r.state === "string" ? r.state : "",
    consumption: typeof r.consumption === "string" ? r.consumption : "",
    capacity: typeof r.capacity === "string" ? r.capacity : "",
    remaining: typeof r.remaining === "string" ? r.remaining : "",
    unit: typeof r.unit === "string" ? r.unit : "",
    owner: typeof r.owner_department === "string" ? r.owner_department : "",
  }));
}

/** Extract constraints from report. */
export function extractConstraints(
  record: RunArtifact,
): {
  id: string;
  state: string;
  lhs: string;
  rhs: string;
  slack: string;
  unit: string;
  owner: string;
}[] {
  const { report } = record.document;
  return rows(report.constraints).map((c) => ({
    id: String(c.id),
    state: typeof c.state === "string" ? c.state : "",
    lhs: typeof c.lhs === "string" ? c.lhs : "",
    rhs: typeof c.rhs === "string" ? c.rhs : "",
    slack: typeof c.slack === "string" ? c.slack : "",
    unit: typeof c.unit === "string" ? c.unit : "",
    owner: typeof c.owner_department === "string" ? c.owner_department : "",
  }));
}

const statusLabels: Record<string, string> = {
  TIME_LIMIT_NO_SOLUTION: "Temps dépassé",
  SOLVER_ERROR: "Erreur du solveur",
  UNKNOWN: "Statut inconnu",
  UNBOUNDED: "Non borné",
  CANCELLED: "Annulé",
};

const statusDescriptions: Record<string, string> = {
  TIME_LIMIT_NO_SOLUTION:
    "Limite de temps atteinte sans solution réalisable vérifiée.",
  SOLVER_ERROR:
    "La résolution n'a pas fourni de résultat mathématique exploitable.",
  UNKNOWN: "Statut insuffisant pour affirmer la faisabilité ou l'optimalité.",
  UNBOUNDED:
    "Le solveur a déclaré le problème non borné. Aucun optimum fini fourni.",
  CANCELLED: "Le calcul a été annulé avant d'aboutir.",
};
