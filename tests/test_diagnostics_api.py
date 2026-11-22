"""Identical diagnostic contracts on SQLite and real PostgreSQL/RLS."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

from sqlalchemy import event

from brain.organization.runtime import solve_organization
from brain.platform import service
from brain.platform.models import User
from tests.conftest_platform import platform_fixture, postgres_urls_fixture  # noqa: F401


def stored_run(p, model_id):
    solved = solve_organization(p.source).solve
    with p.app.state.session_factory.begin() as session:
        service.record_run(
            session, session.get(User, p.users["builder"]), p.organization_id, model_id, solved
        )
    return solved.run_id


def test_diagnostics_read_permissions_and_immutable_history(platform):
    p = platform
    model_id = p.model()
    run_id = stored_run(p, model_id)
    paths = [p.base + f"/model-versions/{model_id}", p.base + f"/optimization-runs/{run_id}"]
    before = [p.request("GET", path).json() for path in paths]
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.strip().split()[0].upper())

    event.listen(p.app.state.engine, "before_cursor_execute", capture)
    try:
        for role in ("admin", "builder", "approver", "viewer"):
            for index, path in enumerate(paths):
                response = p.request("GET", path + "/diagnostics", role=role)
                assert response.status_code == 200, response.text
                assert response.headers["cache-control"] == "no-store"
                body = response.json()
                assert body["content_hash"] == before[index]["content_hash"]
                assert body["model_version_id"] == model_id
                report = body["report"]
                assert report["static_conclusion"] == "NO_CONCLUSION"
                assert report["plan_valid"] is (True if index else None)
                assert report["model_hash"] == before[0]["model_hash"]
                assert (
                    report["composition_manifest_hash"]
                    == before[0]["document"]["composition_manifest_hash"]
                )
                assert all(a["cost_status"] == "NOT_EVALUATED" for a in report["activities"])
                if index:
                    assert {a["state"] for a in report["activities"]} == {"SATISFIED", "SATURATED"}
        assert not {"INSERT", "UPDATE", "DELETE"} & set(statements)
    finally:
        event.remove(p.app.state.engine, "before_cursor_execute", capture)
    assert [p.request("GET", path).json() for path in paths] == before
    assert before[1]["document"]["solve"]["objective_value"] == "4100"


def test_diagnostics_tenant_isolation_and_revocation(platform):
    p = platform
    model_id = p.model()
    run_id = stored_run(p, model_id)
    other = p.request(
        "POST", "/api/v1/organizations", role="outsider", json={"key": "other", "name": "Other"}
    ).json()["id"]
    for kind, identity in (("model-versions", model_id), ("optimization-runs", run_id)):
        path = p.base + f"/{kind}/{identity}/diagnostics"
        assert p.client.get(path).status_code == 401
        assert p.request("GET", path, role="outsider").status_code == 404
        assert (
            p.request(
                "GET",
                f"/api/v1/organizations/{other}/{kind}/{identity}/diagnostics",
                role="outsider",
            ).status_code
            == 404
        )
        assert p.request("GET", p.base + f"/{kind}/missing/diagnostics").status_code == 404
        assert p.request("POST", path, json={"relax": True}).status_code == 405
    p.request(
        "PUT",
        p.base + "/memberships",
        json={"user_id": p.users["viewer"], "role": "VIEWER", "active": False},
    )
    assert (
        p.request(
            "GET", p.base + f"/model-versions/{model_id}/diagnostics", role="viewer"
        ).status_code
        == 404
    )


def test_draft_static_diagnostics_no_solve_and_concurrent_reads(platform, monkeypatch):
    p = platform
    # Add the sales demand using existing fragment conventions and sharing rules.
    sales = next(f for f in p.source["fragments"] if f["department_id"] == "sales")
    sales["constraints"] = [
        {
            "id": "sales_demand",
            "owner_department": "sales",
            "kind": "HARD",
            "source": "synthetic_sales_approved",
            "approved": True,
            "version": "1",
            "terms": [
                {"variable": v, "coefficient": "1", "coefficient_unit": "1"}
                for v in ("qty_A", "qty_B")
            ],
            "operator": ">=",
            "rhs": "60",
            "unit": "unit",
        }
    ]
    identity = p.model(publish=False)
    path = p.base + f"/model-versions/{identity}/diagnostics"

    def forbidden(*args, **kwargs):
        raise AssertionError("No solve allowed on GET diagnostics")

    monkeypatch.setattr("scipy.optimize.milp", forbidden)
    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(lambda _: p.request("GET", path, role="viewer"), range(4)))
    assert all(r.status_code == 200 for r in responses)
    assert all(r.json() == responses[0].json() for r in responses)
    report = responses[0].json()["report"]
    assert report["static_conclusion"] == "CONTRADICTION_PROVEN"
    assert report["iis_available"] is False
    assert report["plan_checked"] is False
    assert {c["department"] for f in report["findings"] for c in f["constraints"]} == {
        "sales",
        "logistics",
    }


def test_incompatible_reconstruction_fails_closed(platform, monkeypatch):
    p = platform
    identity = p.model()
    from brain.platform import diagnostics

    original = diagnostics.compose_organization_model
    monkeypatch.setattr(
        diagnostics,
        "compose_organization_model",
        lambda source: replace(original(source), manifest_hash="incompatible"),
    )
    assert p.request("GET", p.base + f"/model-versions/{identity}/diagnostics").status_code == 409


def test_infeasible_run_does_not_invent_activity_or_iis(platform):
    p = platform
    # Valid input schema, mathematically impossible upper row by variable bounds.
    fragment = next(f for f in p.source["fragments"] if f["department_id"] == "sales")
    fragment["constraints"] = [
        {
            "id": "impossible",
            "owner_department": "sales",
            "kind": "HARD",
            "source": "synthetic_test",
            "approved": True,
            "version": "1",
            "terms": [],
            "operator": ">=",
            "rhs": "1",
            "unit": "1",
        }
    ]
    model_id = p.model()
    run_id = stored_run(p, model_id)
    report = p.request("GET", p.base + f"/optimization-runs/{run_id}/diagnostics").json()["report"]
    assert report["solver_status"] == "INFEASIBLE"
    assert report["infeasibility_evidence"] == "STATIC_PROOF"
    assert report["iis_available"] is False
    assert report["plan_valid"] is None
    assert all(a["state"] == "UNAVAILABLE" for a in report["activities"])
