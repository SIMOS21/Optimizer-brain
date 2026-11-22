"""Evaluate a supplied plan without invoking or trusting a solver."""

from collections.abc import Mapping
from dataclasses import dataclass
from fractions import Fraction

from .ir import IRTerm, OptimizationIR
from .numbers import rational
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
            values[key] = rational(plan[key])
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
        bounds = max(variable.lb - value, value - variable.ub, Fraction(0))
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
