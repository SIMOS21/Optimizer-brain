"""Phase 2 acceptance: actual HiGHS solves plus deterministic native-result faults."""

from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from fractions import Fraction
from itertools import product
import json
from pathlib import Path
import random
import socket

from fastapi.testclient import TestClient
import numpy as np
import pytest
from pydantic import ValidationError
from scipy.optimize import OptimizeResult

from brain.api import app
from brain.kernel import compile_model, verify_plan
from brain.kernel.__main__ import main
from brain.kernel.verification import SolutionVerifier, VerificationSettings
from brain.solvers.contracts import SolveSettings
from brain.solvers.highs import HighsAdapter, to_milp
from brain.solvers.orchestrator import SolverOrchestrator

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = ROOT / "examples/demo_cross_department.json"
ORIGIN = {"source": "synthetic_test", "approved": True, "version": "1"}


def variable(name, domain="CONTINUOUS", lb="0", ub="10"):
    return {"id": name, "type": domain, "lb": lb, "ub": ub, "unit": "1", "department": "owner"}


def row(identifier, coefficients, operator, rhs):
    return {
        **ORIGIN,
        "id": identifier,
        "owner_department": "owner",
        "kind": "HARD",
        "operator": operator,
        "rhs": str(rhs),
        "unit": "1",
        "terms": terms(coefficients),
    }


def terms(coefficients):
    return [
        {"variable": key, "coefficient": str(value), "coefficient_unit": "1"}
        for key, value in coefficients.items()
    ]


def model(variables=None, coefficients=None, constraints=None, sense="MAX"):
    return {
        "schema_version": "1.0",
        "id": "synthetic",
        "name": "Synthetic mathematical instance",
        "model_version": "1",
        "data_snapshot_id": "synthetic_v1",
        "scenario_id": "base",
        "departments": [{"id": "owner", "name": "Owner"}],
        "parameters": {},
        "variables": variables if variables is not None else [variable("x")],
        "constraints": constraints if constraints is not None else [],
        "objectives": [
            {
                **ORIGIN,
                "id": "objective",
                "owner_department": "owner",
                "sense": sense,
                "unit": "1",
                "terms": terms(coefficients or {"x": 1}),
            }
        ],
    }


@pytest.fixture
def golden():
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def execute(raw, **settings):
    return SolverOrchestrator().run(raw, SolveSettings(**settings))


def native(
    monkeypatch,
    *,
    status=0,
    x=(40.0, 15.0),
    fun=-4100.0,
    bound=-4100.0,
    gap=0.0,
    message="Optimal",
    success=None,
):
    calls = []

    def fake_milp(**kwargs):
        calls.append(kwargs)
        return OptimizeResult(
            status=status,
            success=(status == 0) if success is None else success,
            message=message,
            x=None if x is None else np.asarray(x),
            fun=fun,
            mip_dual_bound=bound,
            mip_gap=gap,
        )

    monkeypatch.setattr("brain.solvers.highs.milp", fake_milp)
    return calls


def test_actual_golden_proof_and_traceability(golden):
    result = execute(golden)
    assert result.status == result.public_status == "OPTIMAL"
    assert result.objective_value == 4100
    assert dict(result.decision_values) == {"qty_A": 40, "qty_B": 15}
    assert result.validation_report.valid
    assert result.validation_report.objective_difference == 0
    assert result.best_bound == 4100 and result.absolute_gap == result.relative_gap == 0
    assert result.certificate_scope == "solver_tolerances"
    assert "tolérance" in result.optimality_label
    assert result.conversion_report.rounded_count == 0
    assert result.primal_residual_max == result.integrality_residual_max == 0
    assert result.model_hash == compile_model(golden).model_hash
    assert result.model_version == "1.0.0" and result.data_snapshot_id == "synthetic_demo_v1"
    assert result.run_id and result.started_at.endswith("+00:00") and result.duration_ms > 0
    assert result.solver_name == "highs" and result.interface_version
    assert dict(result.solver_options)["mip_rel_gap"] == 0
    assert json.loads(json.dumps(result.to_dict(), allow_nan=False))["objective_value"] == "4100"
    assert execute(golden).run_id != result.run_id


def test_sparse_translation_preserves_bounds_domains_senses_and_comparators():
    instance = model(
        [
            variable("x", "BINARY", "0", "1"),
            variable("y", "INTEGER", "-2", "5"),
            variable("z", lb=None, ub=None),
        ],
        {"x": 2, "y": -3, "z": 4},
        [
            row("a", {"x": 1, "z": -2}, "<=", 3),
            row("b", {"y": -1}, ">=", -4),
            row("c", {"x": 1, "z": 1}, "==", 1),
        ],
    )
    original = deepcopy(instance)
    ir = compile_model(instance)
    problem = to_milp(ir)
    assert problem.constraints.A.format == "csc"
    assert problem.constraints.A.nnz == 5
    np.testing.assert_array_equal(problem.objective, [-2, 3, -4])
    np.testing.assert_array_equal(problem.integrality, [1, 1, 0])
    np.testing.assert_array_equal(problem.lower_bounds, [0, -2, -np.inf])
    np.testing.assert_array_equal(problem.upper_bounds, [1, 5, np.inf])
    np.testing.assert_array_equal(problem.constraints.lb, [-np.inf, -4, 1])
    np.testing.assert_array_equal(problem.constraints.ub, [3, np.inf, 1])
    instance["objectives"][0]["sense"] = "MIN"
    np.testing.assert_array_equal(to_milp(compile_model(instance)).objective, [2, -3, 4])
    assert ir == compile_model(original)
    caps = HighsAdapter().get_capabilities()
    assert caps.domains == ("CONTINUOUS", "INTEGER", "BINARY")
    assert HighsAdapter().supports(ir).supported


@pytest.mark.parametrize("sense", ["MIN", "MAX"])
@pytest.mark.parametrize("seed", range(6))
def test_small_integer_problems_against_independent_exhaustive_oracle(sense, seed):
    rng = random.Random(seed)
    costs = [rng.randint(-7, 9) for _ in range(3)]
    cap = rng.randint(3, 10)
    feasible = [
        (sum(c * x for c, x in zip(costs, values)), values)
        for values in product(range(5), repeat=3)
        if sum(values) <= cap and 2 * values[0] + values[1] >= 2 and values[0] == values[2]
    ]
    best = (max if sense == "MAX" else min)(v[0] for v in feasible)
    instance = model(
        [variable(k, "INTEGER", "0", "4") for k in "xyz"],
        dict(zip("xyz", costs)),
        [
            row("cap", dict.fromkeys("xyz", 1), "<=", cap),
            row("minimum", {"x": 2, "y": 1}, ">=", 2),
            row("link", {"x": 1, "z": -1}, "==", 0),
        ],
        sense,
    )
    result = execute(instance)
    assert result.status == "OPTIMAL"
    assert result.objective_value == best
    assert result.validation_report.valid
    assert tuple(value for _, value in result.decision_values) in [
        v[1] for v in feasible if v[0] == best
    ]


@pytest.mark.parametrize("operator", [">=", "=="])
def test_continuous_fractional_solution_raw_residual_and_zero_tolerance(operator):
    instance = model(constraints=[row("third", {"x": 3}, operator, 1)], sense="MIN")
    result = execute(instance)
    assert result.status == "OPTIMAL"
    assert dict(result.decision_values)["x"] == pytest.approx(1 / 3)
    assert result.objective_value == Fraction.from_float(dict(result.decision_values)["x"])
    assert result.primal_residual_max > 0
    zero = VerificationSettings(
        bound_tolerance="0", constraint_tolerance="0", integrality_tolerance="0"
    )
    rejected = execute(instance, verification=zero)
    assert rejected.status == "SOLUTION_FAILED_VALIDATION"
    assert rejected.decision_values is rejected.objective_value is None


def test_mixed_binary_integer_and_continuous():
    instance = model(
        [
            variable("b", "BINARY", "0", "1"),
            variable("c", ub="2"),
            variable("i", "INTEGER", "0", "5"),
        ],
        {"b": 9, "c": 1, "i": 5},
        [
            row("capacity", {"b": 2, "c": 1, "i": 1}, "<=", "4.5"),
            row("selected", {"b": 1}, "==", 1),
        ],
    )
    result = execute(instance)
    assert result.status == "OPTIMAL" and result.objective_value == Fraction(39, 2)
    assert dict(result.decision_values) == {"b": 1, "c": 0.5, "i": 2}


@pytest.mark.parametrize("domain", ["CONTINUOUS", "INTEGER"])
def test_unbounded_actual_backend_and_nullable_bounds(domain):
    instance = model([variable("x", domain, "0", None)])
    result = execute(instance, presolve=False)
    assert result.status == "UNBOUNDED"
    assert result.decision_values is result.objective_value is None
    assert result.best_bound is result.relative_gap is None
    ir = compile_model(instance)
    assert verify_plan(ir, {"x": 123}).feasible
    assert not verify_plan(ir, {"x": -1}).feasible


def test_free_variable_minimization_and_static_unbounded_intervals():
    instance = model(
        [variable("x", lb=None, ub=None)],
        constraints=[row("floor", {"x": 1}, ">=", -3)],
        sense="MIN",
    )
    result = execute(instance)
    assert result.status == "OPTIMAL" and result.objective_value == -3
    assert not compile_model(instance).warnings
    instance["variables"][0]["ub"] = "-4"
    assert compile_model(instance).warnings[0].code == "INFEASIBLE_BY_BOUNDS"


@pytest.mark.parametrize(
    "constraints",
    [
        [row("a", {"x": 1}, ">=", 2), row("b", {"x": 1}, "<=", 1)],
        [row("constant", {}, "==", 1)],
        [row("integer_only", {"x": 2}, "==", 1)],
    ],
)
def test_infeasible_actual_backend(constraints):
    result = execute(model([variable("x", "INTEGER")], constraints=constraints))
    assert result.status == result.public_status == "INFEASIBLE"
    assert result.decision_values is None and result.validation_report is None


@pytest.mark.parametrize("has_solution", [False, True])
def test_timeout_with_and_without_verified_incumbent(golden, monkeypatch, has_solution):
    calls = native(
        monkeypatch,
        status=1,
        x=(40, 15) if has_solution else None,
        fun=-4100 if has_solution else None,
        bound=-4200,
        gap=100 / 4100 if has_solution else None,
        message="Time limit reached. (HiGHS Status 13: Time limit reached)",
    )
    result = execute(golden, time_limit_seconds=0.25, node_limit=10, presolve=False)
    assert result.status == "TIME_LIMIT"
    assert result.termination_reason == "time_limit"
    assert calls[0]["options"]["time_limit"] == 0.25
    assert calls[0]["options"]["node_limit"] == 10
    assert dict(result.solver_options)["presolve"] is False
    assert result.best_bound == 4200
    if has_solution:
        assert result.public_status == "FEASIBLE_NOT_PROVEN_OPTIMAL"
        assert result.objective_value == 4100 and result.absolute_gap == 100
        assert result.validation_report.valid
    else:
        assert result.public_status == "TIME_LIMIT_NO_SOLUTION"
        assert result.decision_values is result.relative_gap is result.absolute_gap is None
    assert result.certificate_scope is None


def test_real_native_time_limit():
    rng = random.Random(91)
    names = [f"x{i:04}" for i in range(800)]
    instance = model(
        [variable(k, "BINARY", "0", "1") for k in names],
        {k: rng.randint(1, 100) for k in names},
        [row(f"r{i}", {k: rng.randint(1, 100) for k in names}, "<=", 15000) for i in range(12)],
    )
    result = execute(instance, presolve=False, time_limit_seconds=1e-9)
    assert result.status == "TIME_LIMIT", result.solver_message
    assert result.solver_status_raw == 1
    assert result.decision_values is None


@pytest.mark.parametrize(
    "status,message,x,expected",
    [
        (99, "unrecognized", None, "UNKNOWN"),
        (99, "unrecognized", (40, 15), "FEASIBLE"),
        (1, "Iteration or node limit reached", (40, 15), "FEASIBLE"),
        (1, "Iteration or node limit reached", None, "UNKNOWN"),
        (4, "The problem is unbounded or infeasible", None, "UNKNOWN"),
        (4, "native error", None, "ERROR"),
    ],
)
def test_unknown_ambiguous_and_feasible_statuses(golden, monkeypatch, status, message, x, expected):
    native(
        monkeypatch,
        status=status,
        message=message,
        x=x,
        fun=-4100 if x else None,
        bound=None,
        gap=None,
    )
    result = execute(golden)
    assert result.status == expected
    assert result.certificate_scope is None
    assert result.best_bound is result.absolute_gap is result.relative_gap is None


@pytest.mark.parametrize(
    "x,fun",
    [
        ((41, 15), -4180),
        ((40, 15), -1),
        ((40.01, 14), -4040.8),
        ((float("nan"), 15), -4100),
        ((40, float("inf")), -4100),
        ((40,), -4100),
        ((40, 15, 0), -4100),
        ((40, 15), float("nan")),
    ],
)
def test_corrupted_solutions_never_published(golden, monkeypatch, x, fun):
    native(monkeypatch, x=x, fun=fun)
    result = execute(golden)
    assert result.status == "SOLUTION_FAILED_VALIDATION"
    assert result.decision_values is result.objective_value is result.certificate_scope is None
    assert not result.validation_report.valid
    json.dumps(result.to_dict(), allow_nan=False)


def test_raw_integrality_not_rounded_before_verification(golden, monkeypatch):
    native(monkeypatch, x=(39.99999999, 15), fun=-(80 * 39.99999999 + 60 * 15))
    result = execute(golden)
    assert result.status == "OPTIMAL"
    assert dict(result.decision_values)["qty_A"] == 39.99999999
    assert result.integrality_residual_max > 0
    zero = VerificationSettings(integrality_tolerance="0")
    assert execute(golden, verification=zero).status == "SOLUTION_FAILED_VALIDATION"


def test_missing_or_nonfinite_backend_metrics_are_not_fabricated(golden, monkeypatch):
    native(monkeypatch, bound=None, gap=None)
    result = execute(golden)
    assert result.status == "OPTIMAL"  # Native status is evidence, even if bound is unavailable.
    assert result.best_bound is result.absolute_gap is result.relative_gap is None
    native(monkeypatch, bound=float("inf"), gap=float("inf"))
    result = execute(golden)
    assert result.best_bound is result.absolute_gap is result.relative_gap is None
    json.dumps(result.to_dict(), allow_nan=False)
    native(monkeypatch, fun=None, bound=None, gap=None)
    result = execute(golden)
    assert result.status == "FEASIBLE" and result.objective_value == 4100


def test_missing_vector_and_contradictory_success_or_bound(golden, monkeypatch):
    native(monkeypatch, x=None)
    assert execute(golden).status == "ERROR"
    native(monkeypatch, success=False)
    assert execute(golden).status == "FEASIBLE"
    native(monkeypatch, bound=-4000)
    result = execute(golden)
    assert result.status == "FEASIBLE"
    assert result.best_bound is result.absolute_gap is result.relative_gap is None


@pytest.mark.parametrize("value", ["1e100", "1e-100", "0.000000001", "1000000000001"])
def test_unsafe_numeric_ranges_rejected_before_backend(value, monkeypatch):
    instance = model(coefficients={"x": value})

    def forbidden(**kwargs):
        pytest.fail("Unsafe numeric model must not reach backend")

    monkeypatch.setattr("brain.solvers.highs.milp", forbidden)
    ir = compile_model(instance)
    assert not HighsAdapter().supports(ir).supported
    result = execute(instance)
    assert result.status == "INVALID_MODEL" and result.decision_values is None


def test_inexact_conversion_is_measured_and_proof_downgraded():
    instance = model(coefficients={"x": "0.1"})
    result = execute(instance)
    assert result.status == "FEASIBLE"
    assert result.objective_value == 1
    assert result.conversion_report.rounded_count == 1
    assert result.conversion_report.max_absolute_error > 0
    assert result.certificate_scope is None
    # A backend proof for a rounded model is not an infeasibility proof for the original.
    instance["constraints"] = [row("a", {"x": 1}, ">=", 2), row("b", {"x": 1}, "<=", 1)]
    assert execute(instance).status == "UNKNOWN"


def test_bound_collapse_and_integer_precision_guard():
    instance = model([variable("x", lb="1", ub="1.00000000000000000001")])
    assert execute(instance).status == "INVALID_MODEL"
    instance = model([variable("x", "INTEGER", "0", "9007199254740993")])
    assert execute(instance).status == "INVALID_MODEL"


@pytest.mark.parametrize(
    "settings",
    [
        {"time_limit_seconds": True},
        {"time_limit_seconds": 0},
        {"time_limit_seconds": float("nan")},
        {"time_limit_seconds": 301},
        {"mip_rel_gap": -1.0},
        {"mip_rel_gap": float("inf")},
        {"node_limit": True},
        {"node_limit": -1},
        {"ignored": 1},
    ],
)
def test_strict_settings(settings):
    with pytest.raises(ValidationError):
        SolveSettings.model_validate(settings)


def test_backend_exception_and_invalid_model_are_normalized(golden, monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("synthetic native failure")

    monkeypatch.setattr("brain.solvers.highs.milp", broken)
    result = execute(golden)
    assert result.status == "ERROR" and result.public_status == "SOLVER_ERROR"
    assert result.decision_values is None
    golden["variables"][0]["ub"] = "-1"
    assert execute(golden).status == "INVALID_MODEL"


def test_zero_objective_is_valid_and_not_missing():
    result = execute(model(coefficients={"x": 0}))
    assert result.status == "OPTIMAL" and result.objective_value == 0
    assert result.validation_report.valid


def test_nonzero_native_gap_is_qualified_not_strict_optimum(golden, monkeypatch):
    native(monkeypatch, bound=-4110, gap=10 / 4100)
    result = execute(golden, mip_rel_gap=0.01)
    assert result.status == "OPTIMAL" and result.absolute_gap == 10
    assert result.relative_gap == 10 / 4100
    assert result.certificate_scope == "solver_tolerances"
    assert "tolérance" in result.optimality_label


def test_verifier_independent_of_backend(golden, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("No solver or network in verifier")

    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr("brain.solvers.highs.milp", forbidden)
    ir = compile_model(golden)
    report = SolutionVerifier().verify(
        ir, {"qty_A": 40.0, "qty_B": 15.0}, 4100.0, VerificationSettings()
    )
    assert report.valid
    assert (
        not SolutionVerifier()
        .verify(ir, {"qty_A": 41.0, "qty_B": 15.0}, 4180.0, VerificationSettings())
        .valid
    )


def test_offline_full_pipeline(golden, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Network access forbidden")

    monkeypatch.setattr(socket, "socket", forbidden)
    for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    assert execute(golden).status == "OPTIMAL"


def test_optional_version_metadata_fallback(monkeypatch):
    def missing(*args, **kwargs):
        raise ImportError("Old SciPy layout")

    monkeypatch.setattr("brain.solvers.highs.import_module", missing)
    result = execute(model())
    assert result.status == "OPTIMAL" and result.solver_version is None
    assert result.backend_defaults == ()


def test_duplicate_raw_ids_are_refused(golden):
    class DuplicateAdapter(HighsAdapter):
        def solve(self, ir, settings):
            return replace(
                super().solve(ir, settings),
                decisions=(("qty_A", 40.0), ("qty_A", 40.0), ("qty_B", 15.0)),
            )

    result = SolverOrchestrator(DuplicateAdapter()).run(golden)
    assert result.status == "SOLUTION_FAILED_VALIDATION" and result.decision_values is None
    assert not result.validation_report.valid


def test_cli_solve_and_invalid_settings(tmp_path, capsys):
    output = tmp_path / "solved.json"
    assert main(["solve", str(GOLDEN), "--output", str(output)]) == 0
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["decision_values"] == {"qty_A": 40, "qty_B": 15}
    assert result["objective_value"] == "4100"
    assert main(["solve", str(GOLDEN), "--time-limit", "0"]) == 2
    assert "error" in capsys.readouterr().err
    impossible = tmp_path / "impossible.json"
    impossible.write_text(
        json.dumps(model(constraints=[row("bad", {}, "==", 1)])), encoding="utf-8"
    )
    assert main(["solve", str(impossible)]) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "INFEASIBLE"


def test_api_validate_solve_and_infeasible(golden):
    client = TestClient(app)
    response = client.post("/api/v1/models/validate", json={"model": golden})
    assert response.status_code == 200, response.text
    assert response.json()["valid"] and response.json()["support"]["supported"]
    response = client.post(
        "/api/v1/models/solve", json={"model": golden, "settings": {"time_limit_seconds": 1.5}}
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "OPTIMAL"
    assert response.json()["objective_value"] == "4100"
    assert response.json()["validation_report"]["valid"]
    response = client.post(
        "/api/v1/models/solve", json={"model": model(constraints=[row("bad", {}, "==", 1)])}
    )
    assert response.status_code == 200 and response.json()["status"] == "INFEASIBLE"
    assert client.get("/health").json()["llm_required"] is False
    assert "/optimize" in client.get("/openapi.json").json()["paths"]


@pytest.mark.parametrize("path", ["validate", "solve"])
def test_api_rejects_schema_semantics_settings_and_duplicate_keys(golden, path):
    client = TestClient(app)
    endpoint = "/api/v1/models/" + path
    assert client.post(endpoint, json={"model": golden, "override": True}).status_code == 422
    bad = deepcopy(golden)
    bad["constraints"][0]["rhs"] = {"parameter": "unknown"}
    assert client.post(endpoint, json={"model": bad}).status_code == 422
    bad["constraints"][0]["rhs"] = "100000000000000000000000000000"
    assert client.post(endpoint, json={"model": bad}).status_code == 422
    text = '{"model":' + json.dumps(golden) + ',"model":' + json.dumps(golden) + "}"
    assert (
        client.post(
            endpoint, content=text, headers={"content-type": "application/json"}
        ).status_code
        == 422
    )
    if path == "solve":
        assert (
            client.post(
                endpoint, json={"model": golden, "settings": {"shell": "anything"}}
            ).status_code
            == 422
        )


def test_api_preserves_raw_decimal_digits():
    client = TestClient(app)
    literal = "0.123456789012345678901234567890123456789"
    instance = model(coefficients={"x": literal})
    text = json.dumps({"model": instance}).replace('"' + literal + '"', literal)
    response = client.post(
        "/api/v1/models/validate", content=text, headers={"content-type": "application/json"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["ir"]["objectives"][0]["terms"][0]["coefficient"] == str(
        Fraction(Decimal(literal))
    )


def test_api_nonstandard_nan_is_422():
    text = json.dumps({"model": model()}).replace('"coefficient": "1"', '"coefficient": NaN')
    response = TestClient(app).post(
        "/api/v1/models/solve", content=text, headers={"content-type": "application/json"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("literal", ["Infinity", "-Infinity", "1e400", "1e-400"])
def test_api_invalid_numeric_literals_are_422(literal):
    text = json.dumps({"model": model()}).replace('"coefficient": "1"', '"coefficient": ' + literal)
    response = TestClient(app).post(
        "/api/v1/models/solve", content=text, headers={"content-type": "application/json"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "settings",
    [
        {"constraint_tolerance": "-1"},
        {"constraint_tolerance": "NaN"},
        {"bound_tolerance": "1"},
        {"integrality_tolerance": "0.5"},
        {"objective_absolute_tolerance": "1"},
        {"objective_relative_tolerance": "0.1"},
    ],
)
def test_numerical_tolerances_cannot_be_business_relaxations(settings):
    with pytest.raises(ValidationError):
        VerificationSettings.model_validate(settings)


def test_nonzero_negative_native_gap_refuses_proof(golden, monkeypatch):
    native(monkeypatch, gap=-0.1)
    result = execute(golden)
    assert result.status == "FEASIBLE" and result.relative_gap is None
    assert result.certificate_scope is None


def test_native_inconsistent_optimal_code_refuses_proof(golden):
    class InconsistentAdapter(HighsAdapter):
        def solve(self, ir, settings):
            return replace(super().solve(ir, settings), status_code=99)

    assert SolverOrchestrator(InconsistentAdapter()).run(golden).status == "FEASIBLE"


@pytest.mark.parametrize("message", ["Unknown", "Time limit reached", "Unbounded or infeasible"])
def test_contradictory_native_message_never_optimal(golden, monkeypatch, message):
    native(monkeypatch, message=message)
    assert execute(golden).status == "FEASIBLE"
