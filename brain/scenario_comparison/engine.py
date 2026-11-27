"""Pure, read-only comparisons. No solver, SQL, network or LLM is invoked."""

from dataclasses import dataclass
from fractions import Fraction
import json
from typing import Literal

from pydantic import JsonValue

from brain.kernel.ir import IRConstraint, to_data
from brain.kernel.schema import StrictModel
from brain.kernel.units import parse_unit
from brain.kernel.verification import SolutionVerification, SolutionVerifier
from brain.organization import Composition
from brain.organization.composition import canonical_json, checksum
from brain.solvers.contracts import SolveSettings
from .contracts import (
    ComparedRun,
    ComparisonReason,
    ComparisonReport,
    ConstraintDifference,
    ConstraintMeasure,
    DecisionDifference,
    ResourceDifference,
    ResourceMeasure,
)


@dataclass(frozen=True)
class ComparisonInput:
    organization_id: str
    run_id: str
    record_status: str
    content_hash: str
    document_json: str
    created_at: int
    created_by: str
    model_version_id: str
    model_content_hash: str
    graph_snapshot_id: str
    graph_content_hash: str
    reference_model_version_id: str
    reference_content_hash: str
    composition: Composition
    scenario_version_id: str | None = None
    scenario_content_hash: str | None = None
    scenario_name: str | None = None
    assumptions_json: str = "[]"


class _SolveEvidence(StrictModel):
    run_id: str
    model_id: str
    model_version: str
    model_hash: str
    manifest_hash: str
    data_snapshot_id: str
    scenario_id: str
    status: str
    public_status: str
    started_at: str
    decision_values: dict[str, float] | None
    objective_value: str | None = None
    objective_unit: JsonValue = None
    solver_objective_value: float | None
    validation_report: dict[str, JsonValue] | None
    settings: SolveSettings


@dataclass(frozen=True)
class _Evaluated:
    source: ComparisonInput
    view: ComparedRun
    evidence: _SolveEvidence
    verification: SolutionVerification | None


def _metric(composition: Composition) -> str:
    ir, model = composition.ir, composition.model
    goal = ir.objectives[0]
    # Neither a matching label nor a shared tenant establishes semantics. This
    # fingerprint is used only together with a checked, common reference lineage.
    return checksum(
        canonical_json(
            {
                "objective": (
                    goal.id,
                    goal.sense,
                    goal.terms,
                    goal.unit,
                    goal.priority,
                    goal.owner_department,
                    goal.origin.source,
                ),
                "variables": [
                    (v.id, v.domain, v.unit, v.department, v.indices) for v in ir.variables
                ],
                "dimensions": model.dimensions,
                "currency": model.currency,
            }
        )
    )


def _evaluate(source: ComparisonInput) -> _Evaluated:
    if checksum(source.document_json) != source.content_hash:
        raise ValueError("Intégrité du run invalide")
    document = json.loads(source.document_json)
    raw, report = document["solve"], document["report"]
    evidence = _SolveEvidence.model_validate(
        {key: raw[key] for key in _SolveEvidence.model_fields if key in raw}
    )
    ir = source.composition.ir
    if (
        evidence.run_id,
        evidence.model_id,
        evidence.model_version,
        evidence.model_hash,
        evidence.manifest_hash,
        evidence.data_snapshot_id,
        evidence.scenario_id,
    ) != (
        source.run_id,
        ir.model_id,
        ir.model_version,
        ir.model_hash,
        ir.manifest_hash,
        ir.data_snapshot_id,
        ir.scenario_id,
    ) or source.record_status != evidence.public_status:
        raise ValueError("Provenance du run incompatible avec le modèle")
    if (
        report.get("run_id"),
        report.get("model_hash"),
        report.get("composition_manifest_hash"),
        report.get("organization_id"),
    ) != (
        source.run_id,
        ir.model_hash,
        source.composition.manifest_hash,
        source.composition.source.graph.organization.id,
    ):
        raise ValueError("Provenance du rapport incompatible avec le run")
    if raw.get("audit_actor_id") not in (None, source.created_by):
        raise ValueError("Auteur du run incompatible")
    goal = ir.objectives[0]
    issues: list[str] = []
    verification = None
    if evidence.decision_values is not None:
        verification = SolutionVerifier().verify(
            ir,
            evidence.decision_values,
            evidence.solver_objective_value,
            evidence.settings.verification,
        )
        issues.extend(verification.issues)
    if verification is None or not verification.valid:
        issues.append("INDEPENDENT_VERIFICATION_FAILED_OR_ABSENT")
    recorded = evidence.validation_report or {}
    recorded_plan = recorded.get("plan")
    if (
        recorded.get("valid") is not True
        or not isinstance(recorded_plan, dict)
        or recorded_plan.get("feasible") is not True
        or report.get("has_verified_plan") is not True
    ):
        issues.append("RECORDED_VERIFICATION_NOT_SUCCESSFUL")
    if verification and canonical_json(recorded) != canonical_json(to_data(verification)):
        issues.append("RECORDED_VERIFICATION_NOT_REPRODUCIBLE")
    expected_public = {
        "OPTIMAL": "OPTIMAL",
        "FEASIBLE": "FEASIBLE_NOT_PROVEN_OPTIMAL",
        "TIME_LIMIT": "FEASIBLE_NOT_PROVEN_OPTIMAL",
    }
    if expected_public.get(evidence.status) != evidence.public_status or report.get(
        "status"
    ) not in (evidence.status, evidence.public_status):
        issues.append("STATUS_WITHOUT_VERIFIED_PLAN")
    if evidence.public_status == "OPTIMAL":
        conversion = raw.get("conversion_report") or {}
        if (
            evidence.status != "OPTIMAL"
            or raw.get("solver_status_raw") != 0
            or raw.get("certificate_scope") != "solver_tolerances"
            or conversion.get("rounded_count") != 0
        ):
            issues.append("INCONSISTENT_OPTIMAL_ATTESTATION")
    if evidence.objective_value is None or evidence.objective_unit is None:
        issues.append("OBJECTIVE_METRIC_MISSING")
    elif verification is not None and (
        verification.objective_value != Fraction(evidence.objective_value)
        or canonical_json(evidence.objective_unit) != canonical_json(goal.unit)
    ):
        issues.append("RECORDED_OBJECTIVE_INCONSISTENT")
    # Only the original verifier supplies a verified objective/decision witness.
    verified = not issues
    check: dict[str, JsonValue] = {
        "valid": verification.valid if verification else False,
        "plan_feasible": verification.plan.feasible if verification else False,
        "objective_value": str(verification.objective_value)
        if verification and verification.objective_value is not None
        else None,
        "primal_residual_max": str(verification.primal_residual_max)
        if verification and verification.primal_residual_max is not None
        else None,
        "integrality_residual_max": str(verification.integrality_residual_max)
        if verification and verification.integrality_residual_max is not None
        else None,
        "arithmetic": verification.arithmetic if verification else None,
        "settings": evidence.settings.verification.model_dump(mode="json"),
    }
    native: dict[str, JsonValue] = {
        key: raw.get(key)
        for key in (
            "solver_name",
            "solver_version",
            "interface_name",
            "interface_version",
            "solver_status_raw",
            "termination_reason",
            "solver_options",
            "backend_defaults",
            "best_bound",
            "absolute_gap",
            "relative_gap",
            "gap_scope",
            "certificate_scope",
            "optimality_label",
            "conversion_report",
            "warnings",
        )
    }
    view = ComparedRun(
        run_id=source.run_id,
        organization_id=source.organization_id,
        content_hash=source.content_hash,
        created_at=source.created_at,
        created_by=source.created_by,
        started_at=evidence.started_at,
        model_version_id=source.model_version_id,
        model_id=ir.model_id,
        model_name=source.composition.source.model_name,
        model_version=ir.model_version,
        model_content_hash=source.model_content_hash,
        model_hash=ir.model_hash,
        manifest_hash=ir.manifest_hash,
        graph_snapshot_id=source.graph_snapshot_id,
        graph_content_hash=source.graph_content_hash,
        data_snapshot_id=ir.data_snapshot_id,
        reference_model_version_id=source.reference_model_version_id,
        reference_content_hash=source.reference_content_hash,
        scenario_id=ir.scenario_id,
        scenario_version_id=source.scenario_version_id,
        scenario_content_hash=source.scenario_content_hash,
        scenario_name=source.scenario_name,
        assumptions=tuple(json.loads(source.assumptions_json)),
        public_status=evidence.public_status,
        native_status=evidence.status,
        verified_plan=verified,
        verification_issues=tuple(dict.fromkeys(issues)),
        objective_id=goal.id,
        objective_sense=goal.sense,
        objective_unit=source.composition.model.objectives[0].unit,
        objective_value=str(verification.objective_value) if verified and verification else None,
        metric_fingerprint=_metric(source.composition),
        verification=check,
        native_evidence=native,
    )
    return _Evaluated(source, view, evidence, verification)


def _delta(a: str | None, b: str | None, allowed: bool) -> str | None:
    return str(Fraction(b) - Fraction(a)) if allowed and a is not None and b is not None else None


def _row_signature(row: IRConstraint) -> object:
    return row.terms, row.operator, row.unit, row.owner_department


def _constraint_values(run: _Evaluated) -> dict[str, ConstraintMeasure]:
    checks = (
        {c.id: c for c in run.verification.plan.constraints}
        if (run.view.verified_plan and run.verification)
        else {}
    )
    tolerance = Fraction(run.evidence.settings.verification.constraint_tolerance)
    result = {}
    units = {r.id: r.unit for r in run.source.composition.model.constraints}
    for row in run.source.composition.ir.constraints:
        check = checks.get(row.id)
        state: Literal["SATURATED", "SATISFIED", "VIOLATED", "UNAVAILABLE"] = "UNAVAILABLE"
        if check:
            state = (
                "VIOLATED"
                if check.violation > tolerance
                else ("SATURATED" if abs(check.slack) <= tolerance else "SATISFIED")
            )
        result[row.id] = ConstraintMeasure(
            unit=units[row.id],
            lhs=str(check.lhs) if check else None,
            rhs=str(row.rhs),
            slack=str(check.slack) if check else None,
            state=state,
            tolerance=str(tolerance),
        )
    return result


def _resources(
    run: _Evaluated, constraints: dict[str, ConstraintMeasure]
) -> dict[str, ResourceMeasure]:
    composition = run.source.composition
    traces = {r.resource_id: r for r in composition.resource_traces}
    parameters = {p.id: p for p in composition.ir.parameters}
    result = {}
    for resource in composition.source.graph.resources:
        parameter = parameters[resource.capacity.parameter]
        capacity = parameter.value * parameter.unit.scale / parse_unit(resource.unit).scale
        row = constraints.get(traces[resource.id].constraint_id or "")
        result[resource.id] = ResourceMeasure(
            unit=resource.unit,
            capacity=str(capacity),
            consumption=row.lhs if row else None,
            remaining=row.slack if row else None,
            state=row.state if row else "UNMODELED",
        )
    return result


def _tables(
    a: _Evaluated, b: _Evaluated, allowed: bool
) -> tuple[
    tuple[DecisionDifference, ...], tuple[ResourceDifference, ...], tuple[ConstraintDifference, ...]
]:
    ac, bc = a.source.composition, b.source.composition
    av, bv = {v.id: v for v in ac.model.variables}, {v.id: v for v in bc.model.variables}
    aq = (
        {v.id: str(v.value) for v in a.verification.plan.variables}
        if (a.view.verified_plan and a.verification)
        else {}
    )
    bq = (
        {v.id: str(v.value) for v in b.verification.plan.variables}
        if (b.view.verified_plan and b.verification)
        else {}
    )
    decisions = tuple(
        DecisionDifference(
            id=key,
            department=(av.get(key) or bv[key]).department,
            unit=av[key].unit if key in av and key in bv and av[key].unit == bv[key].unit else None,
            baseline_unit=av[key].unit if key in av else None,
            candidate_unit=bv[key].unit if key in bv else None,
            baseline_value=aq.get(key),
            candidate_value=bq.get(key),
            delta=_delta(
                aq.get(key),
                bq.get(key),
                allowed and key in av and key in bv and av[key].unit == bv[key].unit,
            ),
        )
        for key in sorted(av.keys() | bv.keys())
    )
    ar, br = _constraint_values(a), _constraint_values(b)
    arows, brows = {r.id: r for r in ac.ir.constraints}, {r.id: r for r in bc.ir.constraints}
    units = {r.id: r.unit for r in ac.model.constraints}
    units.update({r.id: r.unit for r in bc.model.constraints})
    constraints = tuple(
        ConstraintDifference(
            id=key,
            department=(arows.get(key) or brows[key]).owner_department,
            unit=ar[key].unit if key in ar and key in br and ar[key].unit == br[key].unit else None,
            baseline=ar.get(key),
            candidate=br.get(key),
            slack_delta=_delta(
                ar[key].slack if key in ar else None,
                br[key].slack if key in br else None,
                allowed
                and key in arows
                and key in brows
                and _row_signature(arows[key]) == _row_signature(brows[key]),
            ),
        )
        for key in sorted(ar.keys() | br.keys())
    )
    am, bm = _resources(a, ar), _resources(b, br)
    aresources = {r.id: r for r in ac.source.graph.resources}
    bresources = {r.id: r for r in bc.source.graph.resources}
    resources = []
    for key in sorted(am.keys() | bm.keys()):
        resource = aresources.get(key) or bresources[key]
        compatible = (
            allowed
            and key in aresources
            and key in bresources
            and aresources[key].unit == bresources[key].unit
            and aresources[key].capacity.parameter == bresources[key].capacity.parameter
            and aresources[key].owner_department == bresources[key].owner_department
        )
        first, second = am.get(key), bm.get(key)
        resources.append(
            ResourceDifference(
                id=key,
                department=resource.owner_department,
                unit=first.unit if first and second and first.unit == second.unit else None,
                baseline=first,
                candidate=second,
                capacity_delta=_delta(
                    first.capacity if first else None,
                    second.capacity if second else None,
                    compatible,
                ),
                consumption_delta=_delta(
                    first.consumption if first else None,
                    second.consumption if second else None,
                    compatible,
                ),
                remaining_delta=_delta(
                    first.remaining if first else None,
                    second.remaining if second else None,
                    compatible,
                ),
            )
        )
    return decisions, tuple(resources), constraints


def compare_runs(
    organization_id: str, baseline: ComparisonInput | None, candidate: ComparisonInput | None
) -> ComparisonReport:
    """Compare witnessed plans, never solve or extrapolate an operational gain."""
    if any(r.organization_id != organization_id for r in (baseline, candidate) if r):
        raise ValueError("Comparaison inter-organisation interdite")
    a, b = _evaluate(baseline) if baseline else None, _evaluate(candidate) if candidate else None
    reasons: list[ComparisonReason] = []

    def reason(
        code: str, message: str, side: Literal["BASELINE", "CANDIDATE", "PAIR"] = "PAIR"
    ) -> None:
        reasons.append(ComparisonReason(code=code, message=message, side=side))

    sides: tuple[tuple[_Evaluated | None, Literal["BASELINE", "CANDIDATE"]], ...] = (
        (a, "BASELINE"),
        (b, "CANDIDATE"),
    )
    for run, side in sides:
        if run is None:
            reason(
                f"{side}_RUN_REQUIRED",
                "Choisir un run enregistré ; un scénario sans run ne peut pas être comparé.",
                side,
            )
        elif not run.view.verified_plan:
            reason(
                "RUN_NOT_VERIFIED",
                f"Aucun plan comparable vérifié pour le statut {run.view.public_status}.",
                side,
            )
    compatible, same = False, False
    observed = oriented = improvement = percent = tolerance_text = None
    decisions: tuple[DecisionDifference, ...] = ()
    resources: tuple[ResourceDifference, ...] = ()
    constraints: tuple[ConstraintDifference, ...] = ()
    if a and b:
        av, bv = a.view, b.view
        related = (av.reference_model_version_id, av.reference_content_hash) == (
            bv.reference_model_version_id,
            bv.reference_content_hash,
        )
        if not related:
            reason(
                "REFERENCE_LINEAGE_MISMATCH",
                "Aucune référence immuable commune ne prouve la signification des métriques.",
            )
        if av.objective_sense != bv.objective_sense:
            reason("OBJECTIVE_SENSE_MISMATCH", "Les sens MAX/MIN diffèrent.")
        if av.objective_unit != bv.objective_unit:
            reason(
                "OBJECTIVE_UNIT_MISMATCH",
                "Les unités déclarées diffèrent ; aucune conversion implicite.",
            )
        if av.metric_fingerprint != bv.metric_fingerprint:
            reason(
                "METRIC_SEMANTICS_MISMATCH",
                "Formule, variables, domaines, indices ou dimensions de la métrique incompatibles.",
            )
        compatible = (
            related
            and av.metric_fingerprint == bv.metric_fingerprint
            and av.objective_unit == bv.objective_unit
            and av.verified_plan
            and bv.verified_plan
        )
        same = (av.model_hash, av.data_snapshot_id) == (bv.model_hash, bv.data_snapshot_id)
        if not same:
            reason(
                "MODEL_OR_SNAPSHOT_CHANGED",
                "Modèle ou snapshot différent : écart d’hypothèses seulement, gain non démontré.",
            )
        if compatible:
            assert av.objective_value is not None and bv.objective_value is not None
            first, second = Fraction(av.objective_value), Fraction(bv.objective_value)
            difference = second - first
            directed = difference if av.objective_sense == "MAX" else -difference
            observed, oriented = str(difference), str(directed)
            # Combine both recorded tolerances; do not label numerical noise an improvement.
            settings = [a.evidence.settings.verification, b.evidence.settings.verification]
            tolerance = sum(
                (
                    Fraction(s.objective_absolute_tolerance)
                    + Fraction(s.objective_relative_tolerance) * max(abs(first), abs(second))
                    for s in settings
                ),
                Fraction(0),
            )
            tolerance_text = str(tolerance)
            if same and directed > tolerance:
                # Common IR/snapshot means the baseline is also reverified in the
                # candidate mathematical frame, without changing any witness.
                cross = SolutionVerifier().verify(
                    b.source.composition.ir,
                    a.evidence.decision_values or {},
                    a.evidence.solver_objective_value,
                    b.evidence.settings.verification,
                )
                if cross.valid and cross.objective_value == first:
                    improvement = str(directed)
                    if first != 0:
                        percent = str(100 * directed / abs(first))
                else:
                    reason(
                        "BASELINE_NOT_VALID_IN_CANDIDATE",
                        "La référence échoue dans les tolérances du modèle candidat.",
                    )
            if first == 0:
                reason(
                    "ZERO_BASELINE_NO_PERCENTAGE",
                    "Objectif de référence nul : aucun pourcentage simple n’est défini.",
                )
        decisions, resources, constraints = _tables(a, b, compatible)
    category: Literal["COMPARABLE", "QUALIFIED", "NOT_COMPARABLE", "INCOMPLETE"] = (
        "INCOMPLETE"
        if not a or not b
        else (
            "COMPARABLE" if compatible and same else "QUALIFIED" if compatible else "NOT_COMPARABLE"
        )
    )
    claim: Literal["VERIFIED_OBJECTIVE_IMPROVEMENT", "OBSERVED_DIFFERENCE", "NONE"] = (
        "VERIFIED_OBJECTIVE_IMPROVEMENT"
        if improvement is not None
        else "OBSERVED_DIFFERENCE"
        if observed is not None
        else "NONE"
    )
    message = (
        "Amélioration calculée de l’objectif entre deux plans vérifiés du même modèle et snapshot ; gain économique non démontré."
        if improvement is not None
        else "Écart observé entre scénarios — gain non démontré."
        if observed is not None
        else "Comparaison non concluante : aucun écart mathématique exploitable."
    )
    result = ComparisonReport(
        organization_id=organization_id,
        baseline_run_id=baseline.run_id if baseline else None,
        candidate_run_id=candidate.run_id if candidate else None,
        baseline=a.view if a else None,
        candidate=b.view if b else None,
        comparability=category,
        claim=claim,
        message=message,
        same_model_and_snapshot=same,
        reasons=tuple(reasons),
        observed_objective_delta=observed,
        oriented_objective_delta=oriented,
        objective_unit=a.view.objective_unit if compatible and a else None,
        objective_improvement=improvement,
        objective_improvement_percent=percent,
        improvement_tolerance=tolerance_text,
        decisions=decisions,
        resources=resources,
        constraints=constraints,
        report_hash="",
    )
    return result.model_copy(
        update={
            "report_hash": checksum(
                canonical_json(result.model_dump(mode="json", exclude={"report_hash"}))
            )
        }
    )
