"""Comparison permissions, immutable provenance and real PostgreSQL RLS."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json

import pytest
from sqlalchemy import event

from brain.organization.runtime import solve_organization
from brain.platform import service
from brain.platform.database import set_tenant
from brain.platform.models import OptimizationRun, User
from tests.conftest_platform import platform_fixture, postgres_urls_fixture  # noqa: F401
from tests.test_controlled_scenarios import create_changed, make_policy, publish_changed
from tests.test_scenarios import body as clone_body


def stored(p, model):
    source = p.request("GET", p.base + f"/model-versions/{model}").json()["document"][
        "organization_model"
    ]
    run = solve_organization(source)
    with p.app.state.session_factory.begin() as session:
        service.record_run(
            session, session.get(User, p.users["builder"]), p.organization_id, model, run.solve
        )
    return run.solve.run_id


def compare(p, baseline=None, candidate=None, *, role="viewer", org=None):
    params = {}
    if baseline is not None:
        params["baseline_run_id"] = baseline
    if candidate is not None:
        params["candidate_run_id"] = candidate
    return p.request(
        "GET",
        f"/api/v1/organizations/{org or p.organization_id}/scenario-comparisons",
        params=params,
        role=role,
    )


def test_read_permissions_determinism_and_no_history_mutations(platform, monkeypatch, caplog):
    p = platform
    model = p.model()
    run = stored(p, model)
    before = p.request("GET", p.base + f"/optimization-runs/{run}").json()

    def forbidden(*args, **kwargs):
        raise AssertionError("Comparison cannot solve")

    monkeypatch.setattr("scipy.optimize.milp", forbidden)
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.strip().split()[0].upper())

    event.listen(p.app.state.engine, "before_cursor_execute", capture)
    try:
        reports = []
        with caplog.at_level("INFO", logger="brain.platform.comparisons"):
            for role in ("admin", "builder", "approver", "viewer"):
                response = compare(p, run, run, role=role)
                assert response.status_code == 200, response.text
                assert response.headers["cache-control"] == "no-store"
                reports.append(response.json())
        assert all(r == reports[0] for r in reports)
        assert reports[0]["baseline"]["objective_value"] == "4100"
        assert reports[0]["observed_objective_delta"] == "0"
        assert not {"INSERT", "UPDATE", "DELETE"} & set(statements)
        assert "scenario.comparison" in caplog.text
    finally:
        event.remove(p.app.state.engine, "before_cursor_execute", capture)
    assert p.request("GET", p.base + f"/optimization-runs/{run}").json() == before


def test_real_controlled_scenario_is_qualified_and_keeps_approved_reference(platform):
    p = platform
    policy = make_policy(p)
    reference = policy["document"]["source_model_version_id"]
    baseline = stored(p, reference)
    changed, _, _ = create_changed(p, policy=policy)
    publish_changed(p, changed)
    candidate = stored(p, changed["model_version_id"])
    response = compare(p, baseline, candidate)
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["comparability"] == "QUALIFIED"
    assert report["baseline"]["objective_value"] == "4100"
    assert report["candidate"]["objective_value"] == "3500"
    assert report["observed_objective_delta"] == "-600"
    assert report["objective_improvement"] is report["objective_improvement_percent"] is None
    assert report["candidate"]["scenario_version_id"] == changed["id"]
    assert report["candidate"]["reference_model_version_id"] == reference
    assert report["candidate"]["assumptions"][0]["proposed_value"] == "45"
    # Policy-owner revocation blocks future execution, not immutable historical reads.
    assert (
        p.request(
            "PUT",
            p.base + "/memberships",
            json={"user_id": p.users["builder"], "role": "VIEWER", "active": False},
        ).status_code
        == 200
    )
    assert compare(p, baseline, candidate).json() == report


def test_identical_clone_can_compare_in_the_same_mathematical_frame(platform):
    p = platform
    model = p.model()
    baseline = stored(p, model)
    created = p.request(
        "POST", p.base + "/scenarios", role="builder", json=clone_body(p, model)
    ).json()
    derived = created["model_version_id"]
    assert (
        p.request(
            "POST", p.base + f"/model-versions/{derived}/publish", role="approver"
        ).status_code
        == 200
    )
    candidate = stored(p, derived)
    report = compare(p, baseline, candidate).json()
    assert report["comparability"] == "COMPARABLE"
    assert report["same_model_and_snapshot"] is True
    assert report["observed_objective_delta"] == "0"
    assert report["objective_improvement"] is None


def test_missing_inputs_and_scenario_without_a_run(platform):
    p = platform
    model = p.model()
    baseline = stored(p, model)
    assert compare(p).json()["comparability"] == "INCOMPLETE"
    report = compare(p, candidate=baseline).json()
    assert report["baseline"] is report["observed_objective_delta"] is None
    assert report["reasons"][0]["code"] == "BASELINE_RUN_REQUIRED"
    created = p.request(
        "POST", p.base + "/scenarios", role="builder", json=clone_body(p, model)
    ).json()
    response = compare(p, baseline, created["id"])
    assert response.status_code == 404
    assert "posséder un run" in response.json()["detail"]


def test_comparison_query_rejects_unknown_and_invalid_fields(platform):
    p = platform
    for params in (
        {"economic_gain": "100"},
        {"baseline_run_id": ""},
        {"candidate_run_id": "x" * 101},
    ):
        response = p.request("GET", p.base + "/scenario-comparisons", params=params)
        assert response.status_code == 422


def test_authentication_cross_tenant_rls_and_revoked_reader(platform):
    p = platform
    baseline = stored(p, p.model())
    other = p.request(
        "POST",
        "/api/v1/organizations",
        role="outsider",
        json={"key": "other_comparison", "name": "Other"},
    ).json()["id"]
    assert p.client.get(p.base + "/scenario-comparisons").status_code == 401
    assert compare(p, baseline, baseline, role="outsider").status_code == 404
    assert compare(p, baseline, baseline, role="outsider", org=other).status_code == 404
    # Even a user belonging to both organizations cannot mix their artifacts.
    assert (
        p.request(
            "PUT",
            p.base + "/memberships",
            json={"user_id": p.users["outsider"], "role": "VIEWER", "active": True},
        ).status_code
        == 200
    )
    assert compare(p, baseline, baseline, role="outsider", org=other).status_code == 404
    foreign_source = deepcopy(p.source)
    previous_key = foreign_source["graph"]["organization"]["id"]
    foreign_source["graph"]["organization"]["id"] = "other_comparison"
    for fragment in foreign_source["fragments"]:
        fragment["organization_id"] = "other_comparison"
    for edge in foreign_source["graph"]["edges"]:
        for key in ("source_id", "target_id"):
            if edge[key] == previous_key:
                edge[key] = "other_comparison"
    foreign_base = f"/api/v1/organizations/{other}"
    for department in foreign_source["graph"]["departments"]:
        assert (
            p.request(
                "POST",
                foreign_base + "/departments",
                role="outsider",
                json={"key": department["id"], "name": department["name"]},
            ).status_code
            == 201
        )
    graph = p.request(
        "POST",
        foreign_base + "/graphs",
        role="outsider",
        json={
            "graph": foreign_source["graph"],
            "shared_parameters": foreign_source["shared_parameters"],
        },
    )
    assert graph.status_code == 201, graph.text
    graph_id = graph.json()["id"]
    assert (
        p.request("POST", foreign_base + f"/graphs/{graph_id}/publish", role="outsider").status_code
        == 200
    )
    model = p.request(
        "POST",
        foreign_base + "/model-versions",
        role="outsider",
        json={"graph_snapshot_id": graph_id, "model": foreign_source},
    )
    assert model.status_code == 201, model.text
    model_id = model.json()["id"]
    assert (
        p.request(
            "POST", foreign_base + f"/model-versions/{model_id}/publish", role="outsider"
        ).status_code
        == 200
    )
    foreign_run = solve_organization(foreign_source).solve
    with p.app.state.session_factory.begin() as session:
        service.record_run(
            session, session.get(User, p.users["outsider"]), other, model_id, foreign_run
        )
    assert compare(p, baseline, foreign_run.run_id, role="outsider").status_code == 404
    assert compare(p, foreign_run.run_id, baseline, role="outsider", org=other).status_code == 404
    assert compare(p, baseline, "foreign-or-missing").status_code == 404
    with p.app.state.session_factory.begin() as session:
        set_tenant(session, other)
        # Real PostgreSQL enforces this independently of the application WHERE.
        if session.bind.dialect.name == "postgresql":
            assert session.get(OptimizationRun, baseline) is None
    assert (
        p.request(
            "PUT",
            p.base + "/memberships",
            json={"user_id": p.users["viewer"], "role": "VIEWER", "active": False},
        ).status_code
        == 200
    )
    assert compare(p, baseline, baseline).status_code == 404


def test_independently_published_model_is_not_a_comparable_scenario(platform):
    p = platform
    first = stored(p, p.model())
    p.source["model_version"] = "independent_version"
    second = stored(p, p.model())
    report = compare(p, first, second).json()
    assert report["comparability"] == "NOT_COMPARABLE"
    assert any(r["code"] == "REFERENCE_LINEAGE_MISMATCH" for r in report["reasons"])
    assert report["observed_objective_delta"] is None


@pytest.mark.parametrize(
    "target", ["run_checksum", "model_reconstruction", "graph_checksum", "scenario_provenance"]
)
def test_corrupted_historical_inputs_fail_closed(platform, monkeypatch, target):
    p = platform
    model = p.model()
    run = stored(p, model)
    if target == "run_checksum":
        from brain.platform import comparisons

        original = comparisons._input

        def bad(session, org, record):
            record.content_hash = "0" * 64
            return original(session, org, record)

        monkeypatch.setattr(comparisons, "_input", bad)
    elif target in ("model_reconstruction", "graph_checksum"):
        original = service.get_model if target == "model_reconstruction" else service.get_graph

        def bad(session, org, identity):
            from types import SimpleNamespace

            record = original(session, org, identity)
            data = {c.key: getattr(record, c.key) for c in record.__table__.columns}
            if target == "model_reconstruction":
                doc = json.loads(data["payload"])
                doc["model_hash"] = "0" * 64
                from brain.organization.composition import canonical_json, checksum

                data["payload"] = canonical_json(doc)
                data["content_hash"] = checksum(data["payload"])
            else:
                data["content_hash"] = "0" * 64
                # get_graph normally rejects this checksum before returning it.
                raise service.ServiceError(409, "Intégrité du graphe invalide")
            return SimpleNamespace(**data)

        monkeypatch.setattr(
            service, "get_model" if target == "model_reconstruction" else "get_graph", bad
        )
    else:
        from brain.platform import scenarios

        created = p.request(
            "POST", p.base + "/scenarios", role="builder", json=clone_body(p, model)
        ).json()
        derived = created["model_version_id"]
        p.request("POST", p.base + f"/model-versions/{derived}/publish", role="approver")
        run = stored(p, derived)

        def bad(*args):
            raise service.ServiceError(409, "Provenance du scénario incompatible")

        monkeypatch.setattr(scenarios, "scenario_view", bad)
    assert compare(p, run, run).status_code == 409


def test_comparison_reads_are_concurrent_and_deterministic(platform):
    p = platform
    run = stored(p, p.model())
    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(lambda _: compare(p, run, run), range(4)))
    assert all(r.status_code == 200 for r in responses)
    assert all(r.json() == responses[0].json() for r in responses)
    assert p.request("POST", p.base + "/scenario-comparisons", json={}).status_code == 405
