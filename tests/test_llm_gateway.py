"""No live key: exact facts, closed model output and bounded NVIDIA transport."""

from dataclasses import replace
import io
import json
from pathlib import Path
import urllib.error

import pytest

from brain.llm_gateway.context import build_context, render_explanation
from brain.llm_gateway.contracts import ExplanationSelection
from brain.llm_gateway.provider import GatewayError, NvidiaProvider, NvidiaSettings
from brain.organization.project import load_organization_file
from brain.organization.runtime import solve_organization
from brain.scenario_comparison import compare_runs
from tests.test_scenario_comparison import comparison_input, altered, witness

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def real_run():
    return solve_organization(
        load_organization_file(ROOT / "examples/organizations/factory/project.json")
    )


def context(run, *, intent="DECISIONS", baseline=None):
    candidate = comparison_input(run)
    report = compare_runs("tenant", baseline or candidate, candidate)
    selection = ExplanationSelection(
        run_id=candidate.run_id,
        baseline_run_id=baseline.run_id if baseline else None,
        intent=intent,
    )
    return build_context(report, selection, NvidiaSettings())


def test_real_facts_are_deterministic_masked_and_never_solve_again(real_run, monkeypatch):
    def forbidden(*a, **kw):
        raise AssertionError("No solver or network in context construction")

    monkeypatch.setattr("scipy.optimize.milp", forbidden)
    monkeypatch.setattr("socket.create_connection", forbidden)
    preview = context(real_run)
    assert context(real_run) == preview
    assert "4100" in preview.outbound_json
    for private in (real_run.solve.run_id, "qty_A", "logistics", "tenant", "EUR"):
        assert private not in preview.outbound_json
    assert any("55/55" in f.text and "prix d’ombre" in f.text for f in preview.facts)
    response = render_explanation(preview, '{"schema_version":"7A.1","fact_ids":["f1"]}')
    assert response.references[0].verified_plan
    assert any("tolérances" in s for s in response.paragraphs)
    assert response.facts[1].values == ("4100",)


@pytest.mark.parametrize(
    "content",
    [
        '{"schema_version":"7A.1","fact_ids":["f999"]}',
        '{"schema_version":"7A.1","fact_ids":["f1"],"objective":999999}',
        '{"schema_version":"7A.1","fact_ids":["f1","f1"]}',
        '{"schema_version":"7A.1","fact_ids":[]}',
        '{"schema_version":"7A.1","fact_ids":["f1"],"text":"gain de neuf mille"}',
        '{"schema_version":"7A.1","fact_ids":["f1"],"fact_ids":["f0"]}',
        '{"schema_version":"7A.1","fact_ids":["f1"],"x":NaN}',
        'Voici le JSON: {"schema_version":"7A.1","fact_ids":["f0"]}',
    ],
)
def test_invented_numbers_assertions_and_ambiguous_json_are_rejected(real_run, content):
    with pytest.raises(GatewayError, match="LLM_INVALID_RESPONSE"):
        render_explanation(context(real_run), content)


def test_feasible_witness_cannot_become_optimal(real_run):
    preview = context(witness(real_run, 20.0, 20.0))
    response = render_explanation(preview, '{"schema_version":"7A.1","fact_ids":["f1"]}')
    assert "optimalité non prouvée" in response.paragraphs[0]
    assert "Optimalité attestée" not in " ".join(response.paragraphs)


@pytest.mark.parametrize(
    "status,native",
    [
        ("INFEASIBLE", "INFEASIBLE"),
        ("TIME_LIMIT_NO_SOLUTION", "TIME_LIMIT"),
        ("SOLUTION_FAILED_VALIDATION", "SOLUTION_FAILED_VALIDATION"),
    ],
)
def test_no_plan_exposes_no_decisions_or_objective(real_run, status, native):
    original = comparison_input(real_run)

    def change(d):
        d["solve"]["public_status"] = status
        d["solve"]["status"] = native
        d["report"]["has_verified_plan"] = False

    source = replace(altered(original, change), record_status=status)
    report = compare_runs("tenant", source, source)
    preview = build_context(report, ExplanationSelection(run_id=source.run_id), NvidiaSettings())
    assert not preview.references[0].verified_plan
    assert all(f.kind in ("STATUS", "LIMIT") for f in preview.facts)
    assert "4100" not in preview.outbound_json


@pytest.mark.parametrize(
    "sector,param,value,expected",
    [
        ("factory", "delivery_capacity_units", "45", ("4100", "3500", "-600")),
        ("university", "room_slots", "1", ("17", "10", "-7")),
    ],
)
def test_comparison_facts_come_from_real_calculation(sector, param, value, expected):
    source = load_organization_file(
        ROOT / f"examples/organizations/{sector}/project.json"
    ).model_dump(mode="json")
    baseline_run = solve_organization(source)
    source["shared_parameters"][param]["value"] = value
    source["graph"]["organization"]["data_snapshot_id"] = "changed"
    run = solve_organization(source)
    preview = context(run, intent="COMPARISON", baseline=comparison_input(baseline_run))
    objective_values = tuple(f.values[0] for f in preview.facts if f.kind == "OBJECTIVE")
    assert objective_values == expected[:2]
    assert next(f.values[0] for f in preview.facts if f.kind == "COMPARISON") == expected[2]
    assert "Aucun gain économique démontré" in next(
        f.text for f in preview.facts if f.kind == "COMPARISON"
    )


def test_disabled_ignores_invalid_optional_environment(monkeypatch):
    monkeypatch.delenv("NVIDIA_ENABLED", raising=False)
    monkeypatch.setenv("NVIDIA_TIMEOUT", "not a number")
    monkeypatch.setenv("NVIDIA_BASE_URL", "http://private-host")
    assert not NvidiaSettings.from_env().enabled
    with pytest.raises(ValueError):
        NvidiaSettings(base_url="http://localhost")
    assert "synthetic-secret" not in repr(NvidiaSettings(api_key="synthetic-secret"))


class Reply(io.BytesIO):
    status = 200


def provider_reply(monkeypatch, payload):
    class Opener:
        def open(self, request, timeout):
            body = json.loads(request.data)
            assert body["stream"] is False and body["max_tokens"] == 512
            assert body["reasoning_budget"] == 0
            assert "tools" not in body and timeout == 20
            return Reply(json.dumps(payload).encode())

    monkeypatch.setattr("urllib.request.build_opener", lambda *a: Opener())


def test_nvidia_transport_accepts_only_complete_matching_model(monkeypatch):
    payload = {
        "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"content": '{"schema_version":"7A.1","fact_ids":["f0"]}'},
            }
        ],
    }
    provider_reply(monkeypatch, payload)
    assert '"f0"' in NvidiaProvider(NvidiaSettings(api_key="synthetic")).complete("{}")
    payload["choices"][0]["finish_reason"] = "length"
    provider_reply(monkeypatch, payload)
    with pytest.raises(GatewayError, match="LLM_INVALID_RESPONSE"):
        NvidiaProvider(NvidiaSettings(api_key="synthetic")).complete("{}")


@pytest.mark.parametrize(
    "exception,code",
    [
        (TimeoutError(), "LLM_TIMEOUT"),
        (OSError(), "LLM_UNAVAILABLE"),
        (urllib.error.HTTPError("https://host", 429, "secret-body", {}, None), "LLM_RATE_LIMIT"),
        (urllib.error.HTTPError("https://host", 503, "secret-body", {}, None), "LLM_UNAVAILABLE"),
    ],
)
def test_transport_failures_are_closed_and_prompt_free(monkeypatch, exception, code):
    class Opener:
        def open(self, *a, **kw):
            raise exception

    monkeypatch.setattr("urllib.request.build_opener", lambda *a: Opener())
    with pytest.raises(GatewayError, match=code) as exc:
        NvidiaProvider(NvidiaSettings(api_key="synthetic")).complete("{}")
    assert "secret-body" not in str(exc.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"model": "nvidia/nemotron-3.5-lightning-30b-a3b", "choices": [None]},
        {"model": "foreign/model", "choices": []},
        {
            "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
            "choices": [{"message": [], "finish_reason": "stop"}],
        },
        {
            "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
            "choices": [
                {"message": {"tool_calls": [{}], "content": "{}"}, "finish_reason": "stop"}
            ],
        },
    ],
)
def test_malformed_provider_envelope_fails_closed(monkeypatch, payload):
    provider_reply(monkeypatch, payload)
    with pytest.raises(GatewayError, match="LLM_INVALID_RESPONSE"):
        NvidiaProvider(NvidiaSettings(api_key="synthetic")).complete("{}")


def test_provider_missing_key_and_oversized_output_never_pass(monkeypatch):
    with pytest.raises(GatewayError, match="LLM_MISSING_API_KEY"):
        NvidiaProvider(NvidiaSettings()).complete("{}")
    provider_reply(monkeypatch, {"padding": "x" * 40000})
    with pytest.raises(GatewayError, match="LLM_INVALID_RESPONSE"):
        NvidiaProvider(NvidiaSettings(api_key="synthetic")).complete("{}")


def test_redirect_handler_never_forwards_credentials():
    from brain.llm_gateway.provider import NoRedirect

    assert (
        NoRedirect().redirect_request(None, None, 307, "", {}, "https://attacker.invalid") is None
    )
