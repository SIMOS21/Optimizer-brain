"""Restrict the runtime role to required DML; no DDL, truncate or migration writes.

Revision ID: 0002_4a
Revises: 0001_4a
"""

from alembic import op

revision = "0002_4a"
down_revision = "0001_4a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='brain_app') THEN
            ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT,UPDATE,DELETE ON TABLES FROM brain_app;
            REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM brain_app;
            GRANT USAGE ON SCHEMA public TO brain_app;
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO brain_app;
            GRANT INSERT,UPDATE ON users,memberships,login_throttles,graph_snapshots,model_versions TO brain_app;
            GRANT INSERT ON organizations,departments,optimization_runs,audit_events TO brain_app;
            GRANT INSERT,DELETE ON auth_sessions TO brain_app;
          END IF;
        END $$""")


def downgrade() -> None:
    # Keep least-privilege grants on rollback; never restore broad runtime privileges.
    pass
