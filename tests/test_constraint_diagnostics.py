"""Exact proofs, intentionally inconclusive cases and independently checked activities."""

from copy import deepcopy
from fractions import Fraction
from itertools import product
import random
import socket

import pytest

from brain.constraint_diagnostics import diagnose, diagnose_model
from brain.kernel import compile_model, verify_plan
from brain.kernel.verification import VerificationSettings
from brain.organization import compose_organization_model
from brain.organization.composition import canonical_json
from brain.organization.project import load_organization_file
from brain.organization.runtime import solve_organization
from tests.test_generic_solver import ROOT, model, row, variable


@pytest.mark.parametrize("domain", ["CONTINUOUS", "INTEGER", "BINARY"])
def test_invalid_bounds_are_model_errors_with_variable_department(domain):
    raw = model([variable("x", domain, "1", "0")])
    report = diagnose_model(raw)
    assert report.validation == "INVALID_MODEL"
    assert report.static_conclusion == "NOT_ANALYZED"
    assert report.findings[0].code == "INVALID_BOUNDS"
    assert report.findings[0].variable_departments == (("x", "owner"),)
    assert report.infeasibility_evidence == "NONE"


@pytest.mark.parametrize(
    "target,code",
    [
        ("variable", "UNKNOWN_VARIABLE"),
        ("parameter", "UNKNOWN_PARAMETER"),
        ("department", "UNKNOWN_DEPARTMENT"),
    ],
)
def test_invalid_references_reuse_strict_compiler(target, code):
    raw = model(constraints=[row("limit", {"x": 1}, "<=", 2)])
    if target == "variable":
        raw["constraints"][0]["terms"][0]["variable"] = "absent"
    elif target == "parameter":
        raw["constraints"][0]["rhs"] = {"parameter": "absent"}
    else:
        raw["constraints"][0]["owner_department"] = "absent"
    report = diagnose_model(raw)
    assert report.validation == "INVALID_MODEL"
    assert report.findings[0].code == code
    assert report.findings[0].constraints[0].constraint_id == "limit"
    assert report.findings[0].constraints[0].source == "synthetic_test"


def test_invalid_schema_does_not_echo_values():
    report = diagnose_model({"password": "private-unexpected-value"})
    assert report.validation == "INVALID_MODEL"
    assert "private-unexpected-value" not in report.model_dump_json()


@pytest.mark.parametrize(
    "coeff,operator,rhs", [(1, ">=", 11), (-1, ">=", 1), (1, "==", -1), (1, "<=", -1)]
)
def test_bound_interval_proofs(coeff, operator, rhs):
    report = diagnose_model(model(constraints=[row("limit", {"x": coeff}, operator, rhs)]))
    assert report.static_conclusion == "CONTRADICTION_PROVEN"
    assert report.findings[0].code == "ROW_OUTSIDE_BOUNDS"


@pytest.mark.parametrize(
    "operator,rhs,contradiction",
    [("<=", -1, True), (">=", 1, True), ("==", 1, True), ("==", 0, False)],
)
def test_zero_and_cancelled_expressions(operator, rhs, contradiction):
    raw = model(constraints=[row("constant", {}, operator, rhs)])
    raw["constraints"][0]["terms"] = (
        row("unused", {"x": 1}, "<=", 0)["terms"] + row("unused", {"x": -1}, "<=", 0)["terms"]
    )
    report = diagnose_model(raw)
    assert bool(report.findings) is contradiction


@pytest.mark.parametrize("lower_op", [">=", "=="])
@pytest.mark.parametrize("multiplier", ["2", "-0.5"])
def test_parallel_rows_exact_scaling_and_negative_direction(lower_op, multiplier):
    scale = Fraction(multiplier)
    op = lower_op if scale > 0 or lower_op == "==" else "<="
    raw = model(
        [variable("x"), variable("y")],
        constraints=[
            row("upper", {"x": 1, "y": -2}, "<=", 1),
            row("lower", {"x": multiplier, "y": str(-2 * float(scale))}, op, str(2 * float(scale))),
        ],
    )
    report = diagnose_model(raw)
    assert report.static_conclusion == "CONTRADICTION_PROVEN"
    proof = next(f for f in report.findings if f.code == "PARALLEL_ROWS_CONTRADICTION")
    assert [c.constraint_id for c in proof.constraints] == ["lower", "upper"]
    assert dict(proof.facts)["required_minimum"] == "2"
    assert dict(proof.facts)["required_maximum"] == "1"


def test_row_unit_conversion_and_unbounded_intervals():
    raw = model(
        [variable("x", lb=None, ub=None)],
        constraints=[row("hour", {"x": 1}, "<=", 1), row("minute", {"x": 60}, ">=", 120)],
    )
    raw["variables"][0]["unit"] = "hour"
    for r, unit in zip(raw["constraints"], ["hour", "minute"], strict=True):
        r["unit"] = unit
        # Both row expressions are x hours, displayed in their respective unit.
        r["terms"][0]["coefficient"] = "1"
        r["terms"][0]["coefficient_unit"] = "1"
    raw["objectives"][0]["unit"] = "hour"
    report = diagnose_model(raw)
    assert [f.code for f in report.findings] == ["PARALLEL_ROWS_CONTRADICTION"]
    assert dict(report.findings[0].facts)["required_minimum"] == "2"


def test_unbounded_signs_are_not_invented_bounds():
    raw = model(
        [variable("x", lb=None, ub="10"), variable("y", lb="0", ub=None)],
        constraints=[row("limit", {"x": -1, "y": 1}, ">=", 100)],
    )
    assert diagnose_model(raw).static_conclusion == "NO_CONCLUSION"


def test_infeasible_without_a_supported_static_proof_stays_inconclusive():
    # The three half-spaces have no common point, but no parallel pair conflicts
    # and every row intersects the variable box.
    raw = model(
        [variable("x", ub="2"), variable("y", ub="2")],
        constraints=[
            row("sum", {"x": 1, "y": 1}, "<=", 1),
            row("x_min", {"x": 1}, ">=", 1),
            row("y_min", {"y": 1}, ">=", 1),
        ],
    )
    ir = compile_model(raw)
    report = diagnose(ir, solver_status="INFEASIBLE")
    assert report.static_conclusion == "NO_CONCLUSION"
    assert report.infeasibility_evidence == "SOLVER_REPORTED"
    assert report.findings == () and report.iis_available is False
    assert all(a.state == "UNAVAILABLE" for a in report.activities)


@pytest.mark.parametrize(
    "status",
    [
        None,
        "UNKNOWN",
        "ERROR",
        "TIME_LIMIT",
        "UNBOUNDED",
        "FEASIBLE",
        "SOLUTION_FAILED_VALIDATION",
        "unbounded or infeasible",
        "OPTIMAL",
    ],
)
def test_statuses_never_become_infeasibility_proofs(status):
    report = diagnose(compile_model(model()), solver_status=status)
    assert report.static_conclusion == "NO_CONCLUSION"
    assert report.infeasibility_evidence == "NONE"
    assert report.solver_status == status and report.plan_valid is None


def test_exact_contradiction_and_tolerant_witness_are_distinct():
    raw = model(
        constraints=[row("lower", {"x": 1}, ">=", "1.00000000001"), row("upper", {"x": 1}, "<=", 1)]
    )
    ir = compile_model(raw)
    tolerant = diagnose(ir, decisions={"x": 1.0})
    assert tolerant.static_conclusion == "CONTRADICTION_PROVEN"
    assert tolerant.plan_valid is True
    assert {a.state for a in tolerant.activities} == {"SATURATED"}
    exact = diagnose(
        ir,
        decisions={"x": 1.0},
        verification_settings=VerificationSettings(constraint_tolerance="0"),
    )
    assert exact.plan_valid is False
    assert {a.state for a in exact.activities} == {"SATURATED", "VIOLATED"}
    assert all(a.cost_status == "NOT_EVALUATED" for a in exact.activities)


@pytest.mark.parametrize(
    "decisions", [{"x": 1.5}, {"x": -1.0}, {"x": float("nan")}, {}, {"x": 1.0, "unknown": 2.0}]
)
def test_corrupted_witness_rejected_without_fabricated_row_measurements(decisions):
    report = diagnose(
        compile_model(
            model([variable("x", "INTEGER")], constraints=[row("cap", {"x": 1}, "<=", 2)])
        ),
        decisions=decisions,
    )
    assert report.plan_checked and report.plan_valid is False
    assert report.plan_issues
    if (
        not decisions
        or "unknown" in decisions
        or ("x" in decisions and decisions["x"] != decisions["x"])
    ):
        assert report.activities[0].state == "UNAVAILABLE"


@pytest.mark.parametrize("sector,objective", [("factory", 4100), ("university", 17)])
def test_real_golden_offline_no_solver_in_diagnostics(monkeypatch, sector, objective):
    monkeypatch.setattr(
        socket, "create_connection", lambda *args, **kwargs: pytest.fail("network forbidden")
    )
    source = load_organization_file(ROOT / f"examples/organizations/{sector}/project.json")
    run = solve_organization(source)
    assert run.solve.objective_value == objective
    before = canonical_json(run.composition.to_dict())
    monkeypatch.setattr(
        "scipy.optimize.milp", lambda *args, **kwargs: pytest.fail("diagnostics must not solve")
    )
    report = diagnose(
        run.composition.ir,
        traces=run.composition.constraint_traces,
        decisions=dict(run.solve.decision_values),
        solver_objective=run.solve.solver_objective_value,
        solver_status=run.solve.status,
    )
    assert report.static_conclusion == "NO_CONCLUSION" and report.plan_valid is True
    assert all(a.constraint.fragment_ids for a in report.activities)
    assert canonical_json(run.composition.to_dict()) == before
    assert report == diagnose(
        run.composition.ir,
        traces=run.composition.constraint_traces,
        decisions=dict(run.solve.decision_values),
        solver_objective=run.solve.solver_objective_value,
        solver_status=run.solve.status,
    )


def test_factory_conflicting_departments_link_original_provenance():
    source = load_organization_file(
        ROOT / "examples/organizations/factory/project.json"
    ).model_dump(mode="json")
    sales = next(f for f in source["fragments"] if f["department_id"] == "sales")
    demand = row("sales_minimum", {"qty_A": 1, "qty_B": 1}, ">=", 60)
    demand.update(owner_department="sales", unit="unit", source="approved_sales_plan_v1")
    sales["constraints"] = [demand]
    original = deepcopy(source)
    composition = compose_organization_model(source)
    report = diagnose(composition.ir, traces=composition.constraint_traces)
    proof = next(f for f in report.findings if f.code == "PARALLEL_ROWS_CONTRADICTION")
    assert {c.department for c in proof.constraints} == {"sales", "logistics"}
    assert (
        next(c for c in proof.constraints if c.department == "sales").source
        == "approved_sales_plan_v1"
    )
    assert all(c.fragment_ids and c.source_paths for c in proof.constraints)
    assert source == original
    assert solve_organization(source).solve.status == "INFEASIBLE"


def test_static_proof_soundness_against_exhaustive_small_integer_boxes():
    rng = random.Random(5021)
    conclusions = set()
    for _ in range(100):
        raw = model(
            [variable("x", "INTEGER", "0", "2"), variable("y", "INTEGER", "0", "2")],
            constraints=[
                row(
                    f"c{i}",
                    {"x": rng.randint(-2, 2), "y": rng.randint(-2, 2)},
                    rng.choice(["<=", ">=", "=="]),
                    rng.randint(-4, 4),
                )
                for i in range(4)
            ],
        )
        ir = compile_model(raw)
        report = diagnose(ir)
        conclusions.add(report.static_conclusion)
        if report.static_conclusion == "CONTRADICTION_PROVEN":
            assert not any(
                verify_plan(ir, {"x": x, "y": y}).feasible for x, y in product(range(3), repeat=2)
            )
    assert conclusions == {"NO_CONCLUSION", "CONTRADICTION_PROVEN"}


@pytest.mark.parametrize("coefficient", ["1e100", "1e-100"])
def test_static_proofs_do_not_depend_on_binary64_conversion_limits(coefficient):
    raw = model(
        constraints=[
            row("upper", {"x": coefficient}, "<=", coefficient),
            row("lower", {"x": 1}, ">=", 2),
        ]
    )
    report = diagnose_model(raw)
    assert report.validation == "VALID"
    assert any(f.code == "PARALLEL_ROWS_CONTRADICTION" for f in report.findings)


def test_proofs_are_stable_under_constraint_order_and_equal_bound_ties():
    raw = model(
        constraints=[
            row("z_upper", {"x": 1}, "<=", 1),
            row("a_upper", {"x": 1}, "<=", 1),
            row("lower", {"x": 1}, ">=", 2),
        ]
    )
    before = diagnose_model(raw)
    raw["constraints"].reverse()
    after = diagnose_model(raw)
    assert before.findings == after.findings
    assert [c.constraint_id for c in before.findings[0].constraints] == ["a_upper", "lower"]
