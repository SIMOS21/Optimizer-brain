"""Execute one fenced optimization and atomically persist its verified run."""

import ctypes
import json
import os
import signal
import sys
import time

from sqlalchemy import select

from brain.organization.runtime import solve_organization
from brain.platform.database import Settings, database_now, make_engine, sessions, set_tenant
from brain.platform.models import OptimizationJob, User
from brain.platform import service
from brain.solvers.contracts import SolveSettings


def _install_parent_death_signal(expected_parent: int) -> bool:
    if sys.platform != "linux":
        return True

    def terminate_group(signum: int, frame: object) -> None:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            os.killpg(os.getpgrp(), signal.SIGTERM)
            time.sleep(float(os.environ.get("BRAIN_JOB_TERMINATION_GRACE_SECONDS", "3")))
            os.killpg(os.getpgrp(), signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            os._exit(128 + signum)

    signal.signal(signal.SIGUSR1, terminate_group)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGUSR1, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    if os.getppid() != expected_parent:
        terminate_group(signal.SIGUSR1, None)
        return False
    return True


def execute_job(organization_id: str, job_id: str, attempt_id: str, parent_pid: int) -> int:
    if not _install_parent_death_signal(parent_pid):
        return 10
    if sys.stdin.buffer.readline(64) != b"START\n":
        return 10

    engine = make_engine(Settings.from_env())
    factory = sessions(engine)
    try:
        with factory.begin() as session:
            set_tenant(session, organization_id)
            current = database_now(session)
            job = session.scalar(
                select(OptimizationJob).where(
                    OptimizationJob.id == job_id,
                    OptimizationJob.organization_id == organization_id,
                )
            )
            if (
                job is None
                or job.state != "RUNNING"
                or job.attempt_id != attempt_id
                or job.cancel_requested_at is not None
                or job.lease_expires_at is None
                or job.lease_expires_at <= current
            ):
                return 10
            user = session.get(User, job.created_by)
            if user is None or not user.active:
                raise ValueError("Le propriétaire du job n'est plus actif")
            service.tenant(session, user, organization_id, roles=("ADMIN", "BUILDER"))
            model = service.get_model(session, organization_id, job.model_version_id)
            if model.state != "PUBLISHED":
                raise ValueError("Le modèle publié est indisponible")
            raw_model = json.loads(model.payload)["organization_model"]
            settings = SolveSettings.model_validate(json.loads(job.settings))
            model_version_id = job.model_version_id

        result = solve_organization(raw_model, settings).solve

        with factory.begin() as session:
            service.tenant(session, user, organization_id, roles=("ADMIN", "BUILDER"), lock=True)
            # The solving transaction ended before computation. Re-read identity
            # under a row lock so a committed account revocation also fences
            # publication, and a concurrent disable waits for this transaction.
            publisher = session.scalar(select(User).where(User.id == user.id).with_for_update())
            if publisher is None or not publisher.active:
                raise ValueError("Le propriétaire du job n'est plus actif")
            job = session.scalar(
                select(OptimizationJob)
                .where(
                    OptimizationJob.id == job_id,
                    OptimizationJob.organization_id == organization_id,
                )
                .with_for_update()
            )
            current = database_now(session)
            if (
                job is None
                or job.state != "RUNNING"
                or job.attempt_id != attempt_id
                or job.cancel_requested_at is not None
                or job.lease_expires_at is None
                or job.lease_expires_at <= current
            ):
                return 10
            run = service.record_run(session, publisher, organization_id, model_version_id, result)
            current = database_now(session)
            if job.lease_expires_at is None or job.lease_expires_at <= current:
                raise TimeoutError("Le bail du job a expiré avant la persistance")
            job.state = "SUCCEEDED"
            job.solver_status = result.public_status
            job.run_id = run.id
            job.error_code = None
            job.updated_at = current
            job.finished_at = current
            job.heartbeat_at = current
            job.worker_id = None
            job.lease_expires_at = None
            session.flush()
        return 0
    finally:
        engine.dispose()


def main() -> int:
    args = sys.argv[1:]
    if len(args) != 4:
        return 2
    organization_id, job_id, attempt_id, parent_pid_raw = args
    return execute_job(organization_id, job_id, attempt_id, int(parent_pid_raw))


if __name__ == "__main__":
    raise SystemExit(main())
