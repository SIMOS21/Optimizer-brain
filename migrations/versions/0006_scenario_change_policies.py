"""Published numeric-change policies, owner acknowledgements and scenario lineage.

Revision ID: 0006_5b2
Revises: 0005_5b
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_5b2"
down_revision = "0005_5b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scenario_change_policies",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column(
            "organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False
        ),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("version", sa.String(500), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("published_by", sa.String(36), nullable=True),
        sa.Column("published_at", sa.BigInteger(), nullable=True),
        sa.Column("source_model_version_id", sa.String(36), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "id"),
        sa.UniqueConstraint("organization_id", "key", "version"),
        sa.CheckConstraint(
            "(state='DRAFT' AND published_by IS NULL AND published_at IS NULL) OR (state='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL)",
            name="policy_publication",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "published_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "source_model_version_id"],
            ["model_versions.organization_id", "model_versions.id"],
        ),
    )
    op.create_index(
        "ix_scenario_change_policies_organization_id",
        "scenario_change_policies",
        ["organization_id"],
    )
    op.create_table(
        "scenario_policy_approvals",
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("policy_version_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("policy_content_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("organization_id", "policy_version_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["organization_id", "policy_version_id"],
            ["scenario_change_policies.organization_id", "scenario_change_policies.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "user_id"], ["memberships.organization_id", "memberships.user_id"]
        ),
    )
    op.create_table(
        "scenario_change_links",
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("scenario_version_id", sa.String(36), nullable=False),
        sa.Column("policy_version_id", sa.String(36), nullable=False),
        sa.Column("parent_scenario_id", sa.String(36), nullable=True),
        sa.PrimaryKeyConstraint("organization_id", "scenario_version_id"),
        sa.CheckConstraint(
            "parent_scenario_id IS NULL OR parent_scenario_id <> scenario_version_id",
            name="scenario_parent_distinct",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "scenario_version_id"],
            ["scenario_versions.organization_id", "scenario_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "parent_scenario_id"],
            ["scenario_versions.organization_id", "scenario_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "policy_version_id"],
            ["scenario_change_policies.organization_id", "scenario_change_policies.id"],
        ),
    )
    postgres = op.get_bind().dialect.name == "postgresql"
    for table in ("scenario_change_policies", "scenario_policy_approvals", "scenario_change_links"):
        if postgres:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"CREATE POLICY tenant_scope ON {table} USING (organization_id = current_setting('brain.organization_id', true)) WITH CHECK (organization_id = current_setting('brain.organization_id', true))"
            )
        if table == "scenario_change_policies":
            frozen = (
                "id",
                "organization_id",
                "key",
                "version",
                "payload",
                "content_hash",
                "created_by",
                "created_at",
                "source_model_version_id",
            )
            if postgres:
                condition = " OR ".join(
                    f"OLD.{field} IS DISTINCT FROM NEW.{field}" for field in frozen
                )
                op.execute(
                    f"CREATE FUNCTION guard_{table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable policy'; END IF; IF OLD.state <> 'DRAFT' OR NEW.state <> 'PUBLISHED' OR {condition} THEN RAISE EXCEPTION 'immutable policy'; END IF; RETURN NEW; END $$"
                )
            else:
                condition = " OR ".join(f"OLD.{field} IS NOT NEW.{field}" for field in frozen)
                op.execute(
                    f"CREATE TRIGGER immutable_update_{table} BEFORE UPDATE ON {table} WHEN OLD.state <> 'DRAFT' OR NEW.state <> 'PUBLISHED' OR {condition} BEGIN SELECT RAISE(ABORT, 'immutable policy'); END"
                )
                op.execute(
                    f"CREATE TRIGGER immutable_delete_{table} BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT, 'immutable policy'); END"
                )
        elif postgres:
            op.execute(
                f"CREATE FUNCTION guard_{table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable policy evidence'; END $$"
            )
        else:
            for operation in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER immutable_{operation.lower()}_{table} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'immutable policy evidence'); END"
                )
        if postgres:
            op.execute(
                f"CREATE TRIGGER immutable_{table} BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION guard_{table}()"
            )
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='brain_app') THEN GRANT SELECT,INSERT ON {table} TO brain_app; END IF; END $$"
            )
    if postgres:
        op.execute(
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='brain_app') THEN GRANT UPDATE(state,published_by,published_at) ON scenario_change_policies TO brain_app; END IF; END $$"
        )


def downgrade() -> None:
    for table in ("scenario_change_links", "scenario_policy_approvals", "scenario_change_policies"):
        op.drop_table(table)
        if op.get_bind().dialect.name == "postgresql":
            op.execute(f"DROP FUNCTION guard_{table}()")
