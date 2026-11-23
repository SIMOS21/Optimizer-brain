"""4B enriches OpenAPI, retaining the canonical Phase 4A payloads."""

import json
import http.client
from pathlib import Path

from brain.organization.composition import canonical_json
from brain.organization import compose_organization_model
from brain.platform.api import create_app
from brain.platform.database import Settings
from tests.conftest_platform import platform_fixture, postgres_urls_fixture  # noqa: F401


def test_exported_contract_matches_secure_application(monkeypatch):
    app = create_app(Settings("sqlite://", allow_sqlite_for_tests=True))
    path = Path(__file__).resolve().parents[1] / "frontend/src/api/openapi.json"
    assert json.loads(path.read_text(encoding="utf-8")) == app.openapi()
    assert "/optimize" not in app.openapi()["paths"]
    assert (
        "post"
        not in app.openapi()["paths"]["/api/v1/organizations/{organization_id}/optimization-runs"]
    )
    # Python 3.11 calls 422 "Unprocessable Entity", while newer Python calls it
    # "Unprocessable Content". Our generated contract must not inherit either
    # interpreter's phrase through FastAPI's additional-response defaults.
    for status in (403, 409, 422):
        monkeypatch.setitem(http.client.responses, status, "Interpreter-specific phrase")
    app.openapi_schema = None
    assert json.loads(path.read_text(encoding="utf-8")) == app.openapi()
    app.state.engine.dispose()


def test_typed_documents_preserve_composer_and_graph_payloads(platform):
    p = platform
    identity = p.model()
    record = p.request("GET", p.base + f"/model-versions/{identity}").json()
    expected = json.loads(canonical_json(compose_organization_model(p.source).to_dict()))
    assert record["document"] == expected
    graph = p.request("GET", p.base + f"/graphs/{record['graph_snapshot_id']}").json()
    assert graph["document"] == {
        "graph": expected["organization_model"]["graph"],
        "shared_parameters": expected["organization_model"]["shared_parameters"],
    }


def test_typed_graph_response_preserves_precise_decimal_strings(platform):
    p = platform
    body = p.graph_body()
    key = next(iter(body["shared_parameters"]))
    decimal = "8000.00000000000000000001"
    body["shared_parameters"][key]["value"] = decimal
    response = p.request("POST", p.base + "/graphs", json=body)
    assert response.status_code == 201
    assert response.json()["document"]["shared_parameters"][key]["value"] == decimal


def test_graph_node_and_edge_identifiers_have_distinct_namespaces(platform):
    p = platform
    body = p.graph_body()
    identity = body["graph"]["departments"][0]["id"]
    body["graph"]["edges"][0]["id"] = identity
    response = p.request("POST", p.base + "/graphs", json=body)
    assert response.status_code == 201
    assert identity in {edge["id"] for edge in response.json()["document"]["graph"]["edges"]}
