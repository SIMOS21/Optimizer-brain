"""Kernel contracts and independent small-instance mathematical oracles."""

from copy import deepcopy
from dataclasses import FrozenInstanceError
from decimal import Decimal, localcontext
from fractions import Fraction
import json
from pathlib import Path
import socket
import subprocess
import sys

import pytest
from pydantic import ValidationError

from brain.kernel import (
    ModelCompilationError,
    ModelDSL,
    compile_model,
    load_model_json,
    verify_plan,
)
from brain.kernel.__main__ import main
from brain.kernel.ir import to_data
from brain.kernel.units import parse_unit

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "examples" / "demo_cross_department.json"


@pytest.fixture
def raw():
    return json.loads(MODEL.read_text(encoding="utf-8"))


def _single_variable(raw, *, domain="CONTINUOUS", unit="1", lb="-5", ub="5"):
    model = deepcopy(raw)
    model["variables"] = [
        {
            "id": "x",
            "type": domain,
            "lb": lb,
            "ub": ub,
            "unit": unit,
            "department": "sales",
        }
    ]
    model["constraints"] = []
    model["objectives"][0].update(
        unit=unit,
        sense="MIN",
        terms=[{"variable": "x", "coefficient": "1", "coefficient_unit": "1"}],
    )
    return model


def test_golden_compilation_and_exhaustive_independent_oracle(raw):
    ir = compile_model(raw)
    rows = {row.id: row for row in ir.constraints}
    assert {term.variable: term.coefficient for term in rows["production_machine"].terms} == {
        "qty_A": 2,
        "qty_B": 1,
    }
    assert {term.variable: term.coefficient for term in rows["finance_budget"].terms} == {
        "qty_A": 100,
        "qty_B": 200,
    }
    assert {term.variable: term.coefficient for term in rows["logistics_delivery"].terms} == {
        "qty_A": 1,
        "qty_B": 1,
    }
    assert [v.lb for v in ir.variables] == [0, 0]
    assert [v.ub for v in ir.variables] == [40, 35]
    assert {v.domain for v in ir.variables} == {"INTEGER"}
    best = -1
    winners = []
    for a in range(41):
        for b in range(36):
            # This oracle is deliberately independent of both IR and interpreter.
            feasible = 2 * a + b <= 100 and 100 * a + 200 * b <= 8000 and a + b <= 55
            value = 80 * a + 60 * b
            report = verify_plan(ir, {"qty_A": a, "qty_B": b})
            assert report.feasible == feasible
            assert report.objectives[0].value == value
            if feasible and value > best:
                best, winners = value, [(a, b)]
            elif feasible and value == best:
                winners.append((a, b))
    assert (best, winners) == (4100, [(40, 15)])
    report = verify_plan(ir, {"qty_A": 40, "qty_B": 15})
    assert {r.id: (r.lhs, r.slack) for r in report.constraints} == {
        "production_machine": (95, 5),
        "finance_budget": (7000, 1000),
        "logistics_delivery": (55, 0),
    }


@pytest.mark.parametrize(
    "value",
    [
        True,
        False,
        None,
        "NaN",
        "Infinity",
        "-Infinity",
        float("nan"),
        float("inf"),
        "1e101",
        "1e-101",
        "9" * 101,
        "__import__('os')",
        "1 + 2",
        {},
        [],
    ],
)
def test_invalid_numeric_coefficients(raw, value):
    raw["constraints"][0]["terms"][0]["coefficient"] = value
    with pytest.raises(ValidationError):
        compile_model(raw)


@pytest.mark.parametrize(
    "target",
    [
        "model",
        "variable",
        "parameter",
        "constraint",
        "term",
        "objective",
        "department",
        "reference",
    ],
)
def test_extra_fields_rejected_at_every_level(raw, target):
    locations = {
        "model": raw,
        "variable": raw["variables"][0],
        "parameter": raw["parameters"]["machine_capacity_hours"],
        "constraint": raw["constraints"][0],
        "term": raw["constraints"][0]["terms"][0],
        "objective": raw["objectives"][0],
        "department": raw["departments"][0],
        "reference": raw["constraints"][0]["rhs"],
    }
    locations[target]["ignore_constraints"] = True
    with pytest.raises(ValidationError):
        compile_model(raw)


@pytest.mark.parametrize("field", ["variables", "constraints", "objectives", "departments"])
def test_duplicate_identifiers_rejected(raw, field):
    raw[field].append(deepcopy(raw[field][0]))
    with pytest.raises(ValidationError):
        compile_model(raw)


@pytest.mark.parametrize(
    "change,code,path",
    [
        ("variable_reference", "UNKNOWN_VARIABLE", "constraints[0].terms[0].variable"),
        ("parameter_reference", "UNKNOWN_PARAMETER", "constraints[0].rhs"),
        ("department", "UNKNOWN_DEPARTMENT", "variables[0].department"),
        ("owner", "UNKNOWN_DEPARTMENT", "constraints[0].owner_department"),
        ("objective_owner", "UNKNOWN_DEPARTMENT", "objectives[0].owner_department"),
        ("units", "UNIT_MISMATCH", "constraints[0].terms[0]"),
        ("parameter_units", "UNIT_MISMATCH", "constraints[0].rhs"),
        ("bounds", "INVALID_BOUNDS", "variables[0]"),
        ("fractional_integer", "INVALID_DOMAIN", "variables[0]"),
        ("approval", "UNAPPROVED", "constraints[0].approved"),
        ("parameter_approval", "UNAPPROVED", "parameters.machine_capacity_hours.approved"),
        ("objective_approval", "UNAPPROVED", "objectives[0].approved"),
    ],
)
def test_semantic_errors_are_localized(raw, change, code, path):
    def apply_change():
        if change == "variable_reference":
            raw["constraints"][0]["terms"][0]["variable"] = "unknown"
        elif change == "parameter_reference":
            raw["constraints"][0]["rhs"] = {"parameter": "unknown"}
        elif change == "department":
            raw["variables"][0]["department"] = "unknown"
        elif change == "owner":
            raw["constraints"][0]["owner_department"] = "unknown"
        elif change == "objective_owner":
            raw["objectives"][0]["owner_department"] = "unknown"
        elif change == "units":
            raw["constraints"][0]["terms"][0]["coefficient_unit"] = "EUR/unit"
        elif change == "parameter_units":
            raw["parameters"]["machine_capacity_hours"]["unit"] = "EUR"
        elif change == "bounds":
            raw["variables"][0]["lb"] = "41"
        elif change == "fractional_integer":
            raw["variables"][0]["lb"] = "0.1"
        elif change == "approval":
            raw["constraints"][0]["approved"] = False
        elif change == "parameter_approval":
            raw["parameters"]["machine_capacity_hours"]["approved"] = False
        elif change == "objective_approval":
            raw["objectives"][0]["approved"] = False

    apply_change()
    with pytest.raises(ModelCompilationError) as exc:
        compile_model(raw)
    assert exc.value.issues[0].code == code
    assert exc.value.issues[0].path == path


@pytest.mark.parametrize(
    "unit",
    ["EUR+hour", "EUR/MAD/hour", "unknown", "", "hour^9", "hour//unit", "(hour)", "hour /unit"],
)
def test_ambiguous_or_unknown_units_rejected(raw, unit):
    raw["constraints"][0]["unit"] = unit
    with pytest.raises(ValidationError):
        compile_model(raw)


def test_currency_dimensions_are_distinct(raw):
    raw["constraints"][1]["terms"][0]["coefficient_unit"] = "MAD/unit"
    with pytest.raises(ModelCompilationError, match="UNIT_MISMATCH"):
        compile_model(raw)


def test_unit_scaling_and_parameter_references_in_all_positions(raw):
    raw["parameters"]["machine_capacity_hours"].update(value="6000", unit="minute")
    origin = {"source": "synthetic", "approved": True, "version": "1"}
    raw["parameters"]["rate"] = {**origin, "value": "120", "unit": "minute/unit"}
    raw["parameters"]["upper"] = {**origin, "value": "40", "unit": "unit"}
    raw["constraints"][0]["terms"][0]["coefficient"] = {"parameter": "rate"}
    raw["variables"][0]["ub"] = {"parameter": "upper"}
    ir = compile_model(raw)
    row = next(r for r in ir.constraints if r.id == "production_machine")
    assert row.rhs == 100
    assert row.terms[0].coefficient == 2
    assert verify_plan(ir, {"qty_A": 40, "qty_B": 15}).feasible
    # A different declared coefficient unit also converts exactly.
    raw["constraints"][0]["terms"][0]["coefficient_unit"] = "minute/unit"
    assert compile_model(raw).model_hash == ir.model_hash
    assert parse_unit("hour/unit").multiply(parse_unit("unit")) == parse_unit("hour")
    assert parse_unit("unit/unit") == parse_unit("1")
    assert parse_unit("kg*meter/second^2").dimensions == (("length", 1), ("mass", 1), ("time", -2))


def test_variable_unit_scale_is_included(raw):
    model = _single_variable(raw, unit="minute", lb="0", ub="120")
    model["objectives"][0].update(unit="hour")
    ir = compile_model(model)
    assert verify_plan(ir, {"x": 90}).objectives[0].value == Fraction(3, 2)


def test_canonical_hash_and_term_normalization(raw):
    ir = compile_model(raw)
    changed = deepcopy(raw)
    changed["variables"].reverse()
    changed["constraints"].reverse()
    changed["departments"].reverse()
    for row in changed["constraints"]:
        row["terms"].reverse()
    assert compile_model(changed).model_hash == ir.model_hash
    changed["name"] = "Other label"
    changed["model_version"] = "2"
    changed["data_snapshot_id"] = "other_snapshot"
    changed["parameters"]["unused"] = {
        "value": "123",
        "unit": "unit",
        "source": "synthetic",
        "approved": True,
        "version": "1",
    }
    assert compile_model(changed).model_hash == ir.model_hash
    assert compile_model(changed).manifest_hash != ir.manifest_hash
    changed["parameters"]["delivery_capacity_units"]["value"] = "45"
    assert compile_model(changed).model_hash != ir.model_hash
    assert not verify_plan(compile_model(changed), {"qty_A": 40, "qty_B": 15}).feasible
    # Original snapshot is detached, unchanged and still feasible.
    assert verify_plan(ir, {"qty_A": 40, "qty_B": 15}).feasible
    with pytest.raises(FrozenInstanceError):
        ir.variables[0].lb = Fraction(99)


def test_aggregate_repeated_cancelled_and_zero_terms(raw):
    ir = compile_model(raw)
    term = raw["constraints"][0]["terms"][0]
    term["coefficient"] = "1.0"
    raw["constraints"][0]["terms"].extend(
        [
            {**term, "coefficient": "2"},
            {**term, "coefficient": "-1"},
            {**term, "coefficient": "0"},
        ]
    )
    assert compile_model(raw).model_hash == ir.model_hash
    raw["constraints"][0]["terms"][-1]["variable"] = "unknown"
    with pytest.raises(ModelCompilationError, match="UNKNOWN_VARIABLE"):
        compile_model(raw)


@pytest.mark.parametrize(
    "plan",
    [
        {},
        {"qty_A": 40},
        {"qty_A": 40, "qty_B": 15, "extra": 1},
        {"qty_A": True, "qty_B": 15},
        {"qty_A": "NaN", "qty_B": 15},
        {"qty_A": 41, "qty_B": 0},
        {"qty_A": -1, "qty_B": 0},
        {"qty_A": 40.1, "qty_B": 14},
        {"qty_A": 40, "qty_B": 16},
    ],
)
def test_invalid_plans_never_accepted(raw, plan):
    assert not verify_plan(compile_model(raw), plan).feasible


@pytest.mark.parametrize(
    "operator,rhs,valid,invalid",
    [("<=", "1", "1", "2"), (">=", "1", "2", "0"), ("==", "-1", "-1", "0")],
)
def test_interpreter_operators_negative_coefficients_and_bounds(raw, operator, rhs, valid, invalid):
    model = _single_variable(raw)
    row = deepcopy(raw["constraints"][0])
    row.update(
        unit="1",
        operator=operator,
        rhs=rhs,
        terms=[{"variable": "x", "coefficient": "1", "coefficient_unit": "1"}],
    )
    model["constraints"] = [row]
    ir = compile_model(model)
    assert verify_plan(ir, {"x": valid}).feasible
    assert not verify_plan(ir, {"x": invalid}).feasible
    model["constraints"][0]["terms"][0]["coefficient"] = "-1"
    negated = compile_model(model)
    assert verify_plan(negated, {"x": str(-Decimal(valid))}).feasible
    assert not verify_plan(negated, {"x": str(-Decimal(invalid))}).feasible


def test_exact_decimals_not_affected_by_decimal_context(raw):
    model = _single_variable(raw, lb="0", ub="1")
    model["objectives"][0]["terms"][0]["coefficient"] = "0.123456789012345678901234567890123456789"
    with localcontext() as context:
        context.prec = 2
        ir = compile_model(model)
        report = verify_plan(ir, {"x": "0.3"})
    expected = Fraction(Decimal("0.123456789012345678901234567890123456789")) * Fraction(3, 10)
    assert report.objectives[0].value == expected
    text = json.dumps(model).replace(
        '"0.123456789012345678901234567890123456789"', "0.123456789012345678901234567890123456789"
    )
    assert compile_model(load_model_json(text)).model_hash == ir.model_hash


def test_explicit_tolerances_no_rounding(raw):
    model = _single_variable(raw, domain="INTEGER", lb="0", ub="1")
    ir = compile_model(model)
    assert not verify_plan(ir, {"x": "1.000001"}).feasible
    report = verify_plan(
        ir, {"x": "1.000001"}, bound_tolerance="0.000001", integrality_tolerance="0.000001"
    )
    assert report.feasible
    assert report.variables[0].value == Fraction(1000001, 1000000)
    assert report.variables[0].integrality_residual == Fraction(1, 1000000)
    with pytest.raises(ValueError):
        verify_plan(ir, {"x": 1}, bound_tolerance="-0.1")
    with pytest.raises(ValueError):
        verify_plan(ir, {"x": 1}, integrality_tolerance="0.5")
    with pytest.raises(ValueError):
        verify_plan(ir, {"x": 1}, constraint_tolerance=float("inf"))
    raw["constraints"][0]["rhs"] = "94.999999"
    ir = compile_model(raw)
    assert not verify_plan(ir, {"qty_A": 40, "qty_B": 15}).feasible
    assert verify_plan(ir, {"qty_A": 40, "qty_B": 15}, constraint_tolerance="0.000001").feasible


@pytest.mark.parametrize(
    "domain,lb,ub,unit,accepted",
    [
        ("BINARY", "0", "1", "1", True),
        ("BINARY", "1", "1", "1", True),
        ("BINARY", "0", "2", "1", False),
        ("BINARY", "0", "1", "unit", False),
        ("INTEGER", "-2", "5", "1", True),
        ("INTEGER", "0", "1.1", "1", False),
        ("CONTINUOUS", "0.1", "1.1", "1", True),
    ],
)
def test_variable_domains(raw, domain, lb, ub, unit, accepted):
    model = _single_variable(raw, domain=domain, lb=lb, ub=ub, unit=unit)
    if accepted:
        assert verify_plan(compile_model(model), {"x": lb}).feasible
    else:
        with pytest.raises(ModelCompilationError):
            compile_model(model)


@pytest.mark.parametrize("operator,rhs", [("<=", "-1"), (">=", "121"), ("==", "121")])
def test_obvious_infeasible_bounds_warning_not_silent_relaxation(raw, operator, rhs):
    raw["constraints"][0].update(operator=operator, rhs=rhs)
    ir = compile_model(raw)
    assert ir.warnings[0].code == "INFEASIBLE_BY_BOUNDS"
    assert not verify_plan(ir, {"qty_A": 40, "qty_B": 15}).feasible
    assert len(ir.constraints) == 3


def test_constant_constraints_and_cancelled_terms(raw):
    raw["constraints"][0].update(terms=[], rhs="-1")
    ir = compile_model(raw)
    assert ir.warnings
    assert not verify_plan(ir, {"qty_A": 0, "qty_B": 0}).feasible
    raw["constraints"][0]["rhs"] = "0"
    ir = compile_model(raw)
    assert not ir.warnings
    assert verify_plan(ir, {"qty_A": 0, "qty_B": 0}).feasible


def test_unsupported_constructs_and_strict_types(raw):
    variants = []
    for field, value in [("kind", "SOFT"), ("operator", "<"), ("approved", "true")]:
        model = deepcopy(raw)
        model["constraints"][0][field] = value
        variants.append(model)
    model = deepcopy(raw)
    model["constraints"][0]["terms"][0]["coefficient"] = {"variable": "qty_B"}
    variants.append(model)
    model = deepcopy(raw)
    del model["variables"][0]["ub"]
    variants.append(model)
    model = deepcopy(raw)
    model["objectives"][0]["priority"] = True
    variants.append(model)
    for variant in variants:
        with pytest.raises(ValidationError):
            compile_model(variant)


def test_duplicate_json_keys_and_nonstandard_constants():
    for text in ['{"id": "a", "id": "b"}', '{"value": NaN}', '{"value": Infinity}']:
        with pytest.raises(ValueError):
            load_model_json(text)


def test_model_instances_are_revalidated(raw):
    model = ModelDSL.model_validate(raw)
    model.variables.append(model.variables[0])
    with pytest.raises(ValidationError):
        compile_model(model)


def test_cli_schema_ir_plan_and_errors(raw, tmp_path, capsys):
    ir_file = tmp_path / "model-ir.json"
    assert main(["validate", str(MODEL), "--output", str(ir_file)]) == 0
    assert (
        json.loads(ir_file.read_text(encoding="utf-8"))["model_hash"]
        == compile_model(raw).model_hash
    )
    assert main(["verify", str(MODEL), "--plan", str(ROOT / "examples/golden_plan.json")]) == 0
    assert json.loads(capsys.readouterr().out)["objectives"][0]["value"] == "4100"
    invalid_plan = tmp_path / "plan.json"
    invalid_plan.write_text('{"qty_A": 40, "qty_B": 16}', encoding="utf-8")
    assert main(["verify", str(MODEL), "--plan", str(invalid_plan)]) == 1
    assert not json.loads(capsys.readouterr().out)["feasible"]
    invalid_plan.write_text('{"qty_A": 40, "qty_A": 1}', encoding="utf-8")
    assert main(["verify", str(MODEL), "--plan", str(invalid_plan)]) == 2
    assert "dupliquée" in capsys.readouterr().err
    assert main(["validate", str(tmp_path / "missing.json")]) == 2
    assert "error" in capsys.readouterr().err
    schema_file = tmp_path / "schema.json"
    assert main(["schema", "--output", str(schema_file)]) == 0
    schema = json.loads(schema_file.read_text(encoding="utf-8"))
    assert schema == ModelDSL.model_json_schema()
    assert schema == json.loads((ROOT / "docs/model-dsl.schema.json").read_text(encoding="utf-8"))
    assert schema["additionalProperties"] is False
    for definition in schema["$defs"].values():
        assert definition["additionalProperties"] is False


def test_kernel_offline_without_solver_or_llm(raw, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("No network or solver allowed")

    monkeypatch.setattr(socket, "socket", forbidden)
    # This also demonstrates that the legacy optimizer is never called.
    monkeypatch.setattr("brain.optimizer.solve", forbidden)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    ir = compile_model(raw)
    assert verify_plan(ir, {"qty_A": 40, "qty_B": 15}).feasible
    assert json.loads(json.dumps(to_data(ir)))["variables"][0]["lb"] == "0"


def test_generic_indexed_example():
    ir = compile_model(
        load_model_json((ROOT / "examples/generic_allocation.json").read_text(encoding="utf-8"))
    )
    assert ir.variables[0].indices == (("item", "A"),)
    assert ir.variables[1].indices == (("item", "B"),)
    report = verify_plan(ir, {"qty_A": 40, "qty_B": 15})
    assert report.feasible
    assert report.objectives[0].value == 4100


@pytest.mark.parametrize(
    "dimensions,indices,code",
    [
        ({}, {"item": "A"}, "UNKNOWN_DIMENSION"),
        ({"item": ["B"]}, {"item": "A"}, "UNKNOWN_INDEX"),
    ],
)
def test_unknown_index_rejected(raw, dimensions, indices, code):
    raw["dimensions"] = dimensions
    raw["variables"][0]["indices"] = indices
    with pytest.raises(ModelCompilationError, match=code):
        compile_model(raw)


def test_duplicate_index_labels_and_blank_provenance_rejected(raw):
    raw["dimensions"] = {"item": ["A", "A"]}
    with pytest.raises(ValidationError):
        compile_model(raw)
    del raw["dimensions"]
    raw["parameters"]["machine_capacity_hours"]["source"] = "   "
    with pytest.raises(ValidationError):
        compile_model(raw)


def test_import_has_no_solver_dependency():
    # A fresh process prevents prior legacy tests from hiding an accidental import.
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import brain.kernel, sys; assert 'scipy' not in sys.modules; assert 'brain.optimizer' not in sys.modules; assert 'openai' not in sys.modules",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr
