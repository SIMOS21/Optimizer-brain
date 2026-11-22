"""Immutable, tenant-scoped scenario versions; no change to stored model/run payloads.

Revision ID: 0005_5b
Revises: 0004_4c
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_5b"
down_revision = "0004_4c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scenario_versions",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("version", sa.String(500), nullable=False),
        sa.Column("source_model_version_id", sa.String(36), nullable=False),
        sa.Column("model_version_id", sa.String(36), nullable=False),
        sa.Column("graph_snapshot_id", sa.String(36), nullable=False),
        sa.Column("data_snapshot_id", sa.String(500), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "key", "version"),
        sa.UniqueConstraint("organization_id", "id"),
        sa.UniqueConstraint("organization_id", "model_version_id"),
        sa.CheckConstraint("source_model_version_id <> model_version_id", name="scenario_isolated"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(
            ["organization_id", "source_model_version_id"],
            ["model_versions.organization_id", "model_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "model_version_id"],
            ["model_versions.organization_id", "model_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "graph_snapshot_id"],
            ["graph_snapshots.organization_id", "graph_snapshots.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )
    op.create_index(
        "ix_scenario_versions_organization_id", "scenario_versions", ["organization_id"]
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE scenario_versions ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE scenario_versions FORCE ROW LEVEL SECURITY")
        op.execute("""CREATE POLICY scenario_versions_tenant_scope ON scenario_versions
            USING (organization_id = current_setting('brain.organization_id', true))
            WITH CHECK (organization_id = current_setting('brain.organization_id', true))""")
        op.execute("""CREATE FUNCTION guard_scenario_versions() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'immutable scenario version'; END $$""")
        op.execute("""CREATE TRIGGER immutable_scenario_versions BEFORE UPDATE OR DELETE ON scenario_versions
            FOR EACH ROW EXECUTE FUNCTION guard_scenario_versions()""")
        op.execute("""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='brain_app') THEN
                GRANT SELECT,INSERT ON scenario_versions TO brain_app;
            END IF;
        END $$""")
    else:
        for operation in ("UPDATE", "DELETE"):
            op.execute(f"""CREATE TRIGGER immutable_scenario_{operation.lower()}
                BEFORE {operation} ON scenario_versions
                BEGIN SELECT RAISE(ABORT, 'immutable scenario version'); END""")


def downgrade() -> None:
    op.drop_table("scenario_versions")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION guard_scenario_versions()")
