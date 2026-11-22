"""Opt-in integration database. Never reset the development database."""

from dataclasses import dataclass
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from brain.organization.project import load_organization_file
from brain.platform import auth
from brain.platform.api import create_app
from brain.platform.database import Settings, sessions

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "synthetic-password-4A"


def migrate(engine, revision="head", *, downgrade=False):
    config = Config(str(ROOT / "alembic.ini"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        (command.downgrade if downgrade else command.upgrade)(config, revision)


@pytest.fixture(scope="session", name="postgres_urls")
def postgres_urls_fixture():
    admin = os.environ.get("BRAIN_TEST_MIGRATION_DATABASE_URL")
    runtime = os.environ.get("BRAIN_TEST_DATABASE_URL")
    if not admin or not runtime:
        pytest.skip("PostgreSQL integration URLs not configured")
    for url in (admin, runtime):
        if make_url(url).database != "optimizer_brain_test":
            pytest.fail("Refusing to reset any database except optimizer_brain_test")
    bootstrap = create_engine(
        make_url(admin).set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    with bootstrap.connect() as connection:
        if not connection.scalar(
            text("SELECT 1 FROM pg_database WHERE datname='optimizer_brain_test'")
        ):
            connection.execute(text("CREATE DATABASE optimizer_brain_test"))
        if not connection.scalar(text("SELECT 1 FROM pg_roles WHERE rolname='brain_app'")):
            from psycopg import sql

            # CI bootstrap only. Existing local role/password is never changed.
            statement = sql.SQL("CREATE ROLE brain_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD {}")
            statement = statement.format(sql.Literal(make_url(runtime).password))
            connection.connection.driver_connection.execute(statement)
    bootstrap.dispose()
    engine = create_engine(admin)
    migrate(engine)
    # A real upgrade/downgrade/upgrade on this dedicated, disposable database.
    migrate(engine, "base", downgrade=True)
    migrate(engine)
    engine.dispose()
    return admin, runtime


@dataclass
class Platform:
    app: object
    client: TestClient
    admin_engine: object
    users: dict
    headers: dict
    organization_id: str
    source: dict

    @property
    def base(self):
        return f"/api/v1/organizations/{self.organization_id}"

    def request(self, method, path, *, role="admin", **kwargs):
        return self.client.request(method, path, headers=self.headers[role], **kwargs)

    def graph_body(self):
        return {
            "graph": self.source["graph"],
            "shared_parameters": self.source["shared_parameters"],
        }

    def graph(self, *, publish=False):
        response = self.request(
            "POST", self.base + "/graphs", role="builder", json=self.graph_body()
        )
        assert response.status_code == 201, response.text
        identity = response.json()["id"]
        if publish:
            response = self.request(
                "POST", self.base + f"/graphs/{identity}/publish", role="approver"
            )
            assert response.status_code == 200, response.text
        return identity

    def model(self, *, publish=True):
        graph = self.graph(publish=True)
        response = self.request(
            "POST",
            self.base + "/model-versions",
            role="builder",
            json={
                "graph_snapshot_id": graph,
                "model": self.source,
            },
        )
        assert response.status_code == 201, response.text
        identity = response.json()["id"]
        if publish:
            response = self.request(
                "POST", self.base + f"/model-versions/{identity}/publish", role="approver"
            )
            assert response.status_code == 200, response.text
        return identity


@pytest.fixture(params=["sqlite", "postgresql"], name="platform")
def platform_fixture(request, tmp_path):
    if request.param == "postgresql":
        admin_url, runtime_url = request.getfixturevalue("postgres_urls")
        admin_engine = create_engine(admin_url)
        with admin_engine.begin() as connection:
            assert connection.scalar(text("SELECT current_database()")) == "optimizer_brain_test"
            connection.execute(
                text(
                    "TRUNCATE audit_events,optimization_jobs,optimization_runs,model_versions,graph_snapshots,departments,auth_sessions,login_throttles,memberships,organizations,users CASCADE"
                )
            )
        settings = Settings(runtime_url)
    else:
        settings = Settings(
            f"sqlite:///{tmp_path / 'governance.sqlite3'}", allow_sqlite_for_tests=True
        )
        admin_engine = create_engine(settings.database_url)
        migrate(admin_engine)
    app = create_app(settings)
    users = {}
    with sessions(admin_engine).begin() as session:
        for role in ("admin", "builder", "approver", "viewer", "outsider"):
            user = auth.create_user(session, f"test_{role}", PASSWORD, role)
            users[role] = user.id
    client = TestClient(app)
    headers = {}
    for role in users:
        response = client.post(
            "/api/v1/auth/login", json={"username": f"test_{role}", "password": PASSWORD}
        )
        assert response.status_code == 200, response.text
        headers[role] = {"Authorization": "Bearer " + response.json()["access_token"]}
    source = load_organization_file(
        ROOT / "examples/organizations/factory/project.json"
    ).model_dump(mode="json")
    response = client.post(
        "/api/v1/organizations",
        headers=headers["admin"],
        json={
            "key": source["graph"]["organization"]["id"],
            "name": "Synthetic organization",
        },
    )
    assert response.status_code == 201, response.text
    fixture = Platform(app, client, admin_engine, users, headers, response.json()["id"], source)
    for role in ("builder", "approver", "viewer"):
        response = fixture.request(
            "PUT",
            fixture.base + "/memberships",
            json={
                "user_id": users[role],
                "role": role.upper(),
            },
        )
        assert response.status_code == 200, response.text
    for department in source["graph"]["departments"]:
        response = fixture.request(
            "POST",
            fixture.base + "/departments",
            json={
                "key": department["id"],
                "name": department["name"],
                "owner_user_id": users["builder"],
            },
        )
        assert response.status_code == 201, response.text
    yield fixture
    client.close()
    app.state.engine.dispose()
    admin_engine.dispose()
