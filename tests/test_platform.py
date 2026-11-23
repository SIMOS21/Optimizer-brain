"""Phase 4A contracts run on SQLite AND opt-in real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
import pytest
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.exc import DBAPIError

from brain.organization.runtime import solve_organization
from brain.platform import auth, service
from brain.platform.api import create_app
from brain.platform.database import Settings, sessions, set_tenant
from brain.platform.models import AuthSession, Base, GraphSnapshot, Membership, User
from tests.conftest_platform import PASSWORD, migrate, platform_fixture, postgres_urls_fixture  # noqa: F401


def test_auth_required_and_separate_legacy_app(platform):
    p = platform
    for path in ("/api/v1/auth/me", "/api/v1/organizations", p.base + "/graphs"):
        assert p.client.get(path).status_code == 401
        assert p.client.get(path, headers={"Authorization": "Bearer fake"}).status_code == 401
    assert p.client.get("/health").json()["llm_required"] is False
    assert p.client.post("/optimize").status_code == 404
    assert p.client.post("/api/v1/models/solve").status_code == 404
    assert p.request("GET", "/api/v1/auth/me").json()["id"] == p.users["admin"]


def test_password_hash_token_expiry_and_revocation(platform):
    p = platform
    token = p.headers["admin"]["Authorization"].split()[1]
    with sessions(p.admin_engine).begin() as session:
        user = session.get(User, p.users["admin"])
        assert user.password_hash.startswith("$argon2id$") and PASSWORD not in user.password_hash
        stored = session.get(AuthSession, auth.token_digest(token))
        assert stored.token_hash != token
        stored.expires_at = 1
    assert p.request("GET", "/api/v1/auth/me").status_code == 401
    assert p.request("POST", "/api/v1/auth/logout", role="viewer").status_code == 204
    assert p.request("GET", "/api/v1/auth/me", role="viewer").status_code == 401
    with sessions(p.admin_engine).begin() as session:
        session.get(User, p.users["builder"]).active = False
    assert p.request("GET", "/api/v1/auth/me", role="builder").status_code == 401


def test_login_failures_throttling_and_secret_redaction(platform):
    p = platform
    url = "/api/v1/auth/login"
    for _ in range(5):
        response = p.client.post(url, json={"username": "test_viewer", "password": "wrong"})
        assert response.status_code == 401
    response = p.client.post(url, json={"username": "test_viewer", "password": PASSWORD})
    assert response.status_code == 401
    assert (
        p.client.post(url, json={"username": "unknown", "password": "wrong"}).json()
        == response.json()
    )
    assert (
        p.client.post(url, json={"username": "bad unicode é", "password": PASSWORD}).json()
        == response.json()
    )
    bad = p.client.post(url, json={"username": "test_admin", "password": PASSWORD, "admin": True})
    assert bad.status_code == 422 and PASSWORD not in bad.text
    with sessions(p.admin_engine).begin() as session:
        session.execute(text("UPDATE login_throttles SET window_until=1"))
    assert (
        p.client.post(url, json={"username": "test_viewer", "password": PASSWORD}).status_code
        == 200
    )


def test_tenant_isolation_and_membership_revocation(platform):
    p = platform
    graph = p.graph(publish=True)
    other = p.request(
        "POST", "/api/v1/organizations", role="outsider", json={"key": "other", "name": "Other"}
    ).json()["id"]
    assert len(p.request("GET", "/api/v1/organizations").json()["items"]) == 1
    for path in (
        p.base,
        p.base + "/departments",
        p.base + f"/graphs/{graph}",
        p.base + "/audit-events",
    ):
        assert p.request("GET", path, role="outsider").status_code == 404
    assert (
        p.request(
            "GET", f"/api/v1/organizations/{other}/graphs/{graph}", role="outsider"
        ).status_code
        == 404
    )
    assert (
        p.request(
            "PUT",
            p.base + "/memberships",
            role="builder",
            json={"user_id": p.users["builder"], "role": "ADMIN"},
        ).status_code
        == 403
    )
    assert (
        p.request(
            "PUT",
            p.base + "/memberships",
            json={"user_id": p.users["viewer"], "role": "VIEWER", "active": False},
        ).status_code
        == 200
    )
    assert p.request("GET", p.base, role="viewer").status_code == 404
    assert p.request("GET", "/api/v1/organizations", role="viewer").json()["items"] == []
    # Role changes apply to the existing session, not only at the next login.
    p.request(
        "PUT", p.base + "/memberships", json={"user_id": p.users["builder"], "role": "VIEWER"}
    )
    assert (
        p.request("POST", p.base + "/graphs", role="builder", json=p.graph_body()).status_code
        == 403
    )


@pytest.mark.parametrize("role", ["builder", "approver", "viewer"])
def test_department_and_membership_admin_only(platform, role):
    p = platform
    assert (
        p.request(
            "POST", p.base + "/departments", role=role, json={"key": "new", "name": "New"}
        ).status_code
        == 403
    )
    assert p.request("GET", p.base + "/departments", role=role).status_code == 200
    assert (
        p.request(
            "PUT",
            p.base + "/memberships",
            role=role,
            json={"user_id": p.users["outsider"], "role": "VIEWER"},
        ).status_code
        == 403
    )


def test_last_admin_and_department_owner(platform):
    p = platform
    for change in ({"role": "VIEWER"}, {"role": "ADMIN", "active": False}):
        assert (
            p.request(
                "PUT", p.base + "/memberships", json={"user_id": p.users["admin"], **change}
            ).status_code
            == 409
        )
    assert (
        p.request(
            "POST",
            p.base + "/departments",
            json={"key": "new", "name": "New", "owner_user_id": p.users["outsider"]},
        ).status_code
        == 422
    )
    assert (
        p.request(
            "POST",
            p.base + "/departments",
            json={"key": "new", "name": "New", "organization_id": "other"},
        ).status_code
        == 422
    )


def test_explicit_publication_version_conflicts_and_audit(platform):
    p = platform
    graph = p.graph()
    assert p.request("POST", p.base + f"/graphs/{graph}/publish", role="builder").status_code == 403
    assert p.request("POST", p.base + f"/graphs/{graph}/publish", role="viewer").status_code == 403
    assert (
        p.request(
            "POST", p.base + "/model-versions", json={"graph_snapshot_id": graph, "model": p.source}
        ).status_code
        == 409
    )
    published = p.request("POST", p.base + f"/graphs/{graph}/publish", role="approver")
    assert published.status_code == 200 and published.json()["published_by"] == p.users["approver"]
    assert (
        p.request("POST", p.base + f"/graphs/{graph}/publish", role="approver").json()
        == published.json()
    )
    assert p.graph() == graph
    changed = deepcopy(p.graph_body())
    changed["graph"]["organization"]["name"] = "Changed"
    assert p.request("POST", p.base + "/graphs", json=changed).status_code == 409
    assert p.request("GET", p.base + f"/graphs/{graph}").json() == published.json()
    audit = p.request("GET", p.base + "/audit-events", role="approver").json()["items"]
    assert sum(e["action"] == "graph.published" for e in audit) == 1
    assert p.request("GET", p.base + "/audit-events", role="builder").status_code == 403


def test_graph_validation_and_model_binding(platform):
    p = platform
    graph = p.graph(publish=True)
    body = p.graph_body()
    for field, value in (("id", "other"), ("approved", False)):
        bad = deepcopy(body)
        bad["graph"]["organization"][field] = value
        assert p.request("POST", p.base + "/graphs", json=bad).status_code == 422
    bad_model = deepcopy(p.source)
    bad_model["graph"]["organization"]["name"] = "Unapproved modification"
    assert (
        p.request(
            "POST",
            p.base + "/model-versions",
            json={"graph_snapshot_id": graph, "model": bad_model},
        ).status_code
        == 409
    )
    assert (
        p.request(
            "POST",
            p.base + "/model-versions",
            json={"graph_snapshot_id": "unknown", "model": p.source},
        ).status_code
        == 404
    )


@pytest.mark.parametrize("table", ["graph_snapshots", "model_versions"])
@pytest.mark.parametrize("published", [False, True])
def test_database_artifact_immutability(platform, table, published):
    p = platform
    identity = (
        p.graph(publish=published) if table == "graph_snapshots" else p.model(publish=published)
    )
    for operation in (
        f"UPDATE {table} SET payload='corrupt' WHERE id=:id",
        f"DELETE FROM {table} WHERE id=:id",
    ):
        # Even the migration role is subject to append-only triggers for ordinary DML.
        with pytest.raises(DBAPIError), p.admin_engine.begin() as connection:
            connection.execute(text(operation), {"id": identity})
    collection = "graphs" if table == "graph_snapshots" else "model-versions"
    assert p.request("GET", p.base + f"/{collection}/{identity}").status_code == 200


def test_verified_run_history_and_corruption_rejection(platform):
    p = platform
    model = p.model()
    solved = solve_organization(p.source).solve
    assert solved.objective_value == 4100 and dict(solved.decision_values) == {
        "qty_A": 40,
        "qty_B": 15,
    }
    with p.app.state.session_factory.begin() as session:
        user = session.get(User, p.users["builder"])
        stored = service.record_run(session, user, p.organization_id, model, solved)
        assert service.record_run(session, user, p.organization_id, model, solved).id == stored.id
    response = p.request("GET", p.base + f"/optimization-runs/{solved.run_id}", role="viewer")
    assert response.status_code == 200, response.text
    assert response.json()["document"]["report"]["has_verified_plan"] is True
    with pytest.raises(ValueError), p.app.state.session_factory.begin() as session:
        service.record_run(
            session,
            session.get(User, p.users["builder"]),
            p.organization_id,
            model,
            replace(solved, decision_values=(("qty_A", 999.0), ("qty_B", 15.0))),
        )
    assert p.request("POST", p.base + "/optimization-runs", json={}).status_code == 405
    for table in ("optimization_runs", "audit_events"):
        for operation in (f"UPDATE {table} SET created_at=0", f"DELETE FROM {table}"):
            with pytest.raises(DBAPIError), p.admin_engine.begin() as connection:
                connection.execute(text(operation))
    assert (
        p.request("GET", p.base + f"/optimization-runs/{solved.run_id}").json() == response.json()
    )


def test_openapi_strict_json_and_pagination(platform):
    p = platform
    spec = p.client.get("/openapi.json").json()
    assert "OrganizationResponse" in spec["components"]["schemas"]
    assert "ArtifactResponse" in spec["components"]["schemas"]
    assert spec["paths"][p.base.replace(p.organization_id, "{organization_id}") + "/graphs"]["get"][
        "security"
    ]
    for raw in ('{"key":"one","key":"two","name":"X"}', '{"key":"one","name":NaN}'):
        assert p.request("POST", "/api/v1/organizations", content=raw).status_code == 422
    assert p.request("GET", p.base + "/graphs?limit=101").status_code == 422
    assert p.request("GET", p.base + "/graphs?offset=-1").status_code == 422
    assert p.request("GET", p.base).headers["cache-control"] == "no-store"


def test_migrations_match_entities_and_roundtrip(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'migrations.sqlite3'}")
    migrate(engine)
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0005_5b"
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    migrate(engine, "base", downgrade=True)
    assert inspect(engine).get_table_names() == ["alembic_version"]
    migrate(engine)
    assert set(Base.metadata.tables).issubset(inspect(engine).get_table_names())
    engine.dispose()


def test_fail_closed_configuration(monkeypatch):
    monkeypatch.delenv("BRAIN_DATABASE_URL", raising=False)
    with pytest.raises(ValueError):
        Settings.from_env()
    with pytest.raises(ValueError):
        create_app(Settings("sqlite://"))
    with pytest.raises(ValueError):
        Settings("postgresql+psycopg://unused", session_seconds=0)
    assert "secret" not in repr(Settings("postgresql+psycopg://u:secret@localhost/db"))


def test_provisioning_disable_last_admin_and_password_validation(platform):
    p = platform
    with pytest.raises(ValueError), sessions(p.admin_engine).begin() as session:
        auth.disable_user(session, session.get(User, p.users["admin"]))
    with pytest.raises(ValueError), sessions(p.admin_engine).begin() as session:
        auth.create_user(session, "new_user", "short", "New")
    with sessions(p.admin_engine).begin() as session:
        auth.disable_user(session, session.get(User, p.users["viewer"]))
    assert p.request("GET", "/api/v1/auth/me", role="viewer").status_code == 401


def test_historical_model_runs_cannot_be_read_from_another_organization(platform):
    p = platform
    model = p.model()
    solved = solve_organization(p.source).solve
    with p.app.state.session_factory.begin() as session:
        service.record_run(
            session, session.get(User, p.users["builder"]), p.organization_id, model, solved
        )
    other = p.request(
        "POST", "/api/v1/organizations", role="outsider", json={"key": "other", "name": "Other"}
    ).json()["id"]
    base = f"/api/v1/organizations/{other}"
    for collection, identity in (("model-versions", model), ("optimization-runs", solved.run_id)):
        assert (
            p.request("GET", base + f"/{collection}/{identity}", role="outsider").status_code == 404
        )
        assert p.request("GET", base + f"/{collection}", role="outsider").json()["items"] == []
    # A model is bound to its published snapshot, not to a mutable live graph.
    changed = deepcopy(p.graph_body())
    changed["graph"]["organization"]["version"] = "next"
    changed["graph"]["organization"]["name"] = "Next graph"
    assert p.request("POST", p.base + "/graphs", json=changed).status_code == 201
    old = p.request("GET", p.base + f"/model-versions/{model}").json()
    assert old["state"] == "PUBLISHED"
    assert old["document"]["organization_model"]["graph"]["organization"]["name"] != "Next graph"


@pytest.mark.parametrize("platform", ["postgresql"], indirect=True)
def test_postgres_concurrent_version_conflict_is_atomic(platform):
    p = platform
    bodies = [deepcopy(p.graph_body()), deepcopy(p.graph_body())]
    bodies[1]["graph"]["organization"]["name"] = "Conflicting version"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda body: p.request("POST", p.base + "/graphs", role="builder", json=body),
                bodies,
            )
        )
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert len(p.request("GET", p.base + "/graphs").json()["items"]) == 1
    events = p.request("GET", p.base + "/audit-events").json()["items"]
    assert sum(e["action"] == "graph.created" for e in events) == 1


@pytest.mark.parametrize("platform", ["postgresql"], indirect=True)
def test_postgres_rls_foreign_keys_and_privileges(postgres_urls, platform):
    p = platform
    graph = p.graph(publish=True)
    runtime = p.app.state.engine
    with runtime.begin() as connection:
        assert connection.scalar(text("SELECT count(*) FROM graph_snapshots")) == 0
    with p.app.state.session_factory.begin() as session:
        set_tenant(session, p.organization_id)
        assert session.get(GraphSnapshot, graph) is not None
    with runtime.begin() as connection:
        assert (
            connection.scalar(text("SELECT count(*) FROM graph_snapshots")) == 0
        )  # No pool leakage.
    with pytest.raises(DBAPIError), runtime.begin() as connection:
        connection.execute(text("TRUNCATE graph_snapshots CASCADE"))
    with pytest.raises(DBAPIError), runtime.begin() as connection:
        connection.execute(text("UPDATE alembic_version SET version_num='fake'"))
    with pytest.raises(ValueError):
        create_app(Settings(postgres_urls[0]))
    with p.admin_engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    # A creator must belong to the same organization as the new graph.
    with pytest.raises(DBAPIError), p.admin_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO graph_snapshots (id,organization_id,key,version,state,payload,content_hash,created_by,created_at) SELECT '11111111-1111-4111-8111-111111111111',organization_id,key,'invalid','DRAFT',payload,content_hash,:user,created_at FROM graph_snapshots WHERE id=:id"
            ),
            {"user": p.users["outsider"], "id": graph},
        )
    with pytest.raises(DBAPIError), runtime.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO audit_events (id,organization_id,actor_id,action,target_id,created_at) VALUES ('forbidden',:org,:user,'invalid','invalid',0)"
            ),
            {"org": p.organization_id, "user": p.users["admin"]},
        )


@pytest.mark.parametrize("platform", ["postgresql"], indirect=True)
def test_postgres_concurrent_publication_and_last_admin(platform):
    p = platform
    graph = p.graph()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: p.request("POST", p.base + f"/graphs/{graph}/publish", role="approver"),
                range(2),
            )
        )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    events = p.request("GET", p.base + "/audit-events").json()["items"]
    assert sum(e["action"] == "graph.published" for e in events) == 1
    p.request("PUT", p.base + "/memberships", json={"user_id": p.users["builder"], "role": "ADMIN"})

    def demote(role):
        return p.request(
            "PUT",
            p.base + "/memberships",
            role=role,
            json={"user_id": p.users[role], "role": "VIEWER"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(demote, ("admin", "builder")))
    assert sorted(r.status_code for r in responses) == [200, 409]
    with sessions(p.admin_engine).begin() as session:
        assert (
            len(
                session.scalars(
                    select(Membership).where(
                        Membership.organization_id == p.organization_id,
                        Membership.role == "ADMIN",
                        Membership.active.is_(True),
                    )
                ).all()
            )
            == 1
        )
