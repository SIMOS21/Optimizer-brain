"""Use an explicit connection (tests) or an explicit migration-only database URL."""

from logging.config import fileConfig
import os
from alembic import context
from sqlalchemy import Connection, create_engine

from brain.platform.models import Base

config = context.config
if config.config_file_name and config.file_config.has_section("loggers"):
    fileConfig(config.config_file_name)


def migrate(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise RuntimeError(
        "Migrations online requises pour installer les protections selon le dialecte"
    )
elif config.attributes.get("connection") is not None:
    migrate(config.attributes["connection"])
else:
    url = os.environ.get("BRAIN_MIGRATION_DATABASE_URL")
    if not url:
        raise RuntimeError("BRAIN_MIGRATION_DATABASE_URL requis")
    engine = create_engine(url, hide_parameters=True)
    with engine.connect() as connection:
        migrate(connection)
    engine.dispose()
