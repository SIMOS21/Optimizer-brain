"""Phase 3: one global composition, explicit sharing, measured views and immutable history."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import FrozenInstanceError, replace
from decimal import Decimal
from fractions import Fraction
from itertools import product
import json
from pathlib import Path
import socket
import sqlite3

import pytest
from pydantic import ValidationError

from brain.models import Product, Scenario
from brain.optimizer import solve as legacy_solve
from brain.organization import CompositionError, compose_organization_model, load_organization_json
from brain.organization.__main__ import main
from brain.organization.composition import canonical_json, checksum
from brain.organization.project import load_organization_file
from brain.organization.reporting import build_report, graph_mermaid
from brain.organization.runtime import solve_organization
from brain.organization.schema import OrganizationModel
from brain.organization.storage import SnapshotConflictError, SnapshotIntegrityError, SnapshotStore
from brain.solvers.highs import HighsAdapter
from brain.solvers.orchestrator import SolverOrchestrator

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples" / "organizations"
ORIGIN = {"source": "synthetic_test", "approved": True, "version": "1"}


@pytest.fixture
def factory():
    return load_organization_file(EXAMPLES / "factory/project.json").model_dump(mode="json")


@pytest.fixture
def university():
    return load_organization_file(EXAMPLES / "university/project.json").model_dump(mode="json")


def fragment(source, department):
    return next(f for f in source["fragments"] if f["department_id"] == department)


def constraint(identifier, department, variable, operator, rhs):
    return {
        **ORIGIN,
        "id": identifier,
        "owner_department": department,
        "kind": "HARD",
        "terms": [{"variable": variable, "coefficient": "1", "coefficient_unit": "1"}],
        "operator": operator,
        "rhs": str(rhs),
        "unit": "unit",
    }


def test_factory_compares_to_direct_dsl_and_expected_resource_golden(factory):
    run = solve_organization(factory)
    direct = SolverOrchestrator().run(
        (ROOT / "examples/demo_cross_department.json").read_text(encoding="utf-8")
    )
    assert run.solve.status == direct.status == "OPTIMAL"
    assert run.solve.model_hash == direct.model_hash
    assert run.solve.objective_value == direct.objective_value == 4100
    assert dict(run.solve.decision_values) == {"qty_A": 40, "qty_B": 15}
    assert run.solve.validation_report.valid and run.report.has_verified_plan
    assert {
        r.id: (r.capacity, r.consumption, r.remaining, r.state) for r in run.report.resources
    } == {
        "production_resource": (100, 95, 5, "SATISFIED"),
        "finance_resource": (8000, 7000, 1000, "SATISFIED"),
        "logistics_resource": (55, 55, 0, "SATURATED"),
    }
    production = next(
        t for t in run.composition.constraint_traces if t.constraint_id == "production_machine"
    )
    assert production.fragment_ids == ("production_fragment",)
    assert production.parameter_ids == ("machine_capacity_hours",)
    assert production.resource_id == "production_resource"
    assert run.composition.resource_traces[0].parameter_id == "operating_cash_budget_eur"


def test_factory_compatible_legacy_scenario_only(factory):
    # Deliberately equivalent reduced legacy instance. factory.json is NOT equivalent.
    products = tuple(
        Product(
            id=key,
            demand=demand,
            min_deliver=0,
            inventory=0,
            unit_revenue=cost + contribution,
            make_cost=cost,
            outsource_cost=0,
            ship_cost=0,
            setup_cost=0,
            machine_hours=hours,
            labor_hours=0,
            logistics_units=1,
            outsource_limit=0,
        )
        for key, demand, cost, contribution, hours in [("A", 40, 100, 80, 2), ("B", 35, 200, 60, 1)]
    )
    scenario = Scenario(
        name="Explicitly equivalent synthetic reduction",
        products=products,
        machine_capacity=100,
        labor_capacity=0,
        logistics_capacity=55,
        budget=8000,
        overtime_max=0,
        overtime_hour_cost=0,
    )
    old = legacy_solve(scenario)
    new = solve_organization(factory)
    assert old.status == "optimal" and old.metrics["feasible"]
    assert old.metrics["profit"] == new.solve.objective_value == 4100
    assert {"qty_" + a.product_id: a.make for a in old.plan.allocations} == dict(
        new.solve.decision_values
    )


def test_university_exhaustive_binary_oracle_and_aggregated_shared_resources(university):
    run = solve_organization(university)
    possible = [
        (10 * maths + 8 * languages + 7 * science, (maths, languages, science))
        for maths, languages, science in product(range(2), repeat=3)
        if 1 <= maths + languages + science <= 2 and 6 * maths + 4 * languages + 3 * science <= 9
    ]
    best = max(value for value, _ in possible)
    assert best == 17 == run.solve.objective_value
    assert dict(run.solve.decision_values) == {
        "course_mathematics": 1,
        "course_languages": 0,
        "course_science": 1,
    }
    assert run.solve.status == "OPTIMAL" and run.solve.validation_report.valid
    rows = {r.id: r for r in run.composition.ir.constraints}
    assert len(rows["rooms_capacity"].terms) == len(rows["budget_capacity"].terms) == 3
    assert len([r for r in rows if r == "rooms_capacity"]) == 1
    assert {r.id: r.consumption for r in run.report.resources} == {"budget": 9, "rooms": 2}
    assert all(r.state == "SATURATED" for r in run.report.resources)
    trace = next(t for t in run.composition.resource_traces if t.resource_id == "rooms")
    assert len(trace.fragment_ids) == 3


def test_exactly_one_global_solve_and_one_variable_identity(factory):
    class CountingAdapter(HighsAdapter):
        def __init__(self):
            self.calls = []

        def solve(self, ir, settings):
            self.calls.append(ir)
            return super().solve(ir, settings)

    adapter = CountingAdapter()
    run = solve_organization(factory, adapter=adapter)
    assert len(adapter.calls) == 1
    assert len(run.composition.ir.variables) == 2
    assert [v.id for v in run.composition.ir.variables] == ["qty_A", "qty_B"]
    assert all("qty_A" in {v.id for v in d.decisions} for d in run.report.departments)


def test_order_independence_of_nodes_fragments_references_and_terms(factory, university):
    for original in (factory, university):
        expected = compose_organization_model(original)
        changed = deepcopy(original)
        for key in ("departments", "resources", "edges"):
            changed["graph"][key].reverse()
        changed["fragments"].reverse()
        for f in changed["fragments"]:
            for key in (
                "variables",
                "variable_refs",
                "parameter_refs",
                "constraints",
                "resource_uses",
            ):
                f[key].reverse()
            for expression in f["constraints"] + f["resource_uses"]:
                expression["terms"].reverse()
        changed["objective"]["terms"].reverse()
        for resource in changed["graph"]["resources"]:
            resource["shared_with"].reverse()
        result = compose_organization_model(changed)
        assert result == expected
        assert result.dsl_json == expected.dsl_json and result.source_json == expected.source_json
        assert result.ir.model_hash == expected.ir.model_hash


def test_descriptive_vs_mathematical_hashes_and_snapshot_detachment(factory):
    original = compose_organization_model(factory)
    for change in ("name", "owner", "edge", "fragment_source"):
        changed = deepcopy(factory)
        if change == "name":
            changed["graph"]["organization"]["name"] = "Another display label"
        elif change == "owner":
            changed["graph"]["departments"][0]["owner_id"] = "other_descriptive_owner"
        elif change == "edge":
            changed["graph"]["edges"].append(
                {
                    "id": "informative",
                    "source_id": "sales",
                    "target_id": "finance",
                    "type": "DEPENDS_ON",
                }
            )
        else:
            changed["fragments"][0]["source"] = "other_approved_demo_source"
        composed = compose_organization_model(changed)
        assert composed.ir.model_hash == original.ir.model_hash
        assert composed.manifest_hash != original.manifest_hash
    factory["shared_parameters"]["delivery_capacity_units"]["value"] = "45"
    assert compose_organization_model(factory).ir.model_hash != original.ir.model_hash
    assert original.source.shared_parameters["delivery_capacity_units"].value == 55
    detached = original.model
    detached.variables.clear()
    assert len(original.model.variables) == 2
    with pytest.raises(FrozenInstanceError):
        original.manifest_hash = "changed"


@pytest.mark.parametrize(
    "change,code",
    [
        ("missing_department", "UNKNOWN_DEPARTMENT"),
        ("wrong_owner", "OWNERSHIP"),
        ("duplicate_variable", "VARIABLE_COLLISION"),
        ("duplicate_parameter", "PARAMETER_COLLISION"),
        ("unknown_resource", "UNKNOWN_RESOURCE"),
        ("bad_capacity", "UNKNOWN_SHARED_PARAMETER"),
        ("bad_capacity_unit", "UNIT_MISMATCH"),
        ("bad_term_unit", "UNIT_MISMATCH"),
        ("bad_import_unit", "UNIT_MISMATCH"),
        ("unknown_variable", "UNKNOWN_VARIABLE"),
        ("missing_import", "UNDECLARED_REFERENCE"),
        ("wrong_import_owner", "OWNERSHIP"),
        ("wrong_import_version", "VERSION_CONFLICT"),
        ("organization", "UNKNOWN_ORGANIZATION"),
        ("organization_version", "VERSION_CONFLICT"),
        ("department_version", "VERSION_CONFLICT"),
        ("capacity_version", "VERSION_CONFLICT"),
        ("unapproved_parameter", "UNAPPROVED"),
        ("unapproved_fragment", "UNAPPROVED"),
        ("unapproved_use", "UNAPPROVED"),
        ("unapproved_graph", "UNAPPROVED"),
        ("unapproved_department", "UNAPPROVED"),
        ("unapproved_resource", "UNAPPROVED"),
        ("unapproved_objective", "UNAPPROVED"),
        ("bad_edge", "INVALID_EDGE"),
        ("bad_edge_endpoint", "INVALID_EDGE"),
        ("duplicate_graph_identity", "DUPLICATE_ID"),
        ("duplicate_fragment", "DUPLICATE_ID"),
        ("negative_capacity", "INVALID_CAPACITY"),
        ("duplicate_rule", "DUPLICATE_ID"),
        ("resource_scope", "RESOURCE_SCOPE"),
        ("edge_scope", "RESOURCE_SCOPE"),
    ],
)
def test_localized_rejections(factory, change, code):
    sales, production, finance = (
        fragment(factory, key) for key in ("sales", "production", "finance")
    )
    resource = next(r for r in factory["graph"]["resources"] if r["id"] == "production_resource")
    if change == "missing_department":
        production["department_id"] = "missing"
    elif change == "wrong_owner":
        sales["variables"][0]["department"] = "finance"
    elif change == "duplicate_variable":
        finance["variables"].append(
            {**deepcopy(sales["variables"][0]), "department": "finance", "ub": "2"}
        )
    elif change == "duplicate_parameter":
        finance["parameters"]["machine_capacity_hours"] = {**ORIGIN, "value": "9", "unit": "hour"}
    elif change == "unknown_resource":
        production["resource_uses"][0]["resource_id"] = "missing"
    elif change == "bad_capacity":
        resource["capacity"]["parameter"] = "missing"
    elif change == "bad_capacity_unit":
        resource["unit"] = "EUR"
    elif change == "bad_term_unit":
        production["resource_uses"][0]["terms"][0]["coefficient_unit"] = "EUR/unit"
    elif change == "bad_import_unit":
        production["variable_refs"][0]["unit"] = "hour"
    elif change == "unknown_variable":
        production["variable_refs"][0]["variable"] = "missing"
    elif change == "missing_import":
        production["variable_refs"] = []
    elif change == "wrong_import_owner":
        production["variable_refs"][0]["owner_department"] = "finance"
    elif change == "wrong_import_version":
        production["variable_refs"][0]["declaration_version"] = "2"
    elif change == "organization":
        production["organization_id"] = "another_org"
    elif change == "organization_version":
        production["organization_version"] = "2"
    elif change == "department_version":
        production["department_version"] = "2"
    elif change == "capacity_version":
        resource["capacity_version"] = "2"
    elif change == "unapproved_parameter":
        factory["shared_parameters"]["machine_capacity_hours"]["approved"] = False
    elif change == "unapproved_fragment":
        production["approved"] = False
    elif change == "unapproved_use":
        production["resource_uses"][0]["approved"] = False
    elif change == "unapproved_graph":
        factory["graph"]["organization"]["approved"] = False
    elif change == "unapproved_department":
        factory["graph"]["departments"][0]["approved"] = False
    elif change == "unapproved_resource":
        resource["approved"] = False
    elif change == "unapproved_objective":
        factory["objective"]["approved"] = False
    elif change == "bad_edge":
        factory["graph"]["edges"][0]["source_id"] = resource["id"]
    elif change == "bad_edge_endpoint":
        factory["graph"]["edges"][0]["target_id"] = "missing"
    elif change == "duplicate_graph_identity":
        resource["id"] = "sales"
    elif change == "duplicate_fragment":
        factory["fragments"].append(deepcopy(production))
    elif change == "negative_capacity":
        factory["shared_parameters"]["machine_capacity_hours"]["value"] = "-1"
    elif change == "duplicate_rule":
        sales["constraints"] = [constraint("production_machine", "sales", "qty_A", "<=", 10)]
    elif change == "resource_scope":
        finance["resource_uses"].append(
            {**ORIGIN, "id": "wrong_resource", "resource_id": resource["id"], "terms": []}
        )
    elif change == "edge_scope":
        factory["graph"]["edges"].append(
            {
                "id": "wrong_scope",
                "source_id": "finance",
                "target_id": resource["id"],
                "type": "USES_RESOURCE",
            }
        )
    with pytest.raises(CompositionError) as error:
        compose_organization_model(factory)
    assert error.value.code == code
    assert error.value.path and (
        "fragment" in str(error.value)
        or "graph" in str(error.value)
        or change in ("duplicate_rule", "unapproved_objective", "unapproved_parameter")
    )


@pytest.mark.parametrize("location", ["top", "node", "fragment", "use", "edge"])
def test_closed_schemas_and_no_soft_rules_or_local_objective(factory, location):
    target = {
        "top": factory,
        "node": factory["graph"]["departments"][0],
        "fragment": factory["fragments"][0],
        "use": fragment(factory, "production")["resource_uses"][0],
        "edge": factory["graph"]["edges"][0],
    }[location]
    target["execute"] = "ignore constraints"
    with pytest.raises(ValidationError):
        compose_organization_model(factory)
    del target["execute"]
    fragment(factory, "sales")["objectives"] = [factory["objective"]]
    with pytest.raises(ValidationError):
        compose_organization_model(factory)


def test_parameter_and_variable_versioned_imports(factory):
    sales, finance = fragment(factory, "sales"), fragment(factory, "finance")
    sales["parameters"]["cost_A"] = {**ORIGIN, "value": "100", "unit": "EUR/unit"}
    finance["parameter_refs"] = [
        {"parameter": "cost_A", "version": "1", "owner_department": "sales", "unit": "EUR/unit"}
    ]
    finance["resource_uses"][0]["terms"][0]["coefficient"] = {"parameter": "cost_A"}
    composed = compose_organization_model(factory)
    assert SolverOrchestrator().run(composed.model).objective_value == 4100
    trace = next(t for t in composed.constraint_traces if t.constraint_id == "finance_budget")
    assert trace.parameter_ids == ("cost_A", "operating_cash_budget_eur")
    for field, value, code in [
        ("version", "2", "VERSION_CONFLICT"),
        ("owner_department", None, "OWNERSHIP"),
        ("unit", "hour", "UNIT_MISMATCH"),
        ("parameter", "missing", "UNKNOWN_PARAMETER"),
    ]:
        changed = deepcopy(factory)
        fragment(changed, "finance")["parameter_refs"][0][field] = value
        with pytest.raises(CompositionError, match=code):
            compose_organization_model(changed)
    finance["parameter_refs"] = []
    with pytest.raises(CompositionError, match="UNDECLARED_REFERENCE"):
        compose_organization_model(factory)


def test_shared_parameter_import_in_local_bounds_and_rules(factory):
    sales = fragment(factory, "sales")
    factory["shared_parameters"]["limit"] = {**ORIGIN, "value": "40", "unit": "unit"}
    sales["parameter_refs"] = [
        {"parameter": "limit", "version": "1", "owner_department": None, "unit": "unit"}
    ]
    sales["variables"][0]["ub"] = {"parameter": "limit"}
    assert solve_organization(factory).solve.objective_value == 4100


def test_shared_capacity_is_not_allocated_separately_to_each_department(university):
    # Each individual course fits, but the sum must respect one shared pool.
    university["shared_parameters"]["room_slots"]["value"] = "1"
    result = solve_organization(university)
    assert result.solve.status == "OPTIMAL" and result.solve.objective_value == 10
    assert sum(dict(result.solve.decision_values).values()) == 1
    rooms = next(r for r in result.report.resources if r.id == "rooms")
    assert rooms.consumption == rooms.capacity == 1


def test_hard_cross_department_conflict_keeps_provenance_and_no_fake_plan(factory):
    fragment(factory, "sales")["constraints"] = [
        constraint("sales_required", "sales", "qty_A", ">=", 30)
    ]
    fragment(factory, "finance")["constraints"] = [
        constraint("finance_limit", "finance", "qty_A", "<=", 20)
    ]
    run = solve_organization(factory)
    assert run.solve.status == "INFEASIBLE" and not run.report.has_verified_plan
    assert run.solve.decision_values is None
    assert all(r.consumption is r.remaining is None for r in run.report.resources)
    assert all(c.state == "UNAVAILABLE" for c in run.report.constraints)
    traces = {t.constraint_id: t for t in run.composition.constraint_traces}
    assert traces["sales_required"].fragment_ids == ("sales_fragment",)
    assert traces["finance_limit"].fragment_ids == ("finance_fragment",)
    assert len(run.composition.ir.constraints) == 5


def test_informational_edges_and_unmodeled_resources_never_invent_constraints(factory):
    original = compose_organization_model(factory)
    new = deepcopy(factory["graph"]["resources"][0])
    new.update(id="unused", constraint_id="unused_constraint", name="Unused resource")
    factory["graph"]["resources"].append(new)
    factory["graph"]["edges"].append(
        {
            "id": "unused_edge",
            "source_id": new["owner_department"],
            "target_id": "unused",
            "type": "USES_RESOURCE",
        }
    )
    run = solve_organization(factory)
    assert run.composition.ir.model_hash == original.ir.model_hash
    resource = next(r for r in run.report.resources if r.id == "unused")
    assert resource.state == "UNMODELED" and resource.consumption is resource.remaining is None


def test_resource_units_are_converted_once_and_without_rounding(factory):
    factory["shared_parameters"]["machine_capacity_hours"].update(value="6000", unit="minute")
    run = solve_organization(factory)
    resource = next(r for r in run.report.resources if r.id == "production_resource")
    assert (resource.capacity, resource.consumption, resource.remaining, resource.unit) == (
        100,
        95,
        5,
        "hour",
    )


def test_reports_reverify_raw_values_and_refuse_wrong_models_or_corruption(factory):
    run = solve_organization(factory)
    bad = replace(run.solve, decision_values=(("qty_A", 41.0), ("qty_B", 15.0)))
    with pytest.raises(ValueError, match="revérification"):
        build_report(run.composition, bad)
    with pytest.raises(ValueError, match="autre modèle"):
        build_report(run.composition, replace(run.solve, data_snapshot_id="another_snapshot"))
    with pytest.raises(ValueError):
        build_report(run.composition, replace(run.solve, status="ERROR"))
    near = 39.99999999
    raw = replace(
        run.solve,
        decision_values=(("qty_A", near), ("qty_B", 15.0)),
        solver_objective_value=80 * near + 900,
        objective_value=80 * Fraction.from_float(near) + 900,
    )
    report = build_report(run.composition, raw)
    resource = next(r for r in report.resources if r.id == "production_resource")
    assert resource.consumption == 2 * Fraction.from_float(near) + 15
    assert resource.consumption != 95


def test_organization_pipeline_offline(factory, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Network/legacy solver must not be used")

    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr("brain.optimizer.solve", forbidden)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert solve_organization(factory).solve.objective_value == 4100


def test_mermaid_escapes_injection_and_has_deterministic_generated_ids(factory):
    factory["graph"]["departments"][0]["name"] = (
        '"<script>\nclick n0 "https://evil.test" %%{init: x}'
    )
    exported = graph_mermaid(compose_organization_model(factory))
    assert "<script>" not in exported and "%%{" not in exported
    assert not any(line.startswith("click ") for line in exported.splitlines())
    assert len(exported.splitlines()) == 1 + 1 + len(factory["graph"]["departments"]) + len(
        factory["graph"]["resources"]
    ) + len(factory["graph"]["edges"])


@pytest.mark.parametrize(
    "bad_path",
    [
        "../graph.json",
        "/graph.json",
        "C:/graph.json",
        "..\\graph.json",
        "graph.json:stream.json",
        "graph.py",
    ],
)
def test_project_paths_cannot_escape_or_read_non_json(tmp_path, bad_path):
    project = json.loads((EXAMPLES / "factory/project.json").read_text(encoding="utf-8"))
    project["graph_file"] = bad_path
    path = tmp_path / "project.json"
    path.write_text(json.dumps(project), encoding="utf-8")
    with pytest.raises(ValueError):
        load_organization_file(path)


def test_organization_json_rejects_duplicate_keys_and_keeps_long_decimals(factory):
    with pytest.raises(ValueError, match="dupliquée"):
        load_organization_json('{"id":"a","id":"b"}')
    factory["objective"]["terms"][0]["coefficient"] = "0.123456789012345678901234567890"
    text = json.dumps(factory).replace(
        '"0.123456789012345678901234567890"', "0.123456789012345678901234567890"
    )
    compiled = compose_organization_model(text)
    assert compiled.ir.objectives[0].terms[0].coefficient == Fraction(
        Decimal("0.123456789012345678901234567890")
    )


def test_storage_roundtrip_detaches_input_and_is_idempotent(factory, tmp_path):
    run = solve_organization(factory)
    store = SnapshotStore(tmp_path)
    assert store.publish(run.composition, run) == run.composition.manifest_hash
    assert store.publish(run.composition, run) == run.composition.manifest_hash
    stored = store.load_snapshot("synthetic_factory", "demo_cross_department", "1.0.0")
    assert stored == run.composition
    saved_run = store.load_run(run.solve.run_id)
    assert saved_run["solve"]["objective_value"] == "4100"
    assert saved_run["report"]["has_verified_plan"]
    assert len(store.history("synthetic_factory", "demo_cross_department")) == 1
    assert SolverOrchestrator().run(stored.model, run.solve.settings).objective_value == 4100


@pytest.mark.parametrize("changed", ["model", "fragment", "graph", "parameter", "objective"])
def test_published_versions_refuse_overwrite(factory, tmp_path, changed):
    original = compose_organization_model(factory)
    store = SnapshotStore(tmp_path)
    store.publish(original)
    factory["model_version"] = "2" if changed != "model" else "1.0.0"
    if changed == "model":
        factory["model_name"] = "Changed description"
    elif changed == "fragment":
        factory["fragments"][0]["source"] = "changed"
    elif changed == "graph":
        factory["graph"]["organization"]["name"] = "Changed graph"
    elif changed == "parameter":
        factory["shared_parameters"]["delivery_capacity_units"]["value"] = "45"
    else:
        factory["objective"]["terms"][0]["coefficient"] = "79"
    with pytest.raises(SnapshotConflictError):
        store.publish(compose_organization_model(factory))
    assert store.load_snapshot("synthetic_factory", "demo_cross_department", "1.0.0") == original
    assert len(store.history("synthetic_factory", "demo_cross_department")) == 1


def test_append_new_model_version_and_safe_ids(factory, tmp_path):
    store = SnapshotStore(tmp_path)
    first = compose_organization_model(factory)
    store.publish(first)
    factory["model_version"] = "2"
    factory["model_name"] = "New model label"
    second = compose_organization_model(factory)
    store.publish(second)
    assert len(store.history("synthetic_factory", "demo_cross_department")) == 2
    assert store.load_snapshot("synthetic_factory", "demo_cross_department", "2") == second
    assert store.load_snapshot("synthetic_factory", "demo_cross_department", "1.0.0") == first
    with pytest.raises(KeyError):
        store.load_snapshot("../../arbitrary' OR '1'='1", "demo_cross_department", "2")
    assert store.path.parent == tmp_path.resolve()


def test_storage_transaction_rolls_back_every_component(factory, tmp_path, monkeypatch):
    store = SnapshotStore(tmp_path)
    original_put = store._put
    calls = []

    def interrupted(*args):
        calls.append(1)
        if len(calls) == 3:
            raise OSError("Simulated write interruption")
        return original_put(*args)

    monkeypatch.setattr(store, "_put", interrupted)
    with pytest.raises(OSError):
        store.publish(compose_organization_model(factory))
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM records").fetchone()[0] == 0


def test_concurrent_identical_publications_are_atomic(factory, tmp_path):
    store = SnapshotStore(tmp_path)
    composed = compose_organization_model(factory)
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda _: store.publish(composed), range(3)))
    assert results == [composed.manifest_hash] * 3
    assert store.load_snapshot("synthetic_factory", "demo_cross_department", "1.0.0") == composed


def test_checksum_and_derived_artifact_corruption_are_detected(factory, tmp_path):
    store = SnapshotStore(tmp_path)
    composed = compose_organization_model(factory)
    store.publish(composed)
    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE records SET payload=? WHERE kind='composition'", ("{}",))
    with pytest.raises(SnapshotIntegrityError):
        store.load_snapshot("synthetic_factory", "demo_cross_department", "1.0.0")
    payload = composed.to_dict()
    payload["dsl"]["variables"][0]["ub"] = "999"
    encoded = canonical_json(payload)
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            "UPDATE records SET payload=?,content_hash=? WHERE kind='composition'",
            (encoded, checksum(encoded)),
        )
    with pytest.raises(SnapshotIntegrityError, match="dérivés"):
        store.load_snapshot("synthetic_factory", "demo_cross_department", "1.0.0")


def test_mismatched_or_forged_run_report_cannot_be_published(factory, tmp_path):
    run = solve_organization(factory)
    store = SnapshotStore(tmp_path)
    forged = replace(run, report=replace(run.report, has_verified_plan=False))
    with pytest.raises(SnapshotIntegrityError):
        store.publish(run.composition, forged)
    assert store.history("synthetic_factory", "demo_cross_department") == ()


def test_store_detects_corrupted_run_and_symlink_redirection(factory, tmp_path, monkeypatch):
    run = solve_organization(factory)
    store = SnapshotStore(tmp_path)
    store.publish(run.composition, run)
    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE runs SET payload=?", ("{}",))
    with pytest.raises(SnapshotIntegrityError):
        store.load_run(run.solve.run_id)
    monkeypatch.setattr(Path, "is_symlink", lambda path: True)
    with pytest.raises(ValueError, match="stockage"):
        SnapshotStore(tmp_path)


def test_cli_compose_solve_publish_replay_and_errors(tmp_path, capsys):
    store = tmp_path / "store"
    composed_file = tmp_path / "composed.json"
    graph = tmp_path / "graph.mmd"
    assert (
        main(
            [
                "compose",
                str(EXAMPLES / "factory/project.json"),
                "--store",
                str(store),
                "--output",
                str(composed_file),
                "--mermaid",
                str(graph),
            ]
        )
        == 0
    )
    replay = tmp_path / "replay.json"
    assert (
        main(
            [
                "replay",
                "--store",
                str(store),
                "--organization",
                "synthetic_factory",
                "--model",
                "demo_cross_department",
                "--version",
                "1.0.0",
                "--output",
                str(replay),
            ]
        )
        == 0
    )
    assert json.loads(replay.read_text(encoding="utf-8")) == json.loads(
        composed_file.read_text(encoding="utf-8")
    )
    assert graph.read_text(encoding="utf-8").startswith("flowchart LR")
    solved = tmp_path / "solved.json"
    assert (
        main(
            [
                "solve",
                str(EXAMPLES / "factory/project.json"),
                "--store",
                str(store),
                "--output",
                str(solved),
            ]
        )
        == 0
    )
    assert json.loads(solved.read_text(encoding="utf-8"))["solve"]["objective_value"] == "4100"
    assert main(["compose", str(tmp_path / "missing.json")]) == 2
    assert "error" in capsys.readouterr().err


def test_schemas_revalidated_after_mutation(factory):
    typed = OrganizationModel.model_validate(factory)
    typed.fragments.append(typed.fragments[0])
    with pytest.raises(CompositionError, match="DUPLICATE_ID"):
        compose_organization_model(typed)


def test_numeric_change_with_new_versions_preserves_original_snapshot(factory, tmp_path):
    store = SnapshotStore(tmp_path)
    original = solve_organization(factory)
    store.publish(original.composition, original)
    factory["model_version"] = "2.0.0"
    factory["graph"]["organization"].update(version="2", data_snapshot_id="synthetic_demo_v2")
    factory["shared_parameters"]["delivery_capacity_units"].update(value="45", version="2")
    for resource in factory["graph"]["resources"]:
        if resource["id"] == "logistics_resource":
            resource.update(capacity_version="2", version="2")
    for module in factory["fragments"]:
        module.update(version="2", organization_version="2")
        for reference in module["variable_refs"]:
            reference["declaration_version"] = "2"
    changed = solve_organization(factory)
    assert changed.solve.objective_value == 3500
    assert changed.composition.ir.model_hash != original.composition.ir.model_hash
    store.publish(changed.composition, changed)
    assert len(store.history("synthetic_factory", "demo_cross_department")) == 2
    saved = store.load_snapshot("synthetic_factory", "demo_cross_department", "1.0.0")
    assert saved == original.composition
    assert SolverOrchestrator().run(saved.model).objective_value == 4100
    assert store.load_run(original.solve.run_id)["solve"]["data_snapshot_id"] == "synthetic_demo_v1"


def test_corrupted_backend_result_never_produces_resource_utilization(factory):
    class CorruptedAdapter(HighsAdapter):
        def solve(self, ir, settings):
            return replace(
                super().solve(ir, settings), decisions=(("qty_A", 41.0), ("qty_B", 15.0))
            )

    run = solve_organization(factory, adapter=CorruptedAdapter())
    assert run.solve.status == "SOLUTION_FAILED_VALIDATION"
    assert not run.report.has_verified_plan
    assert all(
        resource.consumption is resource.remaining is None for resource in run.report.resources
    )
