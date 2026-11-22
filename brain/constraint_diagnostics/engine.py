"""Sound, deliberately incomplete linear diagnostics. No solver or business rules."""

from collections.abc import Mapping
from fractions import Fraction
from typing import Literal

from pydantic import ValidationError

from brain.kernel import ModelCompilationError, compile_model
from brain.kernel.ir import IRConstraint, OptimizationIR
from brain.kernel.schema import ModelDSL
from brain.kernel.verification import SolutionVerifier, VerificationSettings
from brain.organization.composition import ConstraintTrace
from .contracts import ConstraintActivity, ConstraintLink, DiagnosticsReport, Finding


def _link(row: IRConstraint, traces: Mapping[str, ConstraintTrace]) -> ConstraintLink:
    trace = traces.get(row.id)
    return ConstraintLink(
        constraint_id=row.id,
        department=row.owner_department,
        source=row.origin.source,
        approved=row.origin.approved,
        version=row.origin.version,
        fragment_ids=trace.fragment_ids if trace else (),
        contribution_ids=trace.contribution_ids if trace else (),
        parameter_ids=trace.parameter_ids if trace else (),
        resource_id=trace.resource_id if trace else None,
        source_paths=trace.source_paths if trace else (f"constraints[{row.id}]",),
    )


def diagnose(
    ir: OptimizationIR,
    *,
    traces: tuple[ConstraintTrace, ...] = (),
    composition_manifest_hash: str | None = None,
    decisions: Mapping[str, object] | None = None,
    verification_settings: VerificationSettings | None = None,
    solver_objective: float | None = None,
    solver_status: str | None = None,
) -> DiagnosticsReport:
    """Analyze a compiler-produced IR; independently check any supplied witness.

    Static proofs use exact Fractions and never certify floating point solver
    infeasibility. A witness is checked on the original IR with its own recorded
    tolerances, so it can pass even if a tiny exact contradiction is proved.
    """
    variables = {v.id: v for v in ir.variables}
    trace_by_id = {t.constraint_id: t for t in traces}
    links = {row.id: _link(row, trace_by_id) for row in ir.constraints}
    findings: list[Finding] = []
    # Canonical parallel forms. Normalizing by the first nonzero coefficient
    # preserves numeric variable coordinates and removes row unit scaling.
    # Different dimensions stay separate, preventing comparisons across units.
    groups: dict[
        tuple[tuple[tuple[str, int], ...], tuple[tuple[str, Fraction], ...]],
        list[tuple[Fraction, str, IRConstraint]],
    ] = {}
    for row in sorted(ir.constraints, key=lambda r: r.id):
        lower: Fraction | None = Fraction(0)
        upper: Fraction | None = Fraction(0)
        for term in row.terms:
            var = variables[term.variable]
            low, high = (var.lb, var.ub) if term.coefficient > 0 else (var.ub, var.lb)
            lower = None if lower is None or low is None else lower + term.coefficient * low
            upper = None if upper is None or high is None else upper + term.coefficient * high
        if (row.operator in ("<=", "==") and lower is not None and lower > row.rhs) or (
            row.operator in (">=", "==") and upper is not None and upper < row.rhs
        ):
            findings.append(
                Finding(
                    code="ROW_OUTSIDE_BOUNDS",
                    message="L'intervalle exact de cette expression exclut la limite imposée.",
                    constraints=(links[row.id],),
                    variable_ids=tuple(t.variable for t in row.terms),
                    variable_departments=tuple(
                        (t.variable, variables[t.variable].department) for t in row.terms
                    ),
                    facts=(
                        ("minimum", str(lower) if lower is not None else "-infinity"),
                        ("maximum", str(upper) if upper is not None else "+infinity"),
                        ("operator", row.operator),
                        ("rhs", str(row.rhs)),
                    ),
                )
            )
        if not row.terms:
            continue
        pivot = row.terms[0].coefficient
        vector = tuple((t.variable, t.coefficient / pivot) for t in row.terms)
        operator: str = row.operator
        if pivot < 0:
            operator = {"<=": ">=", ">=": "<=", "==": "=="}[operator]
        groups.setdefault((row.unit.dimensions, vector), []).append(
            (row.rhs / pivot, operator, row)
        )
    for (_, vector), rows in sorted(groups.items()):
        lowers = [(rhs, row) for rhs, op, row in rows if op in (">=", "==")]
        uppers = [(rhs, row) for rhs, op, row in rows if op in ("<=", "==")]
        if not lowers or not uppers:
            continue
        # Stable tie breaks; one sufficient conflict per parallel family, not
        # a quadratic enumeration and never an assertion of minimality.
        low, low_row = min(lowers, key=lambda pair: (-pair[0], pair[1].id))
        high, high_row = min(uppers, key=lambda pair: (pair[0], pair[1].id))
        if low > high:
            findings.append(
                Finding(
                    code="PARALLEL_ROWS_CONTRADICTION",
                    message="Une même expression doit dépasser une borne supérieure plus faible.",
                    constraints=tuple(links[key] for key in sorted({low_row.id, high_row.id})),
                    variable_ids=tuple(key for key, _ in vector),
                    variable_departments=tuple(
                        (key, variables[key].department) for key, _ in vector
                    ),
                    facts=(
                        ("normalized_expression", " + ".join(f"({c})*{v}" for v, c in vector)),
                        ("required_minimum", str(low)),
                        ("required_maximum", str(high)),
                        ("minimum_constraint", low_row.id),
                        ("maximum_constraint", high_row.id),
                    ),
                )
            )
    verification = None
    settings = verification_settings or VerificationSettings()
    if decisions is not None:
        verification = SolutionVerifier().verify(ir, decisions, solver_objective, settings)
    checks = {c.id: c for c in verification.plan.constraints} if verification else {}
    activities: list[ConstraintActivity] = []
    tolerance = Fraction(settings.constraint_tolerance)
    for row in sorted(ir.constraints, key=lambda r: r.id):
        check = checks.get(row.id)
        state: Literal["SATISFIED", "SATURATED", "VIOLATED", "UNAVAILABLE"] = (
            "UNAVAILABLE"
            if check is None
            else "VIOLATED"
            if check.violation > tolerance
            else "SATURATED"
            if abs(check.slack) <= tolerance
            else "SATISFIED"
        )
        activities.append(
            ConstraintActivity(
                constraint=links[row.id],
                state=state,
                lhs=str(check.lhs) if check else None,
                rhs=str(row.rhs),
                slack=str(check.slack) if check else None,
                violation=str(check.violation) if check else None,
                tolerance=str(tolerance) if check else None,
                unit_dimensions=row.unit.dimensions,
                unit_scale=str(row.unit.scale),
            )
        )
    return DiagnosticsReport(
        model_id=ir.model_id,
        model_version=ir.model_version,
        model_hash=ir.model_hash,
        manifest_hash=ir.manifest_hash,
        data_snapshot_id=ir.data_snapshot_id,
        scenario_id=ir.scenario_id,
        composition_manifest_hash=composition_manifest_hash,
        validation="VALID",
        static_conclusion="CONTRADICTION_PROVEN" if findings else "NO_CONCLUSION",
        findings=tuple(
            sorted(findings, key=lambda f: (f.code, tuple(c.constraint_id for c in f.constraints)))
        ),
        activities=tuple(activities),
        solver_status=solver_status,
        infeasibility_evidence=(
            "STATIC_PROOF"
            if findings
            else "SOLVER_REPORTED"
            if solver_status == "INFEASIBLE"
            else "NONE"
        ),
        plan_checked=verification is not None,
        plan_valid=verification.valid if verification else None,
        plan_issues=verification.issues if verification else (),
    )


def diagnose_model(raw: object) -> DiagnosticsReport:
    """Strict DSL entry point: invalid models remain distinct from infeasibility."""
    model: ModelDSL | None = None
    try:
        model = ModelDSL.model_validate(raw)
        return diagnose(compile_model(model))
    except (ValidationError, ModelCompilationError) as exc:
        findings: list[Finding] = []
        if isinstance(exc, ModelCompilationError):
            for issue in exc.issues:
                constraint_links: tuple[ConstraintLink, ...] = ()
                variable_ids: tuple[str, ...] = ()
                variable_departments: tuple[tuple[str, str], ...] = ()
                # Compiler paths are generated internally, never evaluated.
                if model is not None:
                    for index, row in enumerate(model.constraints):
                        if issue.path == f"constraints[{index}]" or issue.path.startswith(
                            f"constraints[{index}]."
                        ):
                            constraint_links = (
                                ConstraintLink(
                                    constraint_id=row.id,
                                    department=row.owner_department,
                                    source=row.source,
                                    approved=row.approved,
                                    version=row.version,
                                    source_paths=(issue.path,),
                                ),
                            )
                    for index, var in enumerate(model.variables):
                        if issue.path == f"variables[{index}]" or issue.path.startswith(
                            f"variables[{index}]."
                        ):
                            variable_ids = (var.id,)
                            variable_departments = ((var.id, var.department),)
                findings.append(
                    Finding(
                        code=issue.code,
                        message=issue.message,
                        path=issue.path,
                        constraints=constraint_links,
                        variable_ids=variable_ids,
                        variable_departments=variable_departments,
                    )
                )
        else:
            # Do not echo raw invalid input, Pydantic context or arbitrary values.
            for error in exc.errors(include_input=False, include_context=False, include_url=False):
                findings.append(
                    Finding(
                        code="INVALID_SCHEMA",
                        message="Champ invalide selon le DSL strict.",
                        path=".".join(map(str, error["loc"])),
                    )
                )
        return DiagnosticsReport(
            model_id=model.id if model else None,
            model_version=model.model_version if model else None,
            model_hash=None,
            manifest_hash=None,
            data_snapshot_id=model.data_snapshot_id if model else None,
            scenario_id=model.scenario_id if model else None,
            validation="INVALID_MODEL",
            static_conclusion="NOT_ANALYZED",
            findings=tuple(sorted(findings, key=lambda f: (f.path or "", f.code))),
            activities=(),
            infeasibility_evidence="NONE",
        )
