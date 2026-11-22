"""SQLAlchemy 2 entities. Tenant keys also participate in foreign-key constraints."""

import time
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id() -> str:
    return str(uuid4())


def now() -> int:
    return int(time.time())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(128), unique=True)
    display_name: Mapped[str] = mapped_column(String(500))
    password_hash: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(500))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)


class Membership(Base):
    __tablename__ = "memberships"
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)
    __table_args__ = (
        CheckConstraint("role IN ('ADMIN','BUILDER','APPROVER','VIEWER')", name="membership_role"),
    )


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    key: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(500))
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)
    __table_args__ = (
        UniqueConstraint("organization_id", "key"),
        UniqueConstraint("organization_id", "id"),
        ForeignKeyConstraint(
            ["organization_id", "owner_user_id"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )


class Artifact:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    key: Mapped[str] = mapped_column(String(100))
    version: Mapped[str] = mapped_column(String(500))
    state: Mapped[str] = mapped_column(String(16), default="DRAFT")
    payload: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)
    published_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    published_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class GraphSnapshot(Artifact, Base):
    __tablename__ = "graph_snapshots"
    __table_args__ = (
        UniqueConstraint("organization_id", "key", "version"),
        UniqueConstraint("organization_id", "id"),
        CheckConstraint(
            "(state='DRAFT' AND published_by IS NULL AND published_at IS NULL) OR (state='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL)",
            name="graph_publication",
        ),
        ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        ForeignKeyConstraint(
            ["organization_id", "published_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )


class ModelVersion(Artifact, Base):
    __tablename__ = "model_versions"
    graph_snapshot_id: Mapped[str] = mapped_column(String(36))
    model_hash: Mapped[str] = mapped_column(String(64))
    data_snapshot_id: Mapped[str] = mapped_column(String(500))
    __table_args__ = (
        UniqueConstraint("organization_id", "key", "version"),
        UniqueConstraint("organization_id", "id"),
        CheckConstraint(
            "(state='DRAFT' AND published_by IS NULL AND published_at IS NULL) OR (state='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL)",
            name="model_publication",
        ),
        ForeignKeyConstraint(
            ["organization_id", "graph_snapshot_id"],
            ["graph_snapshots.organization_id", "graph_snapshots.id"],
        ),
        ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        ForeignKeyConstraint(
            ["organization_id", "published_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )


class OptimizationRun(Base):
    __tablename__ = "optimization_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    model_version_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(64))
    payload: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "model_version_id"],
            ["model_versions.organization_id", "model_versions.id"],
        ),
        ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )


class OptimizationJob(Base):
    __tablename__ = "optimization_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(String(36), nullable=False)
    model_version_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="QUEUED")
    settings: Mapped[str] = mapped_column(Text, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    solver_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cancel_requested_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    attempt_number: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    attempt_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    heartbeat_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    lease_expires_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=now)
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=now)
    started_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    finished_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "created_by",
            "idempotency_key_hash",
            name="uq_optimization_jobs_idempotency",
        ),
        ForeignKeyConstraint(
            ["organization_id", "model_version_id"],
            ["model_versions.organization_id", "model_versions.id"],
        ),
        ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        ForeignKeyConstraint(
            ["run_id"],
            ["optimization_runs.id"],
        ),
        CheckConstraint(
            "state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')",
            name="optimization_job_state",
        ),
        CheckConstraint("attempt_number >= 0", name="optimization_job_attempt_number"),
        CheckConstraint(
            "(state='QUEUED' AND attempt_number=0 AND attempt_id IS NULL AND worker_id IS NULL "
            "AND lease_expires_at IS NULL AND run_id IS NULL AND solver_status IS NULL "
            "AND error_code IS NULL AND finished_at IS NULL) OR "
            "(state='RUNNING' AND attempt_number>0 AND attempt_id IS NOT NULL "
            "AND worker_id IS NOT NULL AND lease_expires_at IS NOT NULL "
            "AND run_id IS NULL AND solver_status IS NULL AND error_code IS NULL "
            "AND finished_at IS NULL) OR "
            "(state='SUCCEEDED' AND attempt_id IS NOT NULL AND run_id IS NOT NULL "
            "AND solver_status IS NOT NULL AND finished_at IS NOT NULL "
            "AND lease_expires_at IS NULL AND worker_id IS NULL AND error_code IS NULL "
            "AND cancel_requested_at IS NULL) OR "
            "(state='FAILED' AND attempt_id IS NOT NULL AND run_id IS NULL "
            "AND solver_status IS NULL AND finished_at IS NOT NULL "
            "AND error_code IS NOT NULL AND worker_id IS NULL AND lease_expires_at IS NULL) OR "
            "(state='CANCELLED' AND cancel_requested_at IS NOT NULL "
            "AND finished_at IS NOT NULL AND run_id IS NULL AND solver_status IS NULL "
            "AND error_code IS NULL AND worker_id IS NULL AND lease_expires_at IS NULL)",
            name="optimization_job_lifecycle",
        ),
        Index("ix_optimization_jobs_queue", "state", "created_at", "id"),
        Index("ix_optimization_jobs_expired", "state", "lease_expires_at"),
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)


class LoginThrottle(Base):
    __tablename__ = "login_throttles"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int] = mapped_column(default=0)
    window_until: Mapped[int] = mapped_column(BigInteger)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    actor_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(64))
    target_id: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[int] = mapped_column(BigInteger, default=now)
