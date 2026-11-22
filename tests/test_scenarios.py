"""5B slice one: immutable identical versions, closed edits and existing job governance."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from brain.organization import compose_organization_model
from brain.organization.runtime import solve_organization
from brain.platform import service
from brain.platform.database import set_tenant
from brain.platform.models import ModelVersion, ScenarioVersion
from tests.conftest_platform import migrate, platform_fixture, postgres_urls_fixture  # noqa: F401


def body(p, source):
    model = p.request("GET", p.base + f"/model-versions/{source}").json()
    return {
        "key": "reference_clone",
        "version": "1",
        "name": "Synthetic clone",
        "reason": "Validate immutable lineage",
        "source_model_version_id": source,
        "expected_source_content_hash": model["content_hash"],
    }


def create(p, request=None):
    response = p.request(
        "POST", p.base + "/scenarios", role="builder", json=request or body(p, p.model())
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_identical_clone_preserves_reference_and_requires_publication(platform):
    p = platform
    reference = p.model()
    original = p.request("GET", p.base + f"/model-versions/{reference}").json()
    request = body(p, reference)
    scenario = create(p, request)
    assert scenario["model_state"] == "DRAFT"
    assert scenario["created_by"] == p.users["builder"]
    assert scenario["model_version_id"] != reference
    assert scenario["document"]["changes"] == []
    assert scenario["document"]["data_snapshot_id"] == original["data_snapshot_id"]
    assert scenario["document"]["graph_snapshot_id"] == original["graph_snapshot_id"]
    model_path = p.base + f"/model-versions/{scenario['model_version_id']}"
    derived = p.request("GET", model_path).json()
    assert derived["model_hash"] == original["model_hash"]
    assert derived["content_hash"] != original["content_hash"]
    old_source, new_source = (
        deepcopy(original["document"]["organization_model"]),
        deepcopy(derived["document"]["organization_model"]),
    )
    assert new_source.pop("scenario_id") != old_source.pop("scenario_id")
    assert new_source.pop("model_version") != old_source.pop("model_version")
    assert new_source == old_source
    headers = {**p.headers["builder"], "Idempotency-Key": "scenario-same-job-attempt"}
    assert (
        p.client.post(model_path + "/optimization-jobs", headers=headers, json={}).status_code
        == 409
    )
    assert p.request("POST", model_path + "/publish", role="builder").status_code == 403
    assert p.request("POST", model_path + "/publish", role="approver").status_code == 200
    jobs = [
        p.client.post(model_path + "/optimization-jobs", headers=headers, json={}) for _ in range(2)
    ]
    assert all(j.status_code == 202 for j in jobs)
    assert jobs[0].json()["id"] == jobs[1].json()["id"]
    cancel = p.request(
        "POST", p.base + f"/optimization-jobs/{jobs[0].json()['id']}/cancel", role="builder"
    )
    assert cancel.status_code == 200 and cancel.json()["cancel_requested"]
    assert p.request("GET", p.base + f"/model-versions/{reference}").json() == original
    # The canonical scenario document remains immutable across model publication.
    after = p.request("GET", p.base + f"/scenarios/{scenario['id']}").json()
    assert after["document"] == scenario["document"] and after["model_state"] == "PUBLISHED"
    assert after["content_hash"] == scenario["content_hash"]
    assert create(p, request)["id"] == scenario["id"]


def test_scenario_permissions_isolation_and_revocation(platform):
    p = platform
    request = body(p, p.model())
    for role in ("viewer", "approver"):
        assert p.request("POST", p.base + "/scenarios", role=role, json=request).status_code == 403
    assert (
        p.request("POST", p.base + "/scenarios", role="outsider", json=request).status_code == 404
    )
    scenario = create(p, request)
    path = p.base + f"/scenarios/{scenario['id']}"
    assert p.client.get(path).status_code == 401
    for role in ("admin", "approver", "builder", "viewer"):
        response = p.request("GET", path, role=role)
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    other = p.request(
        "POST", "/api/v1/organizations", role="outsider", json={"key": "other", "name": "Other"}
    ).json()["id"]
    assert p.request("GET", path, role="outsider").status_code == 404
    assert (
        p.request(
            "GET", f"/api/v1/organizations/{other}/scenarios/{scenario['id']}", role="outsider"
        ).status_code
        == 404
    )
    for verb in ("PATCH", "PUT", "DELETE"):
        assert p.request(verb, path, json={}).status_code == 405
    assert (
        p.request("GET", p.base + "/scenarios?limit=1").json()["items"][0]["id"] == scenario["id"]
    )
    assert p.request("GET", p.base + "/scenarios?limit=1&offset=1").json()["items"] == []
    p.request(
        "PUT",
        p.base + "/memberships",
        json={"user_id": p.users["viewer"], "role": "VIEWER", "active": False},
    )
    assert p.request("GET", path, role="viewer").status_code == 404
    foreign_request = {**request, "key": "foreign"}
    assert (
        p.request(
            "POST",
            f"/api/v1/organizations/{other}/scenarios",
            role="outsider",
            json=foreign_request,
        ).status_code
        == 404
    )


def test_closed_override_contract_stale_reference_and_conflicts(platform):
    p = platform
    draft = p.model(publish=False)
    assert p.request("POST", p.base + "/scenarios", json=body(p, draft)).status_code == 409
    p.request("POST", p.base + f"/model-versions/{draft}/publish", role="approver")
    request = body(p, draft)
    for field, value in (
        ("overrides", {"delivery_capacity_units": "60"}),
        ("changes", []),
        ("constraints", []),
        ("created_by", p.users["admin"]),
        ("organization_id", p.organization_id),
        ("model", p.source),
    ):
        response = p.request("POST", p.base + "/scenarios", json={**request, field: value})
        assert response.status_code == 422
    assert (
        p.request(
            "POST",
            p.base + "/scenarios",
            json={**request, "expected_source_content_hash": "0" * 64},
        ).status_code
        == 409
    )
    assert p.request("GET", p.base + "/scenarios").json()["items"] == []
    scenario = create(p, request)
    assert (
        p.request(
            "POST", p.base + "/scenarios", role="builder", json={**request, "reason": "different"}
        ).status_code
        == 409
    )
    assert p.request("POST", p.base + "/scenarios", role="admin", json=request).status_code == 409
    second = create(p, {**request, "version": "2"})
    assert (
        second["id"] != scenario["id"]
        and second["model_version_id"] != scenario["model_version_id"]
    )
    different_reference = scenario["model_version_id"]
    p.request("POST", p.base + f"/model-versions/{different_reference}/publish", role="approver")
    assert (
        p.request(
            "POST", p.base + "/scenarios", json={**body(p, different_reference), "version": "3"}
        ).status_code
        == 409
    )


def test_database_immutability_rls_and_scenario_foreign_keys(platform):
    p = platform
    scenario = create(p)
    for operation in (
        "UPDATE scenario_versions SET version='corrupt' WHERE id=:id",
        "DELETE FROM scenario_versions WHERE id=:id",
    ):
        with pytest.raises(DBAPIError), p.admin_engine.begin() as connection:
            connection.execute(text(operation), {"id": scenario["id"]})
    if p.admin_engine.dialect.name == "postgresql":
        with p.app.state.engine.begin() as connection:
            assert connection.scalar(text("SELECT count(*) FROM scenario_versions")) == 0
        with p.app.state.session_factory.begin() as session:
            set_tenant(session, p.organization_id)
            assert session.get(ScenarioVersion, scenario["id"]) is not None
        with p.app.state.engine.begin() as connection:
            assert connection.scalar(text("SELECT count(*) FROM scenario_versions")) == 0
        for sql in (
            "TRUNCATE scenario_versions",
            "UPDATE scenario_versions SET version='bad'",
            "DELETE FROM scenario_versions",
        ):
            with pytest.raises(DBAPIError), p.app.state.engine.begin() as connection:
                connection.execute(text(sql))
    unused = deepcopy(p.source)
    unused["model_id"] = "unused_fk_target"
    unused_model = p.request(
        "POST",
        p.base + "/model-versions",
        role="builder",
        json={"graph_snapshot_id": scenario["document"]["graph_snapshot_id"], "model": unused},
    )
    assert unused_model.status_code == 201
    # Test with the runtime engine, which enables SQLite foreign keys as well
    # as PostgreSQL RLS. The migration-only SQLite engine does not enable PRAGMA.
    with pytest.raises(DBAPIError), p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        sql = "INSERT INTO scenario_versions (id,organization_id,key,version,source_model_version_id,model_version_id,graph_snapshot_id,data_snapshot_id,request_hash,payload,content_hash,created_by,created_at) SELECT 'bad',organization_id,'bad','bad',source_model_version_id,:model,graph_snapshot_id,data_snapshot_id,request_hash,payload,content_hash,:user,created_at FROM scenario_versions WHERE id=:id"
        session.execute(
            text(sql),
            {
                "user": p.users["outsider"],
                "id": scenario["id"],
                "model": unused_model.json()["id"],
            },
        )


@pytest.mark.parametrize("platform", ["postgresql"], indirect=True)
def test_concurrent_identical_scenario_creation_is_atomic(platform):
    p = platform
    request = body(p, p.model())
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(
            pool.map(
                lambda _: p.request("POST", p.base + "/scenarios", role="builder", json=request),
                range(3),
            )
        )
    assert all(r.status_code == 201 for r in responses)
    assert len({r.json()["id"] for r in responses}) == 1
    with p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        assert len(session.scalars(select(ScenarioVersion)).all()) == 1
        assert len(session.scalars(select(ModelVersion)).all()) == 2
    audit = p.request("GET", p.base + "/audit-events").json()["items"]
    assert sum(e["action"] == "scenario.created" for e in audit) == 1
    attempts = [{**request, "version": "2", "reason": reason} for reason in ("first", "second")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        conflicting = list(
            pool.map(
                lambda value: p.request("POST", p.base + "/scenarios", role="builder", json=value),
                attempts,
            )
        )
    assert sorted(r.status_code for r in conflicting) == [201, 409]


def test_scenario_failure_rolls_back_derived_model(platform, monkeypatch):
    p = platform
    request = body(p, p.model())
    original = service.audit

    def fail_scenario(session, scope, action, identity):
        if action == "scenario.created":
            raise service.ServiceError(409, "synthetic atomic failure")
        original(session, scope, action, identity)

    monkeypatch.setattr(service, "audit", fail_scenario)
    assert p.request("POST", p.base + "/scenarios", role="builder", json=request).status_code == 409
    assert p.request("GET", p.base + "/scenarios").json()["items"] == []
    assert len(p.request("GET", p.base + "/model-versions").json()["items"]) == 1


def test_upgrade_preserves_existing_model_payload(platform):
    p = platform
    identity = p.model()
    path = p.base + f"/model-versions/{identity}"
    before = p.request("GET", path).json()
    migrate(p.admin_engine, "0004_4c", downgrade=True)
    migrate(p.admin_engine)
    assert p.request("GET", path).json() == before
    assert create(p, body(p, identity))["model_state"] == "DRAFT"


def test_scenario_checksum_rejects_corruption_without_rewriting_history(platform):
    from brain.platform.scenarios import scenario_view

    p = platform
    scenario = create(p)
    path = p.base + f"/scenarios/{scenario['id']}"
    with p.app.state.session_factory() as session:
        set_tenant(session, p.organization_id)
        record = session.get(ScenarioVersion, scenario["id"])
        record.payload += " "
        with pytest.raises(service.ServiceError) as error:
            scenario_view(session, p.organization_id, record)
        assert error.value.status == 409
        # Closing the read session discards the deliberately corrupted in-memory copy.
    assert p.request("GET", path).json() == scenario


@pytest.mark.parametrize("sector,objective", [("factory", 4100), ("university", 17)])
def test_clone_math_goldens_without_altering_sources(sector, objective):
    from pathlib import Path
    from brain.platform.scenarios import _clone
    from brain.organization.project import load_organization_file

    source = load_organization_file(
        Path(__file__).resolve().parents[1] / f"examples/organizations/{sector}/project.json"
    )
    composition = compose_organization_model(source)
    clone = _clone(composition, "scenario_synthetic_test")
    result = solve_organization(clone)
    assert result.solve.objective_value == objective
    assert result.report.has_verified_plan
    assert result.composition.ir.model_hash == composition.ir.model_hash
