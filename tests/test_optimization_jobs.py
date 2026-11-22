"""Phase 4C job API and PostgreSQL worker integration."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import io
import json
import time
from types import SimpleNamespace

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from starlette.responses import Response

from brain.platform.database import set_tenant
from brain.platform.models import Membership, OptimizationJob, OptimizationRun, User, now
from brain.platform import auth, job_child
from brain.platform.worker import JobClaim, OptimizationWorker, WorkerSettings
from tests.conftest_platform import platform_fixture, postgres_urls_fixture  # noqa: F401


def _submit_job(platform, model_id: str, key: str, body: dict | None = None):
    headers = {
        **platform.headers["builder"],
        "Idempotency-Key": key,
    }
    return platform.client.post(
        platform.base + f"/model-versions/{model_id}/optimization-jobs",
        headers=headers,
        json=body or {},
    )


def test_job_api_idempotency_roles_and_tenant_isolation(platform):
    p = platform
    model_id = p.model()
    key = "test-idempotency-key-001"

    created = _submit_job(p, model_id, key)
    assert created.status_code == 202, created.text
    document = created.json()
    assert document["state"] == "QUEUED"
    assert document["solver_status"] is None
    assert document["run_id"] is None

    repeated = _submit_job(p, model_id, key)
    assert repeated.status_code == 202
    assert repeated.json()["id"] == document["id"]
    conflict = _submit_job(p, model_id, key, {"settings": {"time_limit_seconds": 10}})
    assert conflict.status_code == 409

    detail = p.request("GET", p.base + f"/optimization-jobs/{document['id']}", role="viewer")
    assert detail.status_code == 200
    assert detail.json()["id"] == document["id"]
    listed = p.request("GET", p.base + "/optimization-jobs", role="viewer")
    assert document["id"] in [item["id"] for item in listed.json()["items"]]
    assert (
        p.request(
            "POST",
            p.base + f"/optimization-jobs/{document['id']}/cancel",
            role="viewer",
        ).status_code
        == 403
    )
    assert (
        p.request(
            "GET", p.base + f"/optimization-jobs/{document['id']}", role="outsider"
        ).status_code
        == 404
    )

    cancelled = p.request(
        "POST",
        p.base + f"/optimization-jobs/{document['id']}/cancel",
        role="builder",
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["state"] == "QUEUED"
    assert cancelled.json()["cancel_requested"] is True

    if p.app.state.engine.dialect.name != "postgresql":
        pytest.skip("Le traitement de file et RLS exigent PostgreSQL")
    with p.app.state.session_factory() as session:
        assert (
            session.scalar(select(OptimizationJob.id).where(OptimizationJob.id == document["id"]))
            is None
        )
    worker = OptimizationWorker(
        p.app.state.engine,
        p.app.state.session_factory,
        WorkerSettings(),
        database_url=p.app.state.settings.database_url,
    )
    assert worker.run_once() is False
    final = p.request("GET", p.base + f"/optimization-jobs/{document['id']}", role="viewer")
    assert final.json()["state"] == "CANCELLED"
    assert final.json()["cancel_requested"] is True


def test_postgres_worker_persists_only_verified_run(platform):
    p = platform
    if p.app.state.engine.dialect.name != "postgresql":
        pytest.skip("L'exécution du worker nécessite PostgreSQL")

    model_id = p.model()
    created = _submit_job(p, model_id, "worker-idempotency-key-001")
    assert created.status_code == 202, created.text
    job_id = created.json()["id"]
    worker = OptimizationWorker(
        p.app.state.engine,
        p.app.state.session_factory,
        WorkerSettings(),
        database_url=p.app.state.settings.database_url,
    )

    assert worker.run_once() is True
    response = p.request("GET", p.base + f"/optimization-jobs/{job_id}", role="viewer")
    assert response.status_code == 200
    job = response.json()
    assert job["state"] == "SUCCEEDED", job
    assert job["solver_status"] in ("OPTIMAL", "FEASIBLE_NOT_PROVEN_OPTIMAL")
    assert job["run_id"]

    run = p.request("GET", p.base + f"/optimization-runs/{job['run_id']}", role="viewer")
    assert run.status_code == 200
    assert run.json()["document"]["report"]["has_verified_plan"] is True

    repeated_cancel = p.request(
        "POST", p.base + f"/optimization-jobs/{job_id}/cancel", role="builder"
    )
    assert repeated_cancel.status_code == 200
    assert repeated_cancel.json()["state"] == "SUCCEEDED"
    assert repeated_cancel.json()["cancel_requested"] is False
    assert worker.run_once() is False
    with pytest.raises(DBAPIError), p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        session.execute(
            update(OptimizationJob)
            .where(OptimizationJob.id == job_id)
            .values(state="FAILED", error_code="OVERWRITE")
        )
    with pytest.raises(DBAPIError), p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        session.add(
            OptimizationJob(
                organization_id=p.organization_id,
                model_version_id=model_id,
                created_by=p.users["builder"],
                state="SUCCEEDED",
                settings="{}",
                request_hash="a" * 64,
                idempotency_key_hash="b" * 64,
                solver_status=job["solver_status"],
                run_id=job["run_id"],
                attempt_number=1,
                attempt_id="00000000-0000-0000-0000-000000000003",
                finished_at=now(),
            )
        )


def test_postgres_skip_locked_claims_do_not_duplicate_jobs(platform):
    p = platform
    if p.app.state.engine.dialect.name != "postgresql":
        pytest.skip("SKIP LOCKED exige PostgreSQL")
    model_id = p.model()
    first = _submit_job(p, model_id, "claim-idempotency-key-001")
    second = _submit_job(p, model_id, "claim-idempotency-key-002")
    assert first.status_code == second.status_code == 202
    worker = OptimizationWorker(
        p.app.state.engine,
        p.app.state.session_factory,
        WorkerSettings(),
        database_url=p.app.state.settings.database_url,
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        claims = list(
            executor.map(
                worker._claim_next_job,
                (
                    "00000000-0000-0000-0000-000000000011",
                    "00000000-0000-0000-0000-000000000012",
                ),
            )
        )
    claimed_ids = [claim.id for claim in claims if claim is not None]
    assert len(claimed_ids) == 2
    assert len(set(claimed_ids)) == 2


def test_postgres_cancel_racing_with_worker_never_overwrites_success(platform):
    p = platform
    if p.app.state.engine.dialect.name != "postgresql":
        pytest.skip("Les transitions concurrentes exigent PostgreSQL")
    model_id = p.model()
    created = _submit_job(p, model_id, "race-idempotency-key-001")
    job_id = created.json()["id"]
    worker = OptimizationWorker(
        p.app.state.engine,
        p.app.state.session_factory,
        WorkerSettings(),
        database_url=p.app.state.settings.database_url,
    )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(worker.run_once)
        deadline = time.monotonic() + 10
        cancellation_requested = False
        while time.monotonic() < deadline:
            current = p.request(
                "GET", p.base + f"/optimization-jobs/{job_id}", role="viewer"
            ).json()
            if current["state"] == "RUNNING":
                cancellation = p.request(
                    "POST", p.base + f"/optimization-jobs/{job_id}/cancel", role="builder"
                )
                assert cancellation.status_code == 200
                cancellation_requested = True
                break
            if current["state"] in ("SUCCEEDED", "FAILED", "CANCELLED"):
                break
            time.sleep(0.02)
        assert cancellation_requested
        assert future.result(timeout=40) is True

    final = p.request("GET", p.base + f"/optimization-jobs/{job_id}", role="viewer").json()
    assert final["state"] in ("SUCCEEDED", "FAILED", "CANCELLED")
    if final["state"] == "CANCELLED":
        assert final["run_id"] is None
    elif final["state"] == "SUCCEEDED":
        assert final["run_id"]
        run = p.request("GET", p.base + f"/optimization-runs/{final['run_id']}", role="viewer")
        assert run.status_code == 200
        assert run.json()["document"]["report"]["has_verified_plan"] is True


def test_postgres_worker_hard_timeout_persists_no_run(platform):
    p = platform
    if p.app.state.engine.dialect.name != "postgresql":
        pytest.skip("Le timeout du worker exige PostgreSQL")
    model_id = p.model()
    created = _submit_job(
        p,
        model_id,
        "timeout-idempotency-key-001",
        {"settings": {"time_limit_seconds": 0.001}},
    )
    job_id = created.json()["id"]
    worker = OptimizationWorker(
        p.app.state.engine,
        p.app.state.session_factory,
        WorkerSettings(
            poll_seconds=0.05,
            heartbeat_seconds=1,
            lease_seconds=30,
            termination_grace_seconds=0.1,
            hard_timeout_grace_seconds=0.2,
        ),
        database_url=p.app.state.settings.database_url,
    )

    assert worker.run_once() is True
    final = p.request("GET", p.base + f"/optimization-jobs/{job_id}", role="viewer").json()
    assert final["state"] == "FAILED"
    assert final["error_code"] == "EXECUTION_TIMEOUT"
    assert final["run_id"] is None


def test_postgres_worker_expires_and_fences_stale_attempt(platform):
    p = platform
    if p.app.state.engine.dialect.name != "postgresql":
        pytest.skip("La récupération de bail exige PostgreSQL")
    model_id = p.model()
    created = _submit_job(p, model_id, "lease-idempotency-key-001")
    job_id = created.json()["id"]

    with p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        job = session.get(OptimizationJob, job_id)
        job.state = "RUNNING"
        job.attempt_number = 1
        job.attempt_id = "00000000-0000-0000-0000-000000000001"
        job.worker_id = "00000000-0000-0000-0000-000000000002"
        job.heartbeat_at = now() - 60
        job.lease_expires_at = now() - 30
        job.started_at = now() - 60
        job.updated_at = now() - 60
        job.cancel_requested_at = now() - 45

    worker = OptimizationWorker(
        p.app.state.engine,
        p.app.state.session_factory,
        WorkerSettings(),
        database_url=p.app.state.settings.database_url,
    )
    assert worker.run_once() is False
    with p.app.state.session_factory() as session:
        set_tenant(session, p.organization_id)
        job = session.get(OptimizationJob, job_id)
        assert job.state == "FAILED"
        assert job.error_code == "WORKER_LEASE_EXPIRED"
        assert job.cancel_requested_at is not None
        assert job.run_id is None
        stale_claim = JobClaim(
            job.id,
            p.organization_id,
            job.model_version_id,
            job.settings,
            job.attempt_id,
            "00000000-0000-0000-0000-000000000002",
        )
    worker._execute(stale_claim, None)

    stale = p.request("GET", p.base + f"/optimization-jobs/{job_id}", role="viewer")
    assert stale.json()["state"] == "FAILED"
    assert json.loads(stale_claim.settings)["time_limit_seconds"] > 0


def _prepare_running_child(p, monkeypatch):
    model_id = p.model()
    job_id = _submit_job(p, model_id, "revocation-idempotency-key").json()["id"]
    attempt_id = "00000000-0000-0000-0000-000000000021"
    with p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        job = session.get(OptimizationJob, job_id)
        job.state = "RUNNING"
        job.attempt_number = 1
        job.attempt_id = attempt_id
        job.worker_id = "00000000-0000-0000-0000-000000000022"
        job.lease_expires_at = now() + 300
        job.started_at = now()
    monkeypatch.setattr(job_child, "_install_parent_death_signal", lambda parent: True)
    monkeypatch.setattr(job_child.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(b"START\n")))
    monkeypatch.setattr(job_child.Settings, "from_env", lambda: p.app.state.settings)
    return job_id, attempt_id


def _assert_no_published_run(p, job_id):
    with p.app.state.session_factory() as session:
        set_tenant(session, p.organization_id)
        assert session.scalar(select(OptimizationRun.id)) is None
        job = session.get(OptimizationJob, job_id)
        assert job.state == "RUNNING"
        assert job.run_id is None


@pytest.mark.parametrize("revocation", ["account", "membership"])
def test_child_rechecks_authorization_before_publishing(platform, monkeypatch, revocation):
    """Revocation committed during solving must prevent a historical run."""
    p = platform
    job_id, attempt_id = _prepare_running_child(p, monkeypatch)

    original_solve = job_child.solve_organization

    def solve_then_revoke(model, settings):
        result = original_solve(model, settings)
        with p.app.state.session_factory.begin() as session:
            if revocation == "account":
                auth.disable_user(session, session.get(User, p.users["builder"]))
            else:
                session.get(Membership, (p.organization_id, p.users["builder"])).active = False
        return result

    monkeypatch.setattr(job_child, "solve_organization", solve_then_revoke)
    with pytest.raises(ValueError):
        job_child.execute_job(p.organization_id, job_id, attempt_id, 0)
    _assert_no_published_run(p, job_id)


def test_child_rolls_back_run_when_lease_expires_during_verification(platform, monkeypatch):
    p = platform
    job_id, attempt_id = _prepare_running_child(p, monkeypatch)
    original_clock = job_child.database_now
    calls = 0

    def clock(session):
        nonlocal calls
        calls += 1
        return original_clock(session) + (1000 if calls >= 3 else 0)

    monkeypatch.setattr(job_child, "database_now", clock)
    with pytest.raises(TimeoutError):
        job_child.execute_job(p.organization_id, job_id, attempt_id, 0)
    assert calls == 3
    _assert_no_published_run(p, job_id)


def test_child_rejects_corrupted_solution_before_persisting(platform, monkeypatch):
    p = platform
    job_id, attempt_id = _prepare_running_child(p, monkeypatch)
    original_solve = job_child.solve_organization

    def corrupt(model, settings):
        result = original_solve(model, settings)
        decisions = tuple((key, 0.0) for key, _ in result.solve.decision_values)
        return replace(result, solve=replace(result.solve, decision_values=decisions))

    monkeypatch.setattr(job_child, "solve_organization", corrupt)
    with pytest.raises(ValueError, match="revérification"):
        job_child.execute_job(p.organization_id, job_id, attempt_id, 0)
    _assert_no_published_run(p, job_id)


def test_job_submission_rejects_unpublished_models_roles_and_invalid_settings(platform):
    p = platform
    draft_id = p.model(publish=False)
    assert _submit_job(p, draft_id, "unpublished-model-test-key").status_code == 409
    model_id = p.model()
    route = p.base + f"/model-versions/{model_id}/optimization-jobs"
    for role in ("viewer", "approver"):
        assert (
            p.client.post(
                route,
                headers={**p.headers[role], "Idempotency-Key": "forbidden-role-test-key"},
                json={},
            ).status_code
            == 403
        )
    assert p.client.post(route, headers=p.headers["builder"], json={}).status_code == 422
    for settings in ({"time_limit_seconds": 301}, {"unexpected": True}):
        assert (
            _submit_job(
                p, model_id, "invalid-settings-test-key", {"settings": settings}
            ).status_code
            == 422
        )
    assert (
        p.client.post(
            route,
            headers={**p.headers["outsider"], "Idempotency-Key": "outsider-tenant-test-key"},
            json={},
        ).status_code
        == 404
    )
    assert p.request("GET", p.base + "/optimization-jobs").json()["items"] == []


def test_postgres_concurrent_submissions_share_one_idempotent_job(platform):
    p = platform
    if p.app.state.engine.dialect.name != "postgresql":
        pytest.skip("La sérialisation des soumissions concurrentes exige PostgreSQL")
    model_id = p.model()
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda _: _submit_job(p, model_id, "concurrent-idempotent-test-key"), range(2)
            )
        )
    assert [response.status_code for response in responses] == [202, 202]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert len(p.request("GET", p.base + "/optimization-jobs").json()["items"]) == 1


@pytest.mark.parametrize("kind", ["job", "graph"])
def test_mutation_commits_before_sending_success_response(platform, monkeypatch, kind):
    """An immediate GET/worker must be able to observe an acknowledged job."""
    p = platform
    model_id = p.model()
    events = []
    original_factory = p.app.state.session_factory
    original_call = Response.__call__

    def tracking_factory():
        session = original_factory()
        original_commit = session.commit

        def commit():
            original_commit()
            events.append("committed")

        session.commit = commit
        return session

    async def track_response(response, scope, receive, send):
        if response.status_code in (201, 202):
            events.append("accepted")
        await original_call(response, scope, receive, send)

    monkeypatch.setattr(p.app.state, "session_factory", tracking_factory)
    monkeypatch.setattr(Response, "__call__", track_response)
    if kind == "job":
        created = _submit_job(p, model_id, "commit-before-accepted-key")
        assert created.status_code == 202
    else:
        graph = p.graph_body()
        graph["graph"]["organization"]["version"] = "commit-order-test"
        created = p.request("POST", p.base + "/graphs", json=graph)
        assert created.status_code == 201, created.text
    assert events == ["committed", "accepted"]
