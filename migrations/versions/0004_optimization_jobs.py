"""Add durable, tenant-scoped optimization jobs.

Revision ID: 0004_4c
Revises: 0003_4a
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_4c"
down_revision = "0003_4a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "optimization_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("model_version_id", sa.String(length=36), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("settings", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key_hash", sa.String(length=64), nullable=False),
        sa.Column("solver_status", sa.String(length=64), nullable=True),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("cancel_requested_at", sa.BigInteger(), nullable=True),
        sa.Column("attempt_number", sa.BigInteger(), nullable=False),
        sa.Column("attempt_id", sa.String(length=36), nullable=True),
        sa.Column("worker_id", sa.String(length=36), nullable=True),
        sa.Column("heartbeat_at", sa.BigInteger(), nullable=True),
        sa.Column("lease_expires_at", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("started_at", sa.BigInteger(), nullable=True),
        sa.Column("finished_at", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')",
            name="optimization_job_state",
        ),
        sa.CheckConstraint("attempt_number >= 0", name="optimization_job_attempt_number"),
        sa.CheckConstraint(
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
        sa.ForeignKeyConstraint(
            ["organization_id", "model_version_id"],
            ["model_versions.organization_id", "model_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["optimization_runs.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "created_by",
            "idempotency_key_hash",
            name="uq_optimization_jobs_idempotency",
        ),
    )
    op.create_index(
        "ix_optimization_jobs_queue", "optimization_jobs", ["state", "created_at", "id"]
    )
    op.create_index(
        "ix_optimization_jobs_expired",
        "optimization_jobs",
        ["state", "lease_expires_at"],
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE optimization_jobs ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE optimization_jobs FORCE ROW LEVEL SECURITY")
        op.execute(
            """CREATE POLICY optimization_jobs_tenant_scope ON optimization_jobs
              USING (organization_id = current_setting('brain.organization_id', true))
              WITH CHECK (organization_id = current_setting('brain.organization_id', true))"""
        )
        op.execute(
            """CREATE FUNCTION guard_optimization_job_transition() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'optimization job history is immutable';
              END IF;
              IF TG_OP = 'INSERT' THEN
                IF NEW.state <> 'QUEUED' THEN
                  RAISE EXCEPTION 'optimization jobs must start queued';
                END IF;
                RETURN NEW;
              END IF;
              IF OLD.state IN ('SUCCEEDED','FAILED','CANCELLED') THEN
                RAISE EXCEPTION 'terminal optimization jobs are immutable';
              END IF;
              IF NEW.id IS DISTINCT FROM OLD.id
                 OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
                 OR NEW.model_version_id IS DISTINCT FROM OLD.model_version_id
                 OR NEW.created_by IS DISTINCT FROM OLD.created_by
                 OR NEW.settings IS DISTINCT FROM OLD.settings
                 OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
                 OR NEW.idempotency_key_hash IS DISTINCT FROM OLD.idempotency_key_hash
                 OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'optimization job definition is immutable';
              END IF;
              IF NOT (
                (OLD.state = 'QUEUED' AND NEW.state IN ('QUEUED','RUNNING','CANCELLED'))
                OR (OLD.state = 'RUNNING' AND NEW.state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED'))
              ) THEN
                RAISE EXCEPTION 'invalid optimization job state transition';
              END IF;
              IF OLD.state = 'RUNNING' AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN
                RAISE EXCEPTION 'running optimization job attempt is immutable';
              END IF;
              IF OLD.state = 'RUNNING' AND NEW.attempt_number IS DISTINCT FROM OLD.attempt_number THEN
                RAISE EXCEPTION 'running optimization job attempt number is immutable';
              END IF;
              IF OLD.state = 'QUEUED' AND NEW.state = 'RUNNING'
                 AND NEW.attempt_number <> OLD.attempt_number + 1 THEN
                RAISE EXCEPTION 'optimization job attempt number must increase by one';
              END IF;
              IF OLD.cancel_requested_at IS NOT NULL
                 AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at THEN
                RAISE EXCEPTION 'cancellation request is immutable';
              END IF;
              IF NEW.state = 'SUCCEEDED' AND NOT EXISTS (
                SELECT 1 FROM optimization_runs r
                WHERE r.id = NEW.run_id
                  AND r.organization_id = NEW.organization_id
                  AND r.model_version_id = NEW.model_version_id
              ) THEN
                RAISE EXCEPTION 'optimization run does not match the job model';
              END IF;
              RETURN NEW;
            END;
            $$"""
        )
        op.execute(
            """CREATE TRIGGER optimization_jobs_transition_guard
              BEFORE INSERT OR UPDATE OR DELETE ON optimization_jobs
              FOR EACH ROW EXECUTE FUNCTION guard_optimization_job_transition()"""
        )
        op.execute(
            """DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='brain_app') THEN
                REVOKE ALL PRIVILEGES ON optimization_jobs FROM brain_app;
                GRANT SELECT, INSERT, UPDATE ON optimization_jobs TO brain_app;
              END IF;
            END $$"""
        )
    elif op.get_bind().dialect.name == "sqlite":
        op.execute(
            """
            CREATE TRIGGER optimization_jobs_insert_guard
            BEFORE INSERT ON optimization_jobs
            WHEN NEW.state != 'QUEUED'
            BEGIN
              SELECT RAISE(ABORT, 'optimization jobs must start queued');
            END
            """
        )
        op.execute(
            """
            CREATE TRIGGER optimization_jobs_transition_guard
            BEFORE UPDATE ON optimization_jobs
            WHEN OLD.state IN ('SUCCEEDED','FAILED','CANCELLED')
              OR NEW.id != OLD.id
              OR NEW.organization_id != OLD.organization_id
              OR NEW.model_version_id != OLD.model_version_id
              OR NEW.created_by != OLD.created_by
              OR NEW.settings != OLD.settings
              OR NEW.request_hash != OLD.request_hash
              OR NEW.idempotency_key_hash != OLD.idempotency_key_hash
              OR NEW.created_at != OLD.created_at
              OR NOT (
                (OLD.state = 'QUEUED' AND NEW.state IN ('QUEUED','RUNNING','CANCELLED'))
                OR (OLD.state = 'RUNNING' AND NEW.state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED'))
              )
              OR (OLD.state = 'RUNNING' AND NEW.attempt_id != OLD.attempt_id)
              OR (OLD.state = 'RUNNING' AND NEW.attempt_number != OLD.attempt_number)
              OR (OLD.state = 'QUEUED' AND NEW.state = 'RUNNING'
                  AND NEW.attempt_number != OLD.attempt_number + 1)
              OR (OLD.cancel_requested_at IS NOT NULL
                  AND NEW.cancel_requested_at IS NOT OLD.cancel_requested_at)
              OR (NEW.state = 'SUCCEEDED' AND NOT EXISTS (
                  SELECT 1 FROM optimization_runs r
                  WHERE r.id = NEW.run_id
                    AND r.organization_id = NEW.organization_id
                    AND r.model_version_id = NEW.model_version_id))
            BEGIN
              SELECT RAISE(ABORT, 'invalid or immutable optimization job transition');
            END
            """
        )
        op.execute(
            """
            CREATE TRIGGER optimization_jobs_no_delete
            BEFORE DELETE ON optimization_jobs
            BEGIN
              SELECT RAISE(ABORT, 'optimization job history is immutable');
            END
            """
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "DROP TRIGGER IF EXISTS optimization_jobs_transition_guard ON optimization_jobs"
        )
        op.execute("DROP FUNCTION IF EXISTS guard_optimization_job_transition()")
        op.execute("DROP POLICY IF EXISTS optimization_jobs_tenant_scope ON optimization_jobs")
        op.execute("ALTER TABLE optimization_jobs DISABLE ROW LEVEL SECURITY")
    elif op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS optimization_jobs_transition_guard")
        op.execute("DROP TRIGGER IF EXISTS optimization_jobs_no_delete")
    op.drop_index("ix_optimization_jobs_expired", table_name="optimization_jobs")
    op.drop_index("ix_optimization_jobs_queue", table_name="optimization_jobs")
    op.drop_table("optimization_jobs")
