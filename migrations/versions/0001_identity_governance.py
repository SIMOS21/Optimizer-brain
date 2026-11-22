"""Initial tenant entities, immutable artifacts and PostgreSQL tenant policies.

Revision ID: 0001_4a
Revises:
"""

from alembic import op
import sqlalchemy as sa

revision = "0001_4a"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("username", sa.String(128), nullable=False, unique=True),
        sa.Column("display_name", sa.String(500), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("key", sa.String(100), nullable=False, unique=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "memberships",
        sa.Column(
            "organization_id", sa.String(36), sa.ForeignKey("organizations.id"), primary_key=True
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "role IN ('ADMIN','BUILDER','APPROVER','VIEWER')", name="membership_role"
        ),
    )
    op.create_table(
        "departments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False
        ),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("owner_user_id", sa.String(36)),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.UniqueConstraint("organization_id", "key"),
        sa.UniqueConstraint("organization_id", "id"),
        sa.ForeignKeyConstraint(
            ["organization_id", "owner_user_id"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )
    for table in ("graph_snapshots", "model_versions"):
        columns = [
            sa.Column("id", sa.String(36), primary_key=True),
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
            sa.Column("published_by", sa.String(36)),
            sa.Column("published_at", sa.BigInteger()),
        ]
        constraints = [
            sa.UniqueConstraint("organization_id", "key", "version"),
            sa.UniqueConstraint("organization_id", "id"),
            sa.CheckConstraint(
                "(state='DRAFT' AND published_by IS NULL AND published_at IS NULL) OR (state='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL)",
                name="graph_publication" if table == "graph_snapshots" else "model_publication",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id", "created_by"],
                ["memberships.organization_id", "memberships.user_id"],
            ),
            sa.ForeignKeyConstraint(
                ["organization_id", "published_by"],
                ["memberships.organization_id", "memberships.user_id"],
            ),
        ]
        if table == "model_versions":
            columns.extend(
                [
                    sa.Column("graph_snapshot_id", sa.String(36), nullable=False),
                    sa.Column("model_hash", sa.String(64), nullable=False),
                    sa.Column("data_snapshot_id", sa.String(500), nullable=False),
                ]
            )
            constraints.append(
                sa.ForeignKeyConstraint(
                    ["organization_id", "graph_snapshot_id"],
                    ["graph_snapshots.organization_id", "graph_snapshots.id"],
                )
            )
        op.create_table(table, *columns, *constraints)
    op.create_table(
        "optimization_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False
        ),
        sa.Column("model_version_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(64), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id", "model_version_id"],
            ["model_versions.organization_id", "model_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_table(
        "login_throttles",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("window_until", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False
        ),
        sa.Column("actor_id", sa.String(36), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_id", sa.String(100), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    for table in (
        "departments",
        "graph_snapshots",
        "model_versions",
        "optimization_runs",
        "audit_events",
    ):
        op.create_index("ix_" + table + "_organization_id", table, ["organization_id"])
    dialect = op.get_bind().dialect.name
    for table in ("graph_snapshots", "model_versions"):
        frozen = [
            "id",
            "organization_id",
            "key",
            "version",
            "payload",
            "content_hash",
            "created_by",
            "created_at",
        ]
        if table == "model_versions":
            frozen += ["graph_snapshot_id", "model_hash", "data_snapshot_id"]
        if dialect == "postgresql":
            condition = " OR ".join(f"OLD.{field} IS DISTINCT FROM NEW.{field}" for field in frozen)
            op.execute(
                f"CREATE FUNCTION guard_{table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable artifact'; END IF; IF OLD.state <> 'DRAFT' OR NEW.state <> 'PUBLISHED' OR {condition} THEN RAISE EXCEPTION 'immutable artifact'; END IF; RETURN NEW; END $$"
            )
            op.execute(
                f"CREATE TRIGGER immutable_{table} BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION guard_{table}()"
            )
        else:
            condition = " OR ".join(f"OLD.{field} IS NOT NEW.{field}" for field in frozen)
            op.execute(
                f"CREATE TRIGGER immutable_update_{table} BEFORE UPDATE ON {table} WHEN OLD.state <> 'DRAFT' OR NEW.state <> 'PUBLISHED' OR {condition} BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END"
            )
            op.execute(
                f"CREATE TRIGGER immutable_delete_{table} BEFORE DELETE ON {table} BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END"
            )
    for table in ("optimization_runs", "audit_events"):
        if dialect == "postgresql":
            op.execute(
                f"CREATE FUNCTION guard_{table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append only record'; END $$"
            )
            op.execute(
                f"CREATE TRIGGER immutable_{table} BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION guard_{table}()"
            )
        else:
            for action in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER immutable_{action.lower()}_{table} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT, 'append only record'); END"
                )
    if dialect == "postgresql":
        for table in (
            "departments",
            "graph_snapshots",
            "model_versions",
            "optimization_runs",
            "audit_events",
        ):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"CREATE POLICY tenant_scope ON {table} USING (organization_id = current_setting('brain.organization_id', true)) WITH CHECK (organization_id = current_setting('brain.organization_id', true))"
            )


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    for table in (
        "audit_events",
        "login_throttles",
        "auth_sessions",
        "optimization_runs",
        "model_versions",
        "graph_snapshots",
        "departments",
        "memberships",
        "organizations",
        "users",
    ):
        op.drop_table(table)
    if dialect == "postgresql":
        for table in ("graph_snapshots", "model_versions", "optimization_runs", "audit_events"):
            op.execute(f"DROP FUNCTION guard_{table}()")
