"""Explicit PostgreSQL configuration; SQLite is an opt-in test backend only."""

from dataclasses import dataclass, field
import os

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

SCHEMA_REVISION = "0005_5b"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    allow_sqlite_for_tests: bool = False
    session_seconds: int = 28800

    def __post_init__(self) -> None:
        if not 1 <= self.session_seconds <= 86400:
            raise ValueError("Durée de session attendue entre 1 et 86400 secondes")

    @classmethod
    def from_env(cls) -> "Settings":
        value = os.environ.get("BRAIN_DATABASE_URL")
        if not value:
            raise ValueError("BRAIN_DATABASE_URL requis ; aucune base implicite")
        return cls(value)


def make_engine(settings: Settings) -> Engine:
    if not settings.database_url.startswith("postgresql+psycopg://"):
        if not (settings.allow_sqlite_for_tests and settings.database_url.startswith("sqlite://")):
            raise ValueError("PostgreSQL/psycopg requis hors tests")
    engine = create_engine(settings.database_url, pool_pre_ping=True, hide_parameters=True)
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def _foreign_keys(connection: object, record: object) -> None:
            from typing import Any, cast

            cast(Any, connection).execute("PRAGMA foreign_keys=ON")

    return engine


def sessions(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)


def set_tenant(session: Session, organization_id: str) -> None:
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        session.execute(
            text("SELECT set_config('brain.organization_id', :organization_id, true)"),
            {"organization_id": organization_id},
        )


def database_now(session: Session) -> int:
    if session.bind is None:
        raise RuntimeError("La session doit être liée à une base")
    if session.bind.dialect.name == "postgresql":
        value = session.scalar(text("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint"))
    elif session.bind.dialect.name == "sqlite":
        value = session.scalar(text("SELECT CAST(strftime('%s','now') AS INTEGER)"))
    else:
        raise RuntimeError("Horloge de base non prise en charge")
    if value is None:
        raise RuntimeError("Horloge de base indisponible")
    return int(value)
