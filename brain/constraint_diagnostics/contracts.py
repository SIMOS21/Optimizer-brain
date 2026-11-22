"""Read-only, versioned diagnostic contracts; all mathematical values are exact strings."""

from typing import Literal

from brain.kernel.schema import StrictModel


class ConstraintLink(StrictModel):
    constraint_id: str
    department: str
    source: str
    approved: bool
    version: str
    fragment_ids: tuple[str, ...] = ()
    contribution_ids: tuple[str, ...] = ()
    parameter_ids: tuple[str, ...] = ()
    resource_id: str | None = None
    source_paths: tuple[str, ...] = ()


class Finding(StrictModel):
    code: str
    message: str
    constraints: tuple[ConstraintLink, ...] = ()
    variable_ids: tuple[str, ...] = ()
    variable_departments: tuple[tuple[str, str], ...] = ()
    path: str | None = None
    # Checkable evidence, never a proposed relaxation or an IIS claim.
    facts: tuple[tuple[str, str], ...] = ()


class ConstraintActivity(StrictModel):
    constraint: ConstraintLink
    state: Literal["SATISFIED", "SATURATED", "VIOLATED", "UNAVAILABLE"]
    lhs: str | None
    rhs: str
    slack: str | None
    violation: str | None
    tolerance: str | None
    unit_dimensions: tuple[tuple[str, int], ...]
    unit_scale: str
    cost_status: Literal["NOT_EVALUATED"] = "NOT_EVALUATED"


class DiagnosticsReport(StrictModel):
    schema_version: Literal["5A.1"] = "5A.1"
    model_id: str | None
    model_version: str | None
    model_hash: str | None
    manifest_hash: str | None
    data_snapshot_id: str | None
    scenario_id: str | None
    composition_manifest_hash: str | None = None
    validation: Literal["VALID", "INVALID_MODEL"]
    static_conclusion: Literal["CONTRADICTION_PROVEN", "NO_CONCLUSION", "NOT_ANALYZED"]
    findings: tuple[Finding, ...]
    activities: tuple[ConstraintActivity, ...]
    solver_status: str | None = None
    infeasibility_evidence: Literal["STATIC_PROOF", "SOLVER_REPORTED", "NONE"]
    iis_available: Literal[False] = False
    plan_checked: bool = False
    plan_valid: bool | None = None
    plan_issues: tuple[str, ...] = ()
    limitations: tuple[str, ...] = (
        "Analyse incomplète : l'absence de contradiction détectée ne prouve pas la faisabilité.",
        "Les preuves statiques portent sur le modèle rationnel exact, sans tolérance solveur.",
        "Aucun IIS fourni ; les contraintes citées ne constituent pas un conflit minimal.",
        "Coûts non évalués : aucune sensibilité ni aucun prix d'ombre exposé par ce backend.",
        "Saturation et violation décrivent le plan contrôlé, pas une cause d'infaisabilité.",
    )
