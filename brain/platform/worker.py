"""PostgreSQL-backed optimization queue worker."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import json
import logging
import math
import os
import signal
import sys
import threading
import time
from uuid import uuid4

from sqlalchemy import select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from brain.platform.database import Settings, database_now, make_engine, sessions, set_tenant
from brain.platform.job_process import ManagedProcess, enable_child_subreaper
from brain.platform.models import OptimizationJob, Organization
from brain.solvers.contracts import SolveSettings

logger = logging.getLogger("brain.platform.worker")


@dataclass(frozen=True)
class WorkerSettings:
    poll_seconds: float = 0.5
    heartbeat_seconds: int = 5
    lease_seconds: int = 30
    max_concurrency: int = 1
    termination_grace_seconds: float = 3.0
    hard_timeout_grace_seconds: float = 10.0
    memory_limit_bytes: int = 2 * 1024**3

    def __post_init__(self) -> None:
        if not math.isfinite(self.poll_seconds) or not 0.05 <= self.poll_seconds <= 10:
            raise ValueError("BRAIN_JOB_POLL_SECONDS doit être compris entre 0,05 et 10")
        if not 1 <= self.heartbeat_seconds <= 60:
            raise ValueError("BRAIN_JOB_HEARTBEAT_SECONDS doit être compris entre 1 et 60")
        if self.lease_seconds < self.heartbeat_seconds * 3 or self.lease_seconds > 3600:
            raise ValueError("Le bail doit être au moins trois fois le délai de heartbeat")
        if not 1 <= self.max_concurrency <= 32:
            raise ValueError("BRAIN_JOB_MAX_CONCURRENCY doit être compris entre 1 et 32")
        if not math.isfinite(self.termination_grace_seconds) or not (
            0 <= self.termination_grace_seconds <= 60
        ):
            raise ValueError("Délai de terminaison invalide")
        if not math.isfinite(self.hard_timeout_grace_seconds) or not (
            0.1 <= self.hard_timeout_grace_seconds <= 120
        ):
            raise ValueError("Délai de timeout invalide")
        if not 256 * 1024**2 <= self.memory_limit_bytes <= 64 * 1024**3:
            raise ValueError("Limite mémoire attendue entre 256 MiB et 64 GiB")

    @classmethod
    def from_env(cls) -> "WorkerSettings":
        return cls(
            poll_seconds=float(os.environ.get("BRAIN_JOB_POLL_SECONDS", "0.5")),
            heartbeat_seconds=int(os.environ.get("BRAIN_JOB_HEARTBEAT_SECONDS", "5")),
            lease_seconds=int(os.environ.get("BRAIN_JOB_LEASE_SECONDS", "30")),
            max_concurrency=int(os.environ.get("BRAIN_JOB_MAX_CONCURRENCY", "1")),
            termination_grace_seconds=float(
                os.environ.get("BRAIN_JOB_TERMINATION_GRACE_SECONDS", "3")
            ),
            hard_timeout_grace_seconds=float(
                os.environ.get("BRAIN_JOB_HARD_TIMEOUT_GRACE_SECONDS", "10")
            ),
            memory_limit_bytes=int(
                os.environ.get("BRAIN_JOB_MEMORY_LIMIT_BYTES", str(2 * 1024**3))
            ),
        )


@dataclass(frozen=True)
class JobClaim:
    id: str
    organization_id: str
    model_version_id: str
    settings: str
    attempt_id: str
    worker_id: str


class OptimizationWorker:
    def __init__(
        self,
        engine: Engine,
        factory: sessionmaker[Session],
        settings: WorkerSettings,
        database_url: str | None = None,
    ) -> None:
        if engine.dialect.name != "postgresql":
            raise ValueError("Le worker d'optimisation exige PostgreSQL")
        with engine.connect() as connection:
            role = connection.execute(
                text("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")
            ).one()
            if role[0] or role[1]:
                raise ValueError("Le worker refuse un rôle PostgreSQL superuser/BYPASSRLS")
            revision = (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            )
            if revision != ["0004_4c"]:
                raise ValueError("Migration Phase 4C requise avant le démarrage du worker")
            if connection.scalar(
                text("SELECT has_table_privilege(current_user, 'optimization_jobs', 'TRUNCATE')")
            ):
                raise ValueError("Le rôle du worker ne doit pas pouvoir tronquer les jobs")
        self.engine = engine
        self.factory = factory
        self.settings = settings
        self.database_url = database_url or os.environ.get("BRAIN_DATABASE_URL")

    def run(self, stop_event: threading.Event) -> None:
        enable_child_subreaper()
        worker_ids = [str(uuid4()) for _ in range(self.settings.max_concurrency)]
        with ThreadPoolExecutor(max_workers=len(worker_ids)) as executor:
            futures = [
                executor.submit(self._run_slot, worker_id, stop_event) for worker_id in worker_ids
            ]
            try:
                for future in futures:
                    future.result()
            except BaseException:
                stop_event.set()
                raise

    def run_once(
        self, worker_id: str | None = None, stop_event: threading.Event | None = None
    ) -> bool:
        claim = self._claim_next_job(worker_id or str(uuid4()))
        if claim is None:
            return False
        self._execute(claim, stop_event)
        return True

    def _run_slot(self, worker_id: str, stop_event: threading.Event) -> None:
        while not stop_event.is_set():
            if not self.run_once(worker_id, stop_event):
                stop_event.wait(self.settings.poll_seconds)

    def _claim_next_job(self, worker_id: str) -> JobClaim | None:
        with self.factory.begin() as session:
            current = database_now(session)
            organizations = session.scalars(select(Organization.id).order_by(Organization.id))
            for organization_id in organizations:
                set_tenant(session, organization_id)
                expired = session.scalars(
                    select(OptimizationJob)
                    .where(
                        OptimizationJob.organization_id == organization_id,
                        OptimizationJob.state == "RUNNING",
                        OptimizationJob.lease_expires_at <= current,
                    )
                    .order_by(OptimizationJob.lease_expires_at, OptimizationJob.id)
                    .with_for_update(skip_locked=True)
                    .limit(20)
                )
                for job in expired:
                    job.state = "FAILED"
                    job.error_code = "WORKER_LEASE_EXPIRED"
                    job.updated_at = current
                    job.finished_at = current
                    job.worker_id = None
                    job.lease_expires_at = None

                queued = session.scalar(
                    select(OptimizationJob)
                    .where(
                        OptimizationJob.organization_id == organization_id,
                        OptimizationJob.state == "QUEUED",
                    )
                    .order_by(OptimizationJob.created_at, OptimizationJob.id)
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
                if queued is None:
                    continue
                if queued.cancel_requested_at is not None:
                    queued.state = "CANCELLED"
                    queued.updated_at = current
                    queued.finished_at = current
                    continue
                attempt_id = str(uuid4())
                queued.state = "RUNNING"
                queued.attempt_number += 1
                queued.attempt_id = attempt_id
                queued.worker_id = worker_id
                queued.heartbeat_at = current
                queued.lease_expires_at = current + self.settings.lease_seconds
                queued.started_at = current
                queued.updated_at = current
                session.flush()
                return JobClaim(
                    queued.id,
                    organization_id,
                    queued.model_version_id,
                    queued.settings,
                    attempt_id,
                    worker_id,
                )
        return None

    def _child_environment(self, time_limit_seconds: float) -> dict[str, str]:
        if not self.database_url:
            raise ValueError("BRAIN_DATABASE_URL requis pour le worker")
        env = {
            key: value
            for key, value in os.environ.items()
            if key
            in (
                "PATH",
                "SYSTEMROOT",
                "WINDIR",
                "TEMP",
                "TMP",
                "HOME",
                "LANG",
                "APPDATA",
                "LOCALAPPDATA",
                "USERPROFILE",
                "PYTHONPATH",
                "PYTHONUSERBASE",
                "PYTHONHOME",
                "PYTHONNOUSERSITE",
                "VIRTUAL_ENV",
            )
        }
        env["BRAIN_DATABASE_URL"] = self.database_url
        env["BRAIN_JOB_MEMORY_LIMIT_BYTES"] = str(self.settings.memory_limit_bytes)
        env["BRAIN_JOB_TERMINATION_GRACE_SECONDS"] = str(self.settings.termination_grace_seconds)
        env["BRAIN_JOB_CPU_LIMIT_SECONDS"] = str(
            math.ceil(time_limit_seconds + self.settings.hard_timeout_grace_seconds)
        )
        return env

    def _execute(self, claim: JobClaim, stop_event: threading.Event | None) -> None:
        try:
            solver_settings = SolveSettings.model_validate(json.loads(claim.settings))
        except (ValueError, TypeError):
            self._finish_failed(claim, "INVALID_JOB_SETTINGS")
            return
        command = [
            sys.executable,
            "-m",
            "brain.platform.job_bootstrap",
            claim.organization_id,
            claim.id,
            claim.attempt_id,
            str(os.getpid()),
        ]
        try:
            process = ManagedProcess.launch(
                command,
                self._child_environment(solver_settings.time_limit_seconds),
                self.settings.memory_limit_bytes,
            )
        except (OSError, RuntimeError, ValueError):
            logger.exception("Could not start child for job %s", claim.id)
            self._finish_failed(claim, "PROCESS_START_FAILED")
            return
        self._supervise(claim, process, solver_settings.time_limit_seconds, stop_event)

    def _supervise(
        self,
        claim: JobClaim,
        process: ManagedProcess,
        time_limit_seconds: float,
        stop_event: threading.Event | None,
    ) -> None:
        started = time.monotonic()
        next_heartbeat = started + self.settings.heartbeat_seconds
        deadline = started + time_limit_seconds + self.settings.hard_timeout_grace_seconds
        while True:
            if process.process.poll() is not None:
                if not self._ensure_tree_stopped(process):
                    time.sleep(self.settings.poll_seconds)
                    continue
                job = self._read_job(claim)
                if job is not None and job.state == "SUCCEEDED":
                    return
                if job is not None and job.cancel_requested_at is not None:
                    self._finish_cancelled(claim)
                else:
                    self._finish_failed(claim, "CHILD_EXITED_WITHOUT_RESULT")
                return

            try:
                job = self._read_job(claim)
                if job is None or job.state in ("FAILED", "CANCELLED"):
                    if self._terminate_and_release(process):
                        return
                    time.sleep(self.settings.poll_seconds)
                    continue
                if job.state == "SUCCEEDED":
                    if time.monotonic() >= deadline or (
                        stop_event is not None and stop_event.is_set()
                    ):
                        if self._terminate_and_release(process):
                            return
                        time.sleep(self.settings.poll_seconds)
                        continue
                    time.sleep(min(self.settings.poll_seconds, 0.25))
                    continue
                if job.state != "RUNNING":
                    if self._terminate_and_release(process):
                        return
                    time.sleep(self.settings.poll_seconds)
                    continue
                if job.cancel_requested_at is not None:
                    if self._terminate_and_release(process):
                        self._finish_cancelled(claim)
                        return
                    logger.error("Could not confirm process-tree cancellation for job %s", claim.id)
                    time.sleep(self.settings.poll_seconds)
                    continue
                if time.monotonic() >= deadline:
                    if self._terminate_and_release(process):
                        latest = self._read_job(claim)
                        if latest is not None and latest.cancel_requested_at is not None:
                            self._finish_cancelled(claim)
                        else:
                            self._finish_failed(claim, "EXECUTION_TIMEOUT")
                        return
                    logger.error(
                        "Could not confirm timed-out process-tree exit for job %s", claim.id
                    )
                    time.sleep(self.settings.poll_seconds)
                    continue
                if time.monotonic() >= next_heartbeat:
                    if not self._heartbeat(claim):
                        if self._terminate_and_release(process):
                            return
                        logger.error(
                            "Could not confirm process-tree exit after lost lease for %s", claim.id
                        )
                        time.sleep(self.settings.poll_seconds)
                        continue
                    next_heartbeat = time.monotonic() + self.settings.heartbeat_seconds
            except SQLAlchemyError:
                logger.exception("Database error supervising job %s", claim.id)
                if self._terminate_and_release(process):
                    return
                time.sleep(self.settings.poll_seconds)
                continue

            if stop_event is not None and stop_event.is_set():
                if self._terminate_and_release(process):
                    self._finish_failed(claim, "WORKER_SHUTDOWN")
                    return
            time.sleep(min(self.settings.poll_seconds, 0.25))

    def _ensure_tree_stopped(self, process: ManagedProcess) -> bool:
        try:
            if process.tree_is_running():
                return process.terminate(self.settings.termination_grace_seconds)
            process.close()
            return True
        except OSError:
            logger.exception("Could not confirm child process-tree exit")
            return False

    def _terminate_and_release(self, process: ManagedProcess) -> bool:
        try:
            return process.terminate(self.settings.termination_grace_seconds)
        except OSError:
            logger.exception("Could not terminate child process tree")
            return False

    def _read_job(self, claim: JobClaim) -> OptimizationJob | None:
        with self.factory() as session:
            set_tenant(session, claim.organization_id)
            job = session.scalar(
                select(OptimizationJob).where(
                    OptimizationJob.id == claim.id,
                    OptimizationJob.organization_id == claim.organization_id,
                    OptimizationJob.attempt_id == claim.attempt_id,
                )
            )
            return job

    def _heartbeat(self, claim: JobClaim) -> bool:
        with self.factory.begin() as session:
            set_tenant(session, claim.organization_id)
            current = text("floor(extract(epoch FROM clock_timestamp()))::bigint")
            expiry = text(
                "floor(extract(epoch FROM clock_timestamp()))::bigint + :lease_seconds"
            ).bindparams(lease_seconds=self.settings.lease_seconds)
            result = session.scalar(
                update(OptimizationJob)
                .where(
                    OptimizationJob.id == claim.id,
                    OptimizationJob.organization_id == claim.organization_id,
                    OptimizationJob.state == "RUNNING",
                    OptimizationJob.attempt_id == claim.attempt_id,
                    OptimizationJob.worker_id == claim.worker_id,
                    OptimizationJob.lease_expires_at > current,
                )
                .values(
                    heartbeat_at=current,
                    lease_expires_at=expiry,
                    updated_at=current,
                )
                .returning(OptimizationJob.id)
            )
            return result is not None

    def _finish_cancelled(self, claim: JobClaim) -> bool:
        with self.factory.begin() as session:
            set_tenant(session, claim.organization_id)
            job = session.scalar(
                select(OptimizationJob)
                .where(
                    OptimizationJob.id == claim.id,
                    OptimizationJob.organization_id == claim.organization_id,
                )
                .with_for_update()
            )
            current = database_now(session)
            if (
                job is None
                or job.state != "RUNNING"
                or job.attempt_id != claim.attempt_id
                or job.cancel_requested_at is None
            ):
                return False
            job.state = "CANCELLED"
            job.finished_at = current
            job.updated_at = current
            job.worker_id = None
            job.lease_expires_at = None
            session.flush()
            return True

    def _finish_failed(self, claim: JobClaim, error_code: str) -> bool:
        with self.factory.begin() as session:
            set_tenant(session, claim.organization_id)
            job = session.scalar(
                select(OptimizationJob)
                .where(
                    OptimizationJob.id == claim.id,
                    OptimizationJob.organization_id == claim.organization_id,
                )
                .with_for_update()
            )
            current = database_now(session)
            if (
                job is None
                or job.state != "RUNNING"
                or job.attempt_id != claim.attempt_id
                or job.worker_id != claim.worker_id
            ):
                return False
            if job.cancel_requested_at is not None:
                job.state = "CANCELLED"
            else:
                job.state = "FAILED"
                job.error_code = error_code
            job.finished_at = current
            job.updated_at = current
            job.worker_id = None
            job.lease_expires_at = None
            session.flush()
            return True


def main() -> None:
    worker_settings = WorkerSettings.from_env()
    settings = Settings.from_env()
    engine = make_engine(settings)
    if engine.dialect.name != "postgresql":
        engine.dispose()
        raise ValueError("Le worker d'optimisation exige PostgreSQL")
    stop_event = threading.Event()

    def request_shutdown(signum: int, frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)
    try:
        OptimizationWorker(engine, sessions(engine), worker_settings).run(stop_event)
    finally:
        engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
