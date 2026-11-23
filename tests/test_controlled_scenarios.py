"""Published policy authority, controlled immutable snapshots and real execution."""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import io
from types import SimpleNamespace

import pytest
from sqlalchemy import text, select
from sqlalchemy.exc import DBAPIError

from tests.conftest_platform import platform_fixture, postgres_urls_fixture  # noqa: F401
from tests.conftest_platform import migrate
from brain.platform import service, job_child, auth
from brain.platform.database import set_tenant
from brain.platform.models import (
    ScenarioChangePolicy,
    ScenarioPolicyApproval,
    ScenarioChangeLink,
    ScenarioVersion,
    ModelVersion,
    GraphSnapshot,
    OptimizationJob,
    OptimizationRun,
    User,
    now,
)
from brain.platform.worker import OptimizationWorker, WorkerSettings


def policy_body(p, source=None):
    source = source or p.model()
    record = p.request("GET", p.base + f"/model-versions/{source}").json()
    return {
        "key": "controlled_capacity",
        "version": "1",
        "name": "Synthetic allowed capacity",
        "reason": "Explicit synthetic hypothesis range",
        "source_model_version_id": source,
        "expected_source_content_hash": record["content_hash"],
        "rules": [
            {
                "id": "delivery",
                "target": {
                    "kind": "RESOURCE_CAPACITY",
                    "resource_id": "logistics_resource",
                    "parameter_id": "delivery_capacity_units",
                    "path": "shared_parameters.delivery_capacity_units.value",
                },
                "operation": "SET",
                "domain": "INTEGER",
                "unit": "unit",
                "minimum": "40",
                "maximum": "70",
                "owner_department": "logistics",
                "owner_user_id": p.users["builder"],
                "allowed_user_ids": [p.users["builder"]],
                "approval": "OWNER_ACK_AND_PUBLICATION",
            }
        ],
    }


def make_policy(p, *, publish=True, body=None):
    response = p.request(
        "POST", p.base + "/scenario-change-policies", role="builder", json=body or policy_body(p)
    )
    assert response.status_code == 201, response.text
    record = response.json()
    if publish:
        path = p.base + f"/scenario-change-policies/{record['id']}"
        expected = {"expected_policy_content_hash": record["content_hash"]}
        approved = p.request("POST", path + "/owner-approval", role="builder", json=expected)
        assert approved.status_code == 200, approved.text
        response = p.request("POST", path + "/publish", role="approver", json=expected)
        assert response.status_code == 200, response.text
        record = response.json()
    return record


def proposal(p, policy, value="45", **updates):
    return {
        "key": "controlled_scenario",
        "version": "1",
        "name": "Synthetic changed capacity",
        "reason": "Explicit test hypothesis",
        "source_model_version_id": policy["document"]["source_model_version_id"],
        "expected_source_content_hash": policy["document"]["source_content_hash"],
        "policy_version_id": policy["id"],
        "expected_policy_content_hash": policy["content_hash"],
        "changes": [
            {
                "rule_id": "delivery",
                "unit": "unit",
                "operation": "SET",
                "value": value,
                "source": "synthetic_test",
            }
        ],
        **updates,
    }


def create_changed(p, value="45", *, policy=None, body=None):
    policy = policy or make_policy(p)
    request = body or proposal(p, policy, value)
    preview = p.request(
        "POST", p.base + "/controlled-scenarios/preview", role="builder", json=request
    )
    assert preview.status_code == 200, preview.text
    commit = {"proposal": request, "expected_preview_hash": preview.json()["preview_hash"]}
    response = p.request("POST", p.base + "/controlled-scenarios", role="builder", json=commit)
    assert response.status_code == 201, response.text
    return response.json(), preview.json(), commit


def publish_changed(p, scenario):
    graph = scenario["document"]["graph_snapshot_id"]
    model = scenario["model_version_id"]
    response = p.request("POST", p.base + f"/graphs/{graph}/publish", role="approver")
    assert response.status_code == 200, response.text
    response = p.request("POST", p.base + f"/model-versions/{model}/publish", role="approver")
    assert response.status_code == 200, response.text


def test_controlled_creation_isolated_preview_idempotence_and_publications(platform):
    p = platform
    policy = make_policy(p)
    source_id = policy["document"]["source_model_version_id"]
    original = p.request("GET", p.base + f"/model-versions/{source_id}").json()
    scenario, preview, commit = create_changed(p, policy=policy)
    assert preview["changes"][0]["original_value"] == "55"
    assert preview["changes"][0]["previous_value"] == "55"
    assert preview["changes"][0]["proposed_value"] == "45"
    assert preview["affected_constraint_ids"] == ["logistics_delivery"]
    assert scenario["document"]["kind"] == "CONTROLLED_CHANGES"
    assert scenario["document"]["data_snapshot_id"] != original["data_snapshot_id"]
    assert scenario["document"]["graph_snapshot_id"] != original["graph_snapshot_id"]
    assert scenario["model_state"] == "DRAFT"
    model_path = p.base + f"/model-versions/{scenario['model_version_id']}"
    assert p.request("POST", model_path + "/publish", role="approver").status_code == 409
    assert (
        p.request("GET", p.base + f"/graphs/{scenario['document']['graph_snapshot_id']}").json()[
            "state"
        ]
        == "DRAFT"
    )
    assert (
        p.client.post(
            model_path + "/optimization-jobs",
            headers={**p.headers["builder"], "Idempotency-Key": "controlled-job-1"},
            json={},
        ).status_code
        == 409
    )
    repeated = p.request("POST", p.base + "/controlled-scenarios", role="builder", json=commit)
    assert repeated.status_code == 201 and repeated.json()["id"] == scenario["id"]
    assert (
        p.request(
            "POST",
            p.base + "/controlled-scenarios",
            role="builder",
            json={**commit, "expected_preview_hash": "0" * 64},
        ).status_code
        == 409
    )
    publish_changed(p, scenario)
    assert p.request("GET", p.base + f"/model-versions/{source_id}").json() == original
    derived = p.request("GET", model_path).json()
    assert derived["model_hash"] == preview["model_hash"]
    raw = derived["document"]["organization_model"]
    assert raw["shared_parameters"]["delivery_capacity_units"]["value"] == "45"
    assert raw["shared_parameters"]["delivery_capacity_units"]["unit"] == "unit"
    assert (
        raw["graph"]["organization"]["data_snapshot_id"] == scenario["document"]["data_snapshot_id"]
    )
    assert all(
        f["organization_version"] == raw["graph"]["organization"]["version"]
        for f in raw["fragments"]
    )
    # The existing generic creation route cannot detach these controlled data.
    copied = deepcopy(raw)
    copied["model_version"] = "detached"
    assert (
        p.request(
            "POST",
            p.base + "/model-versions",
            role="builder",
            json={"graph_snapshot_id": derived["graph_snapshot_id"], "model": copied},
        ).status_code
        == 409
    )
    legacy = {
        "key": "detached",
        "version": "1",
        "name": "copy",
        "reason": "copy",
        "source_model_version_id": derived["id"],
        "expected_source_content_hash": derived["content_hash"],
    }
    assert p.request("POST", p.base + "/scenarios", role="builder", json=legacy).status_code == 409


@pytest.mark.parametrize(
    "bad,status",
    [
        ("above", 422),
        ("below", 422),
        ("fraction", 422),
        ("unit", 422),
        ("unknown", 422),
        ("hard", 422),
        ("not_delegated", 403),
        ("policy_draft", 409),
    ],
)
def test_controlled_changes_deny_every_out_of_policy_edit(platform, bad, status):
    p = platform
    policy = make_policy(p, publish=bad != "policy_draft")
    body = proposal(p, policy)
    role = "builder"
    if bad == "above":
        body["changes"][0]["value"] = "71"
    if bad == "below":
        body["changes"][0]["value"] = "39"
    if bad == "fraction":
        body["changes"][0]["value"] = "45.5"
    if bad == "unit":
        body["changes"][0]["unit"] = "hour"
    if bad == "unknown":
        body["changes"][0]["rule_id"] = "no_policy_parameter"
    if bad == "hard":
        body["changes"][0]["path"] = "constraints[0].rhs"
    if bad == "not_delegated":
        role = "admin"
    response = p.request("POST", p.base + "/controlled-scenarios/preview", role=role, json=body)
    assert response.status_code == status, response.text
    assert p.request("GET", p.base + "/scenarios").json()["items"] == []
    assert len(p.request("GET", p.base + "/graphs").json()["items"]) == 1


@pytest.mark.parametrize("revoked", ["builder", "approver"])
def test_revocation_blocks_new_changes_publication_and_execution_but_keeps_history(
    platform, revoked
):
    p = platform
    policy = make_policy(p)
    scenario, _, commit = create_changed(p, policy=policy)
    old = deepcopy(scenario["document"])
    p.request("PUT", p.base + "/memberships", json={"user_id": p.users[revoked], "role": "VIEWER"})
    assert (
        p.request(
            "POST", p.base + "/controlled-scenarios/preview", role="admin", json=commit["proposal"]
        ).status_code
        == 403
    )
    assert (
        p.request(
            "POST",
            p.base + f"/graphs/{scenario['document']['graph_snapshot_id']}/publish",
            role="admin",
        ).status_code
        == 403
    )
    assert p.request("GET", p.base + f"/scenarios/{scenario['id']}").json()["document"] == old
    p.request(
        "PUT", p.base + "/memberships", json={"user_id": p.users[revoked], "role": revoked.upper()}
    )
    publish_changed(p, scenario)
    p.request("PUT", p.base + "/memberships", json={"user_id": p.users[revoked], "role": "VIEWER"})
    response = p.client.post(
        p.base + f"/model-versions/{scenario['model_version_id']}/optimization-jobs",
        headers={**p.headers["admin"], "Idempotency-Key": "revoked-policy-test"},
        json={},
    )
    assert response.status_code == 403


def test_changed_parent_keeps_policy_reference_and_prior_versions(platform):
    p = platform
    policy = make_policy(p)
    parent, _, _ = create_changed(p, policy=policy)
    publish_changed(p, parent)
    before = p.request("GET", p.base + f"/scenarios/{parent['id']}").json()
    child_body = proposal(p, policy, "60", version="2", parent_scenario_id=parent["id"])
    child, preview, _ = create_changed(p, policy=policy, body=child_body)
    assert child["document"]["parent_scenario_id"] == parent["id"]
    assert preview["changes"][0]["previous_value"] == "45"
    assert preview["changes"][0]["original_value"] == "55"
    assert child["source_model_version_id"] == parent["source_model_version_id"]
    assert p.request("GET", p.base + f"/scenarios/{parent['id']}").json() == before


def test_policy_needs_named_owner_and_authorized_publisher(platform):
    p = platform
    record = make_policy(p, publish=False)
    path = p.base + f"/scenario-change-policies/{record['id']}"
    expected = {"expected_policy_content_hash": record["content_hash"]}
    assert record["state"] == "DRAFT" and not record["usable"]
    assert p.request("POST", path + "/publish", role="approver", json=expected).status_code == 403
    assert (
        p.request("POST", path + "/owner-approval", role="admin", json=expected).status_code == 403
    )
    assert (
        p.request("POST", path + "/owner-approval", role="viewer", json=expected).status_code == 403
    )
    assert (
        p.request(
            "POST",
            path + "/owner-approval",
            role="builder",
            json={"expected_policy_content_hash": "0" * 64},
        ).status_code
        == 409
    )
    for _ in range(2):
        assert (
            p.request("POST", path + "/owner-approval", role="builder", json=expected).status_code
            == 200
        )
    assert p.request("POST", path + "/publish", role="builder", json=expected).status_code == 403
    published = p.request("POST", path + "/publish", role="approver", json=expected).json()
    assert published["usable"] and published["state"] == "PUBLISHED"
    assert published["content_hash"] == record["content_hash"]
    assert len(published["approvals"]) == 1
    assert published["document"]["rules"][0]["minimum"] == "40"


@pytest.mark.parametrize("bad", ["path", "unit", "owner", "operation", "duplicate", "range"])
def test_policy_cannot_authorize_untyped_or_foreign_targets(platform, bad):
    p = platform
    body = policy_body(p)
    rule = body["rules"][0]
    if bad == "path":
        rule["target"]["path"] = "fragments[0].constraints[0].rhs"
    if bad == "unit":
        rule["unit"] = "hour"
    if bad == "owner":
        rule["owner_user_id"] = p.users["outsider"]
    if bad == "operation":
        rule["operation"] = "REMOVE"
    if bad == "duplicate":
        body["rules"].append(deepcopy(rule))
    if bad == "range":
        rule["minimum"], rule["maximum"] = "100", "0"
    response = p.request("POST", p.base + "/scenario-change-policies", json=body)
    assert response.status_code == 422, response.text


def test_policy_isolation_revocation_and_immutability(platform):
    p = platform
    record = make_policy(p)
    path = p.base + f"/scenario-change-policies/{record['id']}"
    assert p.client.get(path).status_code == 401
    assert p.request("GET", path, role="outsider").status_code == 404
    for table in ("scenario_change_policies", "scenario_policy_approvals"):
        with pytest.raises(DBAPIError), p.admin_engine.begin() as connection:
            connection.execute(text(f"DELETE FROM {table}"))
    p.request(
        "PUT", p.base + "/memberships", json={"user_id": p.users["approver"], "role": "VIEWER"}
    )
    after = p.request("GET", path).json()
    assert not after["usable"] and "PUBLISHER_REVOKED" in after["unavailability_reasons"]
    assert after["document"] == record["document"]
    assert after["content_hash"] == record["content_hash"]


def test_policy_targets_use_parameter_unit_and_registered_owner(platform):
    p = platform
    model = p.model()
    response = p.request("GET", p.base + f"/model-versions/{model}/scenario-targets", role="viewer")
    assert response.status_code == 200, response.text
    target = next(
        t for t in response.json()["items"] if t["target"]["resource_id"] == "logistics_resource"
    )
    assert target["unit"] == "unit" and target["value"] == "55"
    assert target["owner_department"] == "logistics"
    assert target["registered_owner_user_id"] == p.users["builder"]


def test_controlled_atomic_rollback_and_immutable_evidence(platform, monkeypatch):
    p = platform
    policy = make_policy(p)
    body = proposal(p, policy)
    before = {
        kind: p.request("GET", p.base + "/" + kind).json()
        for kind in ("graphs", "model-versions", "scenarios", "audit-events")
    }
    original = service.audit

    def fail(session, scope, action, identity):
        if action == "scenario.controlled_created":
            raise service.ServiceError(409, "synthetic rollback")
        original(session, scope, action, identity)

    monkeypatch.setattr(service, "audit", fail)
    preview = p.request(
        "POST", p.base + "/controlled-scenarios/preview", role="builder", json=body
    ).json()
    rejected = p.request(
        "POST",
        p.base + "/controlled-scenarios",
        role="builder",
        json={"proposal": body, "expected_preview_hash": preview["preview_hash"]},
    )
    assert rejected.status_code == 409
    for kind, old in before.items():
        assert p.request("GET", p.base + "/" + kind).json() == old
    monkeypatch.setattr(service, "audit", original)
    scenario, _, _ = create_changed(p, policy=policy)
    for table, where in (
        ("scenario_change_policies", "id=:policy"),
        ("scenario_policy_approvals", "policy_version_id=:policy"),
        ("scenario_change_links", "scenario_version_id=:scenario"),
    ):
        for statement in (
            f"DELETE FROM {table} WHERE {where}",
            f"UPDATE {table} SET organization_id='foreign' WHERE {where}",
        ):
            with pytest.raises(DBAPIError), p.admin_engine.begin() as connection:
                connection.execute(
                    text(statement), {"policy": policy["id"], "scenario": scenario["id"]}
                )
    assert p.request("GET", p.base + f"/scenarios/{scenario['id']}").json() == scenario


@pytest.mark.parametrize("platform", ["postgresql"], indirect=True)
def test_controlled_concurrent_idempotence_and_rls(platform):
    p = platform
    policy = make_policy(p)
    body = proposal(p, policy)
    preview = p.request(
        "POST", p.base + "/controlled-scenarios/preview", role="builder", json=body
    ).json()
    commit = {"proposal": body, "expected_preview_hash": preview["preview_hash"]}
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(
            pool.map(
                lambda _: p.request(
                    "POST", p.base + "/controlled-scenarios", role="builder", json=commit
                ),
                range(3),
            )
        )
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    assert len({r.json()["id"] for r in responses}) == 1
    scenario = responses[0].json()
    for table in ("scenario_change_policies", "scenario_policy_approvals", "scenario_change_links"):
        with p.app.state.engine.begin() as connection:
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0
        with p.app.state.session_factory.begin() as session:
            set_tenant(session, "foreign-organization")
            assert session.scalar(text(f"SELECT count(*) FROM {table}")) == 0
        for sql in (
            f"TRUNCATE {table}",
            f"UPDATE {table} SET organization_id='foreign'",
            f"DELETE FROM {table}",
        ):
            with pytest.raises(DBAPIError), p.app.state.engine.begin() as connection:
                connection.execute(text(sql))
    with p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        for cls, count in (
            (ScenarioVersion, 1),
            (ModelVersion, 2),
            (GraphSnapshot, 2),
            (ScenarioChangePolicy, 1),
            (ScenarioPolicyApproval, 1),
            (ScenarioChangeLink, 1),
        ):
            assert len(session.scalars(select(cls)).all()) == count
    foreign_policy = p.request(
        "GET", p.base + f"/scenario-change-policies/{policy['id']}", role="outsider"
    )
    assert foreign_policy.status_code == 404
    changed = deepcopy(commit)
    changed["proposal"]["changes"][0]["value"] = "46"
    changed_preview = p.request(
        "POST", p.base + "/controlled-scenarios/preview", role="builder", json=changed["proposal"]
    ).json()
    changed["expected_preview_hash"] = changed_preview["preview_hash"]
    assert (
        p.request(
            "POST", p.base + "/controlled-scenarios", role="builder", json=changed
        ).status_code
        == 409
    )
    assert p.request("GET", p.base + f"/scenarios/{scenario['id']}").json() == scenario


def test_upgrade_preserves_reference_and_slice_one_scenario(platform):
    from tests.test_scenarios import body, create

    p = platform
    legacy = create(p, body(p, p.model()))
    source_id = legacy["source_model_version_id"]
    reference = p.request("GET", p.base + f"/model-versions/{source_id}").json()
    migrate(p.admin_engine, "0005_5b", downgrade=True)
    migrate(p.admin_engine)
    assert p.request("GET", p.base + f"/scenarios/{legacy['id']}").json() == legacy
    assert p.request("GET", p.base + f"/model-versions/{source_id}").json() == reference
    create_changed(p, policy=make_policy(p, body=policy_body(p, source_id)))


def _controlled_job(p, scenario, *, role="builder"):
    return p.client.post(
        p.base + f"/model-versions/{scenario['model_version_id']}/optimization-jobs",
        headers={**p.headers[role], "Idempotency-Key": "controlled-real-worker-test"},
        json={},
    )


@pytest.mark.parametrize("platform", ["postgresql"], indirect=True)
def test_controlled_real_worker_independently_verified_and_original_golden(platform):
    from fractions import Fraction

    p = platform
    scenario, _, _ = create_changed(p)
    publish_changed(p, scenario)
    response = _controlled_job(p, scenario)
    assert response.status_code == 202, response.text
    worker = OptimizationWorker(
        p.app.state.engine,
        p.app.state.session_factory,
        WorkerSettings(),
        database_url=p.app.state.settings.database_url,
    )
    assert worker.run_once()
    job = p.request("GET", p.base + f"/optimization-jobs/{response.json()['id']}").json()
    assert job["state"] == "SUCCEEDED", job
    run = p.request("GET", p.base + f"/optimization-runs/{job['run_id']}").json()
    assert run["document"]["report"]["has_verified_plan"]
    # An exhaustive independent oracle for the synthetic factory, not an invented gain.
    objective = max(
        80 * a + 60 * b
        for a in range(41)
        for b in range(36)
        if 2 * a + b <= 100 and 100 * a + 200 * b <= 8000 and a + b <= 45
    )
    assert Fraction(str(run["document"]["solve"]["objective_value"])) == objective
    from brain.organization.runtime import solve_organization
    from brain.solvers.contracts import SolveSettings

    original = solve_organization(p.source, SolveSettings()).solve
    assert original.validation_report and original.validation_report.valid
    assert original.objective_value == 4100


@pytest.mark.parametrize("revoked", ["owner_account", "publisher_role", "owner_registry"])
def test_controlled_worker_rechecks_policy_authority_after_solving(platform, monkeypatch, revoked):
    p = platform
    policy_request = policy_body(p)
    policy_request["rules"][0]["allowed_user_ids"].append(p.users["admin"])
    policy = make_policy(p, body=policy_request)
    scenario, _, _ = create_changed(p, policy=policy)
    publish_changed(p, scenario)
    # The executing ADMIN remains active, so an owner's revocation cannot be
    # mistaken for the pre-existing actor-only revocation guard.
    response = _controlled_job(p, scenario, role="admin")
    assert response.status_code == 202
    job_id = response.json()["id"]
    attempt = "00000000-0000-0000-0000-000000000021"
    with p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        job = session.get(OptimizationJob, job_id)
        job.state, job.attempt_number, job.attempt_id = "RUNNING", 1, attempt
        job.worker_id = "00000000-0000-0000-0000-000000000022"
        job.lease_expires_at, job.started_at = now() + 300, now()
    monkeypatch.setattr(job_child, "_install_parent_death_signal", lambda _: True)
    monkeypatch.setattr(job_child.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(b"START\n")))
    monkeypatch.setattr(job_child.Settings, "from_env", lambda: p.app.state.settings)
    solve = job_child.solve_organization

    def revoke_after_solve(model, settings):
        result = solve(model, settings)
        if revoked == "owner_account":
            with p.app.state.session_factory.begin() as session:
                auth.disable_user(session, session.get(User, p.users["builder"]))
        elif revoked == "publisher_role":
            assert (
                p.request(
                    "PUT",
                    p.base + "/memberships",
                    json={"user_id": p.users["approver"], "role": "VIEWER"},
                ).status_code
                == 200
            )
        else:
            with p.admin_engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE departments SET owner_user_id=:user WHERE organization_id=:org AND key='logistics'"
                    ),
                    {"user": p.users["admin"], "org": p.organization_id},
                )
        return result

    monkeypatch.setattr(job_child, "solve_organization", revoke_after_solve)
    with pytest.raises(ValueError):
        job_child.execute_job(p.organization_id, job_id, attempt, 0)
    with p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        assert session.scalar(select(OptimizationRun)) is None
        assert session.get(OptimizationJob, job_id).run_id is None


@pytest.mark.parametrize("kind", ["SHARED_PARAMETER", "DEPARTMENT_PARAMETER"])
def test_exact_parameter_change_recompiles_without_changing_units_or_structure(platform, kind):
    from fractions import Fraction

    p = platform
    sales = next(f for f in p.source["fragments"] if f["department_id"] == "sales")
    key = "synthetic_margin"
    parameter = {
        "value": "80",
        "unit": "EUR/unit",
        "source": "synthetic",
        "approved": True,
        "version": "1",
    }
    target = {"kind": kind, "parameter_id": key}
    if kind == "SHARED_PARAMETER":
        p.source["shared_parameters"][key] = parameter
        target["path"] = f"shared_parameters.{key}.value"
    else:
        sales["parameters"][key] = parameter
        target.update(
            fragment_id=sales["id"], path=f"fragments[{sales['id']}].parameters.{key}.value"
        )
    p.source["objective"]["terms"][0]["coefficient"] = {"parameter": key}
    source = p.model()
    before = p.request("GET", p.base + f"/model-versions/{source}").json()
    body = policy_body(p, source)
    rule = body["rules"][0]
    rule.update(
        target=target,
        unit="EUR/unit",
        domain="DECIMAL",
        minimum="70",
        maximum="90",
        owner_department="sales",
    )
    policy = make_policy(p, body=body)
    request = proposal(p, policy, "80.00000000000000001")
    request["changes"][0]["unit"] = "EUR/unit"
    scenario, preview, _ = create_changed(p, policy=policy, body=request)
    assert preview["affects_objective"]
    assert preview["changes"][0]["proposed_value"] == "80.00000000000000001"
    derived = p.request("GET", p.base + f"/model-versions/{scenario['model_version_id']}").json()
    original_ir = before["document"]["ir"]
    changed_ir = derived["document"]["ir"]
    assert original_ir["variables"] == changed_ir["variables"]
    assert original_ir["constraints"] == changed_ir["constraints"]
    assert Fraction(changed_ir["objectives"][0]["terms"][0]["coefficient"]) == Fraction(
        "80.00000000000000001"
    )
    assert p.request("GET", p.base + f"/model-versions/{source}").json() == before


def test_closed_change_errors_and_missing_policy(platform):
    p = platform
    policy = make_policy(p)
    for value, code in (("999", "CHANGE_OUT_OF_RANGE"), ("45.5", "INTEGER_REQUIRED")):
        response = p.request(
            "POST",
            p.base + "/controlled-scenarios/preview",
            role="builder",
            json=proposal(p, policy, value),
        )
        assert response.status_code == 422
        assert response.json() == {"detail": {"code": code}}
    body = proposal(p, policy)
    body["changes"][0]["unit"] = "hour"
    assert p.request(
        "POST", p.base + "/controlled-scenarios/preview", role="builder", json=body
    ).json() == {"detail": {"code": "UNIT_CHANGE_FORBIDDEN"}}
    del body["policy_version_id"]
    assert (
        p.request(
            "POST", p.base + "/controlled-scenarios/preview", role="builder", json=body
        ).status_code
        == 422
    )
