"""Phase 4C job API and PostgreSQL worker integration."""

from concurrent.futures import ThreadPoolExecutor
import json
import time

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError

from brain.platform.database import set_tenant
from brain.platform.models import OptimizationJob, now
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
