"""Exact comparison rules on real solves and explicitly constructed feasible witnesses."""

from dataclasses import replace
from fractions import Fraction
import json
from pathlib import Path
from uuid import uuid4

import pytest

from brain.kernel.verification import SolutionVerifier
from brain.kernel.verification import VerificationSettings
from brain.organization.composition import canonical_json, checksum
from brain.organization.project import load_organization_file
from brain.organization.reporting import build_report
from brain.organization.runtime import solve_organization
from brain.scenario_comparison import ComparisonInput, compare_runs
from brain.solvers.contracts import SolveSettings

ROOT = Path(__file__).resolve().parents[1]


def comparison_input(run, *, reference="reference"):
    payload = canonical_json({"solve": run.solve.to_dict(), "report": run.report})
    return ComparisonInput(
        organization_id="tenant",
        run_id=run.solve.run_id,
        record_status=run.solve.public_status,
        content_hash=checksum(payload),
        document_json=payload,
        created_at=100,
        created_by="author",
        model_version_id="model",
        model_content_hash=checksum(run.composition.source_json),
        graph_snapshot_id="graph",
        graph_content_hash="graph_hash",
        reference_model_version_id=reference,
        reference_content_hash="reference_hash",
        composition=run.composition,
    )


@pytest.fixture(scope="module")
def factory_run():
    return solve_organization(
        load_organization_file(ROOT / "examples/organizations/factory/project.json")
    )


def witness(run, a, b):
    """A feasible incumbent is a witness, deliberately carrying no optimality certificate."""
    verification = SolutionVerifier().verify(
        run.composition.ir, {"qty_A": a, "qty_B": b}, None, run.solve.settings.verification
    )
    assert verification.valid
    result = replace(
        run.solve,
        run_id=str(uuid4()),
        status="FEASIBLE",
        public_status="FEASIBLE_NOT_PROVEN_OPTIMAL",
        certificate_scope=None,
        decision_values=(("qty_A", a), ("qty_B", b)),
        solver_objective_value=None,
        objective_value=verification.objective_value,
        validation_report=verification,
        best_bound=None,
        relative_gap=None,
        absolute_gap=None,
        solver_status_raw=None,
    )
    return replace(run, solve=result, report=build_report(run.composition, result))


def altered(source, change):
    document = json.loads(source.document_json)
    change(document)
    payload = canonical_json(document)
    return replace(source, document_json=payload, content_hash=checksum(payload))


def codes(report):
    return {r.code for r in report.reasons}


def test_identical_runs_are_deterministic_read_only_and_have_no_gain(factory_run, monkeypatch):
    source = comparison_input(factory_run)
    before = source.document_json

    def forbidden(*args, **kwargs):
        raise AssertionError("Comparison must not solve or access a network")

    monkeypatch.setattr("scipy.optimize.milp", forbidden)
    monkeypatch.setattr("socket.create_connection", forbidden)
    first = compare_runs("tenant", source, source)
    assert first == compare_runs("tenant", source, source)
    assert source.document_json == before
    assert first.comparability == "COMPARABLE"
    assert first.observed_objective_delta == "0"
    assert first.objective_improvement is first.objective_improvement_percent is None
    assert first.economic_gain is None
    assert first.baseline.objective_value == "4100"
    assert {r.id: r.baseline_value for r in first.decisions} == {"qty_A": "40", "qty_B": "15"}
    assert all(row.delta == "0" for row in first.decisions)
    assert first.report_hash == checksum(
        canonical_json(first.model_dump(mode="json", exclude={"report_hash"}))
    )


def test_changed_capacity_is_only_an_observed_difference(factory_run):
    raw = json.loads(factory_run.composition.source_json)
    raw["shared_parameters"]["delivery_capacity_units"]["value"] = "45"
    raw["graph"]["organization"]["data_snapshot_id"] = "changed_snapshot"
    changed = solve_organization(raw)
    source = comparison_input(factory_run)
    candidate = comparison_input(changed)
    report = compare_runs("tenant", source, candidate)
    assert report.candidate.objective_value == "3500"
    assert report.comparability == "QUALIFIED"
    assert report.observed_objective_delta == "-600"
    assert report.objective_improvement is report.objective_improvement_percent is None
    assert report.message == "Écart observé entre scénarios — gain non démontré."
    assert "MODEL_OR_SNAPSHOT_CHANGED" in codes(report)
    delivery = next(r for r in report.resources if r.id == "logistics_resource")
    assert (delivery.baseline.capacity, delivery.candidate.capacity, delivery.capacity_delta) == (
        "55",
        "45",
        "-10",
    )
    assert delivery.consumption_delta == "-10"
    assert delivery.remaining_delta == "0"
    row = next(r for r in report.constraints if r.id == "logistics_delivery")
    assert row.baseline.state == row.candidate.state == "SATURATED"


def test_same_model_different_snapshot_never_announces_gain(factory_run):
    raw = json.loads(factory_run.composition.source_json)
    raw["graph"]["organization"]["data_snapshot_id"] = "new_snapshot"
    changed = solve_organization(raw)
    assert changed.composition.ir.model_hash == factory_run.composition.ir.model_hash
    report = compare_runs("tenant", comparison_input(factory_run), comparison_input(changed))
    assert report.comparability == "QUALIFIED"
    assert report.observed_objective_delta == "0"
    assert report.objective_improvement is None


def test_common_frame_rechecks_baseline_and_computes_exact_model_improvement(factory_run):
    baseline = comparison_input(witness(factory_run, 20.0, 5.0))
    report = compare_runs("tenant", baseline, comparison_input(factory_run))
    assert report.baseline.objective_value == "1900"
    assert report.objective_improvement == "2200"
    assert report.objective_improvement_percent == "2200/19"
    assert report.claim == "VERIFIED_OBJECTIVE_IMPROVEMENT"
    assert report.economic_gain is None
    assert "gain économique non démontré" in report.message


def test_zero_baseline_has_no_percentage(factory_run):
    report = compare_runs(
        "tenant", comparison_input(witness(factory_run, 0.0, 0.0)), comparison_input(factory_run)
    )
    assert report.objective_improvement == "4100"
    assert report.objective_improvement_percent is None
    assert "ZERO_BASELINE_NO_PERCENTAGE" in codes(report)


def test_minimization_reverses_the_improvement_direction(factory_run):
    raw = json.loads(factory_run.composition.source_json)
    raw["objective"]["sense"] = "MIN"
    minimum = solve_organization(raw)
    report = compare_runs(
        "tenant", comparison_input(witness(minimum, 20.0, 5.0)), comparison_input(minimum)
    )
    assert report.candidate.objective_value == "0"
    assert report.observed_objective_delta == "-1900"
    assert report.oriented_objective_delta == report.objective_improvement == "1900"


@pytest.mark.parametrize(
    "mutation,code",
    [
        (lambda r: r["objective"].update(sense="MIN"), "OBJECTIVE_SENSE_MISMATCH"),
        (lambda r: r["objective"].update(id="another_metric"), "METRIC_SEMANTICS_MISMATCH"),
        (
            lambda r: r["objective"]["terms"][0].update(coefficient="81"),
            "METRIC_SEMANTICS_MISMATCH",
        ),
    ],
)
def test_incompatible_objectives_have_no_deltas(factory_run, mutation, code):
    raw = json.loads(factory_run.composition.source_json)
    mutation(raw)
    report = compare_runs(
        "tenant", comparison_input(factory_run), comparison_input(solve_organization(raw))
    )
    assert report.comparability == "NOT_COMPARABLE"
    assert report.observed_objective_delta is report.objective_improvement is None
    assert code in codes(report)
    assert all(d.delta is None for d in report.decisions)


def test_same_tenant_and_similar_objectives_are_not_semantic_evidence(factory_run):
    source = comparison_input(factory_run)
    report = compare_runs(
        "tenant", source, replace(source, reference_model_version_id="unrelated_model")
    )
    assert report.comparability == "NOT_COMPARABLE"
    assert "REFERENCE_LINEAGE_MISMATCH" in codes(report)
    assert report.observed_objective_delta is None


@pytest.mark.parametrize(
    "native,public",
    [
        ("INFEASIBLE", "INFEASIBLE"),
        ("TIME_LIMIT", "TIME_LIMIT_NO_SOLUTION"),
        ("ERROR", "SOLVER_ERROR"),
    ],
)
def test_statuses_without_plans_remain_explicit(factory_run, native, public):
    result = replace(
        factory_run.solve,
        status=native,
        public_status=public,
        decision_values=None,
        objective_value=None,
        validation_report=None,
    )
    failed = replace(
        factory_run, solve=result, report=build_report(factory_run.composition, result)
    )
    report = compare_runs("tenant", comparison_input(factory_run), comparison_input(failed))
    assert report.candidate.native_status == native
    assert not report.candidate.verified_plan
    assert report.candidate.objective_value is None
    assert report.observed_objective_delta is None
    assert all(d.candidate_value is None for d in report.decisions)


def test_time_limit_with_verified_witness_is_not_promoted_to_optimal(factory_run):
    feasible = witness(factory_run, 20.0, 5.0)
    result = replace(feasible.solve, status="TIME_LIMIT")
    limited = replace(feasible, solve=result, report=build_report(feasible.composition, result))
    report = compare_runs("tenant", comparison_input(factory_run), comparison_input(limited))
    assert report.candidate.verified_plan
    assert report.candidate.native_status == "TIME_LIMIT"
    assert report.candidate.public_status == "FEASIBLE_NOT_PROVEN_OPTIMAL"
    assert report.observed_objective_delta == "-2200"
    assert report.objective_improvement is None


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d["solve"]["validation_report"].update(valid=False),
        lambda d: d["solve"]["decision_values"].update(qty_A=400.0),
        lambda d: d["solve"].update(objective_value=None),
        lambda d: d["solve"].update(status="FEASIBLE"),
        lambda d: d["solve"].update(certificate_scope=None),
        lambda d: d["report"].update(has_verified_plan=False),
    ],
)
def test_unverified_or_inconsistent_claims_never_supply_public_values(factory_run, change):
    source = comparison_input(factory_run)
    report = compare_runs("tenant", source, altered(source, change))
    assert not report.candidate.verified_plan
    assert report.candidate.objective_value is None
    assert report.observed_objective_delta is report.economic_gain is None


@pytest.mark.parametrize(
    "field",
    [
        "model_id",
        "model_version",
        "model_hash",
        "manifest_hash",
        "data_snapshot_id",
        "scenario_id",
        "run_id",
    ],
)
def test_mismatched_provenance_fails_closed(factory_run, field):
    source = comparison_input(factory_run)
    candidate = altered(source, lambda d: d["solve"].update({field: "foreign"}))
    with pytest.raises(ValueError, match="Provenance"):
        compare_runs("tenant", source, candidate)


def test_missing_baseline_candidate_and_foreign_tenant(factory_run):
    source = comparison_input(factory_run)
    report = compare_runs("tenant", None, source)
    assert report.comparability == "INCOMPLETE"
    assert report.observed_objective_delta is None
    assert "BASELINE_RUN_REQUIRED" in codes(report)
    assert "CANDIDATE_RUN_REQUIRED" in codes(compare_runs("tenant", source, None))
    with pytest.raises(ValueError, match="inter-organisation"):
        compare_runs("other", source, source)


def test_high_precision_decimal_and_binary64_witness_are_not_rounded(factory_run):
    raw = json.loads(factory_run.composition.source_json)
    raw["shared_parameters"]["delivery_capacity_units"]["value"] = "45.00000000000000001"
    raw["graph"]["organization"]["data_snapshot_id"] = "exact_decimal_snapshot"
    changed = solve_organization(raw)
    report = compare_runs("tenant", comparison_input(factory_run), comparison_input(changed))
    assert report.candidate.verified_plan
    assert report.candidate.native_status == "FEASIBLE"
    delivery = next(r for r in report.resources if r.id == "logistics_resource")
    assert Fraction(delivery.candidate.capacity) == Fraction("45.00000000000000001")
    assert Fraction(delivery.candidate.remaining) == Fraction("0.00000000000000001")
    assert report.objective_improvement is None
    tiny = witness(factory_run, 1e-8, 0.0)
    pair = compare_runs(
        "tenant", comparison_input(witness(factory_run, 0.0, 0.0)), comparison_input(tiny)
    )
    assert Fraction(pair.observed_objective_delta) == 80 * Fraction.from_float(1e-8)
    assert pair.objective_improvement is None


def test_university_reference_is_separate_and_preserved(factory_run):
    university = solve_organization(
        load_organization_file(ROOT / "examples/organizations/university/project.json")
    )
    source = comparison_input(university, reference="university_reference")
    report = compare_runs("tenant", source, source)
    assert report.baseline.objective_value == "17"
    incompatible = compare_runs("tenant", comparison_input(factory_run), source)
    assert "OBJECTIVE_UNIT_MISMATCH" in codes(incompatible)
    assert incompatible.observed_objective_delta is None
    assert incompatible.baseline.objective_unit == "EUR"
    assert incompatible.candidate.objective_unit == university.composition.model.objectives[0].unit


def test_baseline_is_rechecked_using_candidate_tolerances(factory_run):
    baseline = witness(factory_run, -1e-8, 0.0)
    candidate = solve_organization(
        json.loads(factory_run.composition.source_json),
        SolveSettings(verification=VerificationSettings(bound_tolerance="0")),
    )
    report = compare_runs("tenant", comparison_input(baseline), comparison_input(candidate))
    assert report.baseline.verified_plan and report.candidate.verified_plan
    assert report.observed_objective_delta is not None
    assert report.objective_improvement is None
    assert "BASELINE_NOT_VALID_IN_CANDIDATE" in codes(report)


def test_monetary_objective_coefficients_keep_all_decimal_digits(factory_run):
    raw = json.loads(factory_run.composition.source_json)
    next(t for t in raw["objective"]["terms"] if t["variable"] == "qty_A")["coefficient"] = (
        "80.00000000000000001"
    )
    changed = solve_organization(raw)
    report = compare_runs(
        "tenant", comparison_input(witness(changed, 20.0, 5.0)), comparison_input(changed)
    )
    values = dict(changed.solve.decision_values)
    expected = Fraction("80.00000000000000001") * Fraction.from_float(
        values["qty_A"]
    ) + 60 * Fraction.from_float(values["qty_B"])
    assert Fraction(report.candidate.objective_value) == expected
    assert expected != Fraction("80") * Fraction.from_float(
        values["qty_A"]
    ) + 60 * Fraction.from_float(values["qty_B"])
    assert report.candidate.native_status == "FEASIBLE"
