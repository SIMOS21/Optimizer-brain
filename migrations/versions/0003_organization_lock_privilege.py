"""Allow organization row locks without granting broad organization updates.

Revision ID: 0003_4a
Revises: 0002_4a
"""

from alembic import op

revision = "0003_4a"
down_revision = "0002_4a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='brain_app') THEN
            GRANT UPDATE(id) ON organizations TO brain_app;
          END IF;
        END $$""")


def downgrade() -> None:
    # This narrow grant remains necessary for the 4A services at older revisions.
    pass
