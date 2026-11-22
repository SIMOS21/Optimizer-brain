"""Evaluate a supplied plan without invoking or trusting a solver."""

from collections.abc import Mapping
from dataclasses import dataclass
from fractions import Fraction
from decimal import Decimal
import math

from pydantic import model_validator
from typing import Self

from .ir import IRTerm, OptimizationIR
from .numbers import Number, rational
from .schema import StrictModel
from .units import Unit


@dataclass(frozen=True)
class VariableCheck:
    id: str
    value: Fraction
    bound_violation: Fraction
    integrality_residual: Fraction
    valid: bool


@dataclass(frozen=True)
class ConstraintCheck:
    id: str
    lhs: Fraction
    rhs: Fraction
    slack: Fraction
    violation: Fraction
    unit: Unit
    valid: bool


@dataclass(frozen=True)
class ObjectiveValue:
    id: str
    value: Fraction
    unit: Unit


@dataclass(frozen=True)
class PlanVerification:
    model_id: str
    model_hash: str
    manifest_hash: str
    model_version: str
    data_snapshot_id: str
    scenario_id: str
    feasible: bool
    issues: tuple[str, ...]
    bound_tolerance: Fraction
    constraint_tolerance: Fraction
    integrality_tolerance: Fraction
    variables: tuple[VariableCheck, ...]
    constraints: tuple[ConstraintCheck, ...]
    objectives: tuple[ObjectiveValue, ...]


def evaluate_expression(terms: tuple[IRTerm, ...], values: Mapping[str, Fraction]) -> Fraction:
    return sum((term.coefficient * values[term.variable] for term in terms), Fraction(0))


def verify_plan(
    model: OptimizationIR,
    plan: Mapping[str, object],
    *,
    bound_tolerance: object = "0",
    constraint_tolerance: object = "0",
    integrality_tolerance: object = "0",
    exact_binary_floats: bool = False,
) -> PlanVerification:
    """Exact rational evaluation. Tolerances are explicit and default to zero.

    Bound tolerances use each variable's declared unit; constraint tolerances
    use each row's unit. Integrality tolerances are in decision-value units.
    This checks a witness only; it never claims feasibility of another plan
    or optimality. No rounding or repair is performed.
    """
    bt, ct, it = (
        rational(t) for t in (bound_tolerance, constraint_tolerance, integrality_tolerance)
    )
    if min(bt, ct, it) < 0 or it >= Fraction(1, 2):
        raise ValueError("Tolérances non négatives requises ; intégralité strictement < 0.5")
    issues = []
    expected = {variable.id for variable in model.variables}
    if set(plan) != expected:
        issues.append("Plan : variables absentes ou inconnues")
    values: dict[str, Fraction] = {}
    for key in sorted(expected.intersection(plan)):
        try:
            candidate = plan[key]
            if exact_binary_floats and isinstance(candidate, float) and math.isfinite(candidate):
                values[key] = Fraction.from_float(candidate)
            else:
                values[key] = rational(candidate)
        except ValueError as exc:
            issues.append(f"{key}: {exc}")

    def report(
        variables: tuple[VariableCheck, ...] = (),
        constraints: tuple[ConstraintCheck, ...] = (),
        objectives: tuple[ObjectiveValue, ...] = (),
    ) -> PlanVerification:
        return PlanVerification(
            model.model_id,
            model.model_hash,
            model.manifest_hash,
            model.model_version,
            model.data_snapshot_id,
            model.scenario_id,
            not issues,
            tuple(issues),
            bt,
            ct,
            it,
            variables,
            constraints,
            objectives,
        )

    if issues:
        return report()
    variable_checks = []
    for variable in model.variables:
        value = values[variable.id]
        bounds = max(
            variable.lb - value if variable.lb is not None else Fraction(0),
            value - variable.ub if variable.ub is not None else Fraction(0),
            Fraction(0),
        )
        integrality = abs(value - round(value)) if variable.domain != "CONTINUOUS" else Fraction(0)
        valid = bounds <= bt and integrality <= it
        variable_checks.append(VariableCheck(variable.id, value, bounds, integrality, valid))
        if not valid:
            issues.append(f"{variable.id}: bornes ou domaine violés")
    constraint_checks = []
    for row in model.constraints:
        lhs = evaluate_expression(row.terms, values)
        if row.operator == "<=":
            slack = row.rhs - lhs
        elif row.operator == ">=":
            slack = lhs - row.rhs
        else:
            slack = -abs(lhs - row.rhs)
        violation = max(-slack, Fraction(0))
        valid = violation <= ct
        constraint_checks.append(
            ConstraintCheck(row.id, lhs, row.rhs, slack, violation, row.unit, valid)
        )
        if not valid:
            issues.append(f"{row.id}: contrainte violée")
    objectives = tuple(
        ObjectiveValue(goal.id, evaluate_expression(goal.terms, values), goal.unit)
        for goal in model.objectives
    )
    return report(tuple(variable_checks), tuple(constraint_checks), objectives)


class VerificationSettings(StrictModel):
    bound_tolerance: Number = Decimal("1e-7")
    constraint_tolerance: Number = Decimal("1e-7")
    integrality_tolerance: Number = Decimal("1e-7")
    objective_absolute_tolerance: Number = Decimal("1e-6")
    objective_relative_tolerance: Number = Decimal("1e-9")

    @model_validator(mode="after")
    def valid_tolerances(self) -> Self:
        if any(
            value < 0
            for value in (
                self.bound_tolerance,
                self.constraint_tolerance,
                self.integrality_tolerance,
                self.objective_absolute_tolerance,
                self.objective_relative_tolerance,
            )
        ) or self.integrality_tolerance >= Decimal("0.5"):
            raise ValueError("Tolérances non négatives ; intégralité strictement < 0.5")
        if max(
            self.bound_tolerance, self.constraint_tolerance, self.integrality_tolerance
        ) > Decimal("1e-4"):
            raise ValueError("Politique phase 2 : tolérances de faisabilité <= 1e-4")
        if self.objective_absolute_tolerance > Decimal(
            "1e-3"
        ) or self.objective_relative_tolerance > Decimal("1e-6"):
            raise ValueError(
                "Politique phase 2 : tolérances d'objectif absolue <= 1e-3, relative <= 1e-6"
            )
        return self


@dataclass(frozen=True)
class SolutionVerification:
    valid: bool
    plan: PlanVerification
    issues: tuple[str, ...]
    objective_value: Fraction | None
    solver_objective_value: Fraction | None
    objective_difference: Fraction | None
    objective_tolerance: Fraction | None
    primal_residual_max: Fraction | None
    integrality_residual_max: Fraction | None
    arithmetic: str = "exact_rationals_of_binary64_values"


class SolutionVerifier:
    """Re-evaluate raw decisions on the original IR, including the claimed objective."""

    def verify(
        self,
        model: OptimizationIR,
        decisions: Mapping[str, object],
        solver_objective: float | None,
        settings: VerificationSettings,
    ) -> SolutionVerification:
        plan = verify_plan(
            model,
            decisions,
            bound_tolerance=settings.bound_tolerance,
            constraint_tolerance=settings.constraint_tolerance,
            integrality_tolerance=settings.integrality_tolerance,
            exact_binary_floats=True,
        )
        issues = list(plan.issues)
        computed = plan.objectives[0].value if plan.objectives else None
        claimed = difference = tolerance = None
        if solver_objective is not None:
            if not math.isfinite(solver_objective):
                issues.append("Objectif solveur non fini")
            else:
                claimed = Fraction.from_float(solver_objective)
                if computed is not None:
                    difference = abs(claimed - computed)
                    tolerance = Fraction(settings.objective_absolute_tolerance) + Fraction(
                        settings.objective_relative_tolerance
                    ) * max(abs(claimed), abs(computed))
                    if difference > tolerance:
                        issues.append("Objectif solveur incompatible avec l'IR originale")
        residuals = [check.bound_violation for check in plan.variables] + [
            check.violation for check in plan.constraints
        ]
        return SolutionVerification(
            not issues,
            plan,
            tuple(issues),
            computed,
            claimed,
            difference,
            tolerance,
            max(residuals) if residuals else None,
            max((check.integrality_residual for check in plan.variables), default=None),
        )
