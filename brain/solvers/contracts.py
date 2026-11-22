"""Domain-independent solver and run contracts."""

from dataclasses import dataclass
from fractions import Fraction
from typing import Literal, Protocol

from pydantic import Field

from brain.kernel.ir import OptimizationIR, to_data
from brain.kernel.units import Unit
from brain.kernel.schema import StrictModel
from brain.kernel.verification import SolutionVerification, VerificationSettings

Status = Literal[
    "OPTIMAL",
    "FEASIBLE",
    "INFEASIBLE",
    "UNBOUNDED",
    "TIME_LIMIT",
    "ERROR",
    "SOLUTION_FAILED_VALIDATION",
    "UNKNOWN",
    "INVALID_MODEL",
]
Option = str | float | int | bool | None


class SolveSettings(StrictModel):
    time_limit_seconds: float = Field(default=20.0, gt=0, le=300)
    mip_rel_gap: float = Field(default=0.0, ge=0, le=1)
    presolve: bool = True
    node_limit: int | None = Field(default=None, ge=0, le=2147483647)
    verification: VerificationSettings = Field(default_factory=VerificationSettings)


@dataclass(frozen=True)
class SolverCapabilities:
    name: str
    solver_version: str | None
    interface_name: str
    interface_version: str
    domains: tuple[str, ...] = ("CONTINUOUS", "INTEGER", "BINARY")
    operators: tuple[str, ...] = ("<=", ">=", "==")
    senses: tuple[str, ...] = ("MAX", "MIN")
    multiple_objectives: bool = False


@dataclass(frozen=True)
class ConversionReport:
    converted_count: int
    rounded_count: int
    max_absolute_error: Fraction
    max_relative_error: Fraction
    policy: str = (
        "binary64; abs(value)<=1e12; nonzero coefficients>1e-9; relative conversion error<=1e-12"
    )


@dataclass(frozen=True)
class SupportReport:
    supported: bool
    issues: tuple[str, ...] = ()
    conversion: ConversionReport | None = None


@dataclass(frozen=True)
class RawSolveResult:
    status_code: int | None
    message: str
    termination_reason: str
    decisions: tuple[tuple[str, float], ...] | None
    objective: float | None
    best_bound: float | None
    relative_gap: float | None
    options: tuple[tuple[str, Option], ...]
    backend_defaults: tuple[tuple[str, Option], ...] = ()


class SolverAdapter(Protocol):
    def supports(self, model: OptimizationIR) -> SupportReport: ...
    def solve(self, model: OptimizationIR, settings: SolveSettings) -> RawSolveResult: ...
    def get_capabilities(self) -> SolverCapabilities: ...


@dataclass(frozen=True)
class SolveResult:
    run_id: str
    status: Status
    public_status: str
    termination_reason: str
    model_id: str | None
    model_version: str | None
    data_snapshot_id: str | None
    scenario_id: str | None
    model_hash: str | None
    manifest_hash: str | None
    solver_name: str
    solver_version: str | None
    interface_name: str
    interface_version: str
    solver_status_raw: int | None
    solver_message: str
    solver_options: tuple[tuple[str, Option], ...]
    backend_defaults: tuple[tuple[str, Option], ...]
    settings: SolveSettings
    started_at: str
    duration_ms: float
    decision_values: tuple[tuple[str, float], ...] | None
    objective_value: Fraction | None
    objective_unit: Unit | None
    solver_objective_value: float | None
    best_bound: float | None
    absolute_gap: Fraction | None
    relative_gap: float | None
    gap_scope: str | None
    certificate_scope: str | None
    optimality_label: str | None
    primal_residual_max: Fraction | None
    integrality_residual_max: Fraction | None
    validation_report: SolutionVerification | None
    conversion_report: ConversionReport | None
    warnings: tuple[str, ...]
    audit_actor_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        result = to_data(self)
        assert isinstance(result, dict)
        result["decision_values"] = (
            dict(self.decision_values) if self.decision_values is not None else None
        )
        result["solver_options"] = dict(self.solver_options)
        result["backend_defaults"] = dict(self.backend_defaults)
        return result
