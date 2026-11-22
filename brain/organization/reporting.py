"""Measured dependencies/utilization only; no causal explanations or shadow prices."""

from dataclasses import dataclass
from fractions import Fraction
import re
from typing import Literal

from brain.kernel.ir import Origin
from brain.kernel.verification import SolutionVerifier
from brain.solvers.contracts import SolveResult
from .composition import Composition, ConstraintTrace

State = Literal["SATISFIED", "SATURATED", "VIOLATED", "UNAVAILABLE", "UNMODELED"]


@dataclass(frozen=True)
class ConstraintView:
    id: str
    owner_department: str
    state: State
    lhs: Fraction | None
    rhs: Fraction
    slack: Fraction | None
    violation: Fraction | None
    unit: str
    tolerance: Fraction
    provenance: Origin
    trace: ConstraintTrace


@dataclass(frozen=True)
class ResourceView:
    id: str
    name: str
    owner_department: str
    shared_with: tuple[str, ...]
    capacity_parameter: str
    capacity: Fraction
    consumption: Fraction | None
    remaining: Fraction | None
    unit: str
    constraint_ids: tuple[str, ...]
    state: State


@dataclass(frozen=True)
class DecisionView:
    id: str
    value: float | None
    unit: str
    owner_department: str


@dataclass(frozen=True)
class DepartmentView:
    id: str
    name: str
    owner_id: str
    fragment_id: str | None
    fragment_version: str | None
    source: str
    constraint_ids: tuple[str, ...]
    decisions: tuple[DecisionView, ...]


@dataclass(frozen=True)
class OrganizationReport:
    organization_id: str
    composition_manifest_hash: str
    model_hash: str
    run_id: str
    status: str
    has_verified_plan: bool
    constraints: tuple[ConstraintView, ...]
    resources: tuple[ResourceView, ...]
    departments: tuple[DepartmentView, ...]
    warnings: tuple[str, ...]


def graph_mermaid(composition: Composition) -> str:
    graph = composition.source.graph
    nodes = (
        [(graph.organization.id, graph.organization.name)]
        + [(d.id, d.name) for d in graph.departments]
        + [(r.id, r.name) for r in graph.resources]
    )
    identities = {key: f"n{index}" for index, (key, _) in enumerate(sorted(nodes))}
    lines = ["flowchart LR"]
    for key, name in sorted(nodes):
        # IDs are generated; labels use a restricted character set, never raw Mermaid/HTML.
        label = re.sub(r"[^\w .,:()/-]", " ", name)
        lines.append(f'  {identities[key]}["{label}"]')
    for edge in sorted(graph.edges, key=lambda edge: edge.id):
        lines.append(
            f"  {identities[edge.source_id]} -->|{edge.type}| {identities[edge.target_id]}"
        )
    return "\n".join(lines) + "\n"


def build_report(composition: Composition, result: SolveResult) -> OrganizationReport:
    ir = composition.ir
    if (
        result.model_hash,
        result.manifest_hash,
        result.model_id,
        result.model_version,
        result.data_snapshot_id,
        result.scenario_id,
    ) != (
        ir.model_hash,
        ir.manifest_hash,
        ir.model_id,
        ir.model_version,
        ir.data_snapshot_id,
        ir.scenario_id,
    ):
        raise ValueError("Résultat provenant d'un autre modèle, manifeste, snapshot ou scénario")
    source = composition.source
    checks = {}
    values: dict[str, float] = {}
    has_plan = result.decision_values is not None
    if has_plan:
        assert result.decision_values is not None
        values = dict(result.decision_values)
        if len(values) != len(result.decision_values) or result.status not in (
            "OPTIMAL",
            "FEASIBLE",
            "TIME_LIMIT",
        ):
            raise ValueError("Décisions publiques incohérentes avec le statut")
        verification = SolutionVerifier().verify(
            ir, values, result.solver_objective_value, result.settings.verification
        )
        if not verification.valid or verification.objective_value != result.objective_value:
            raise ValueError("Plan/objectif refusé par la revérification indépendante du rapport")
        checks = {check.id: check for check in verification.plan.constraints}
    traces = {trace.constraint_id: trace for trace in composition.constraint_traces}
    units = {row.id: row.unit for row in composition.model.constraints}
    tolerance = Fraction(result.settings.verification.constraint_tolerance)
    constraints = []
    for row in ir.constraints:
        check = checks.get(row.id)
        state: State = "UNAVAILABLE"
        if check:
            state = (
                "VIOLATED"
                if check.violation > tolerance
                else ("SATURATED" if abs(check.slack) <= tolerance else "SATISFIED")
            )
        constraints.append(
            ConstraintView(
                row.id,
                row.owner_department,
                state,
                check.lhs if check else None,
                row.rhs,
                check.slack if check else None,
                check.violation if check else None,
                units[row.id],
                tolerance,
                row.origin,
                traces[row.id],
            )
        )
    rows = {row.id: row for row in constraints}
    resource_traces = {trace.resource_id: trace for trace in composition.resource_traces}
    parameters = {parameter.id: parameter for parameter in ir.parameters}
    resources = []
    for resource in sorted(source.graph.resources, key=lambda resource: resource.id):
        trace = resource_traces[resource.id]
        parameter = parameters[resource.capacity.parameter]
        from brain.kernel.units import parse_unit

        capacity = parameter.value * parameter.unit.scale / parse_unit(resource.unit).scale
        measurement = rows.get(trace.constraint_id) if trace.constraint_id else None
        resources.append(
            ResourceView(
                resource.id,
                resource.name,
                resource.owner_department,
                tuple(sorted(resource.shared_with)),
                parameter.id,
                capacity,
                measurement.lhs if measurement else None,
                measurement.slack if measurement else None,
                resource.unit,
                (trace.constraint_id,) if trace.constraint_id else (),
                measurement.state if measurement else "UNMODELED",
            )
        )
    fragments = {fragment.department_id: fragment for fragment in source.fragments}
    variables = {variable.id: variable for variable in composition.model.variables}
    departments = []
    for department in sorted(source.graph.departments, key=lambda department: department.id):
        fragment = fragments.get(department.id)
        relevant = (
            {variable.id for variable in fragment.variables}
            | {ref.variable for ref in fragment.variable_refs}
            if fragment
            else set()
        )
        constraint_ids = tuple(
            row.id
            for row in constraints
            if row.owner_department == department.id
            or (fragment is not None and fragment.id in row.trace.fragment_ids)
        )
        departments.append(
            DepartmentView(
                department.id,
                department.name,
                department.owner_id,
                fragment.id if fragment else None,
                fragment.version if fragment else None,
                department.source,
                constraint_ids,
                tuple(
                    DecisionView(
                        key, values.get(key), variables[key].unit, variables[key].department
                    )
                    for key in sorted(relevant)
                ),
            )
        )
    return OrganizationReport(
        source.graph.organization.id,
        composition.manifest_hash,
        ir.model_hash,
        result.run_id,
        result.status,
        has_plan,
        tuple(constraints),
        tuple(resources),
        tuple(departments),
        result.warnings,
    )
