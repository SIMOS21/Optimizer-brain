"""Read-only 5B.3 contracts. All computed quantities are exact rational strings."""

from typing import Literal

from pydantic import JsonValue

from brain.kernel.schema import StrictModel


class ComparisonReason(StrictModel):
    code: str
    message: str
    side: Literal["BASELINE", "CANDIDATE", "PAIR"] = "PAIR"


class ComparedRun(StrictModel):
    run_id: str
    organization_id: str
    content_hash: str
    created_at: int
    created_by: str
    started_at: str
    model_version_id: str
    model_id: str
    model_name: str
    model_version: str
    model_content_hash: str
    model_hash: str
    manifest_hash: str
    graph_snapshot_id: str
    graph_content_hash: str
    data_snapshot_id: str
    reference_model_version_id: str
    reference_content_hash: str
    scenario_id: str
    scenario_version_id: str | None
    scenario_content_hash: str | None
    scenario_name: str | None
    assumptions: tuple[dict[str, JsonValue], ...]
    public_status: str
    native_status: str
    verified_plan: bool
    verification_issues: tuple[str, ...]
    objective_id: str
    objective_sense: Literal["MAX", "MIN"]
    objective_unit: str
    objective_value: str | None
    metric_fingerprint: str
    verification: dict[str, JsonValue]
    native_evidence: dict[str, JsonValue]


class DecisionDifference(StrictModel):
    id: str
    department: str
    unit: str | None
    baseline_unit: str | None
    candidate_unit: str | None
    baseline_value: str | None
    candidate_value: str | None
    delta: str | None


class ResourceMeasure(StrictModel):
    unit: str
    capacity: str
    consumption: str | None
    remaining: str | None
    state: Literal["SATURATED", "SATISFIED", "VIOLATED", "UNAVAILABLE", "UNMODELED"]


class ResourceDifference(StrictModel):
    id: str
    department: str
    unit: str | None
    baseline: ResourceMeasure | None
    candidate: ResourceMeasure | None
    capacity_delta: str | None
    consumption_delta: str | None
    remaining_delta: str | None


class ConstraintMeasure(StrictModel):
    unit: str
    lhs: str | None
    rhs: str
    slack: str | None
    state: Literal["SATURATED", "SATISFIED", "VIOLATED", "UNAVAILABLE"]
    tolerance: str


class ConstraintDifference(StrictModel):
    id: str
    department: str
    unit: str | None
    baseline: ConstraintMeasure | None
    candidate: ConstraintMeasure | None
    slack_delta: str | None


class ComparisonReport(StrictModel):
    schema_version: Literal["5B.3"] = "5B.3"
    algorithm_version: Literal["verified-comparison-1"] = "verified-comparison-1"
    organization_id: str
    baseline_run_id: str | None
    candidate_run_id: str | None
    baseline: ComparedRun | None
    candidate: ComparedRun | None
    comparability: Literal["COMPARABLE", "QUALIFIED", "NOT_COMPARABLE", "INCOMPLETE"]
    claim: Literal["VERIFIED_OBJECTIVE_IMPROVEMENT", "OBSERVED_DIFFERENCE", "NONE"]
    message: str
    same_model_and_snapshot: bool
    reasons: tuple[ComparisonReason, ...]
    observed_objective_delta: str | None
    oriented_objective_delta: str | None
    objective_unit: str | None
    objective_improvement: str | None
    objective_improvement_percent: str | None
    improvement_tolerance: str | None
    economic_gain: None = None
    economic_gain_status: Literal["NOT_DEMONSTRATED"] = "NOT_DEMONSTRATED"
    decisions: tuple[DecisionDifference, ...]
    resources: tuple[ResourceDifference, ...]
    constraints: tuple[ConstraintDifference, ...]
    limitations: tuple[str, ...] = (
        "Une différence entre scénarios n’est pas un gain économique démontré.",
        "Les vérifications portent sur les IR originales et les tolérances enregistrées.",
        "Les bornes et gaps natifs gardent leur portée binary64 ; aucun certificat n’est ajouté.",
        "Les coûts présents dans la formule de l’objectif sont inclus ; aucun coût omis n’est estimé.",
        "La saturation d’une contrainte ne prouve ni prix d’ombre ni bénéfice économique.",
    )
    report_hash: str
