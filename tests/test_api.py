import json
from pathlib import Path
from fastapi.testclient import TestClient
from brain.api import app

client = TestClient(app)
EXAMPLE = Path(__file__).resolve().parents[1] / 'examples' / 'factory.json'


def _data():
    return json.loads(EXAMPLE.read_text(encoding='utf-8'))['scenario']


def test_api_optimize_without_llm():
    resp = client.post('/optimize', json={'scenario': _data()})
    assert resp.status_code == 200
    assert resp.json()['status'] == 'optimal'
    assert resp.json()['metrics']['profit'] == 6840


def test_api_reject_unexpected_llm_decision():
    bad = _data()
    bad['ignore_budget'] = True
    resp = client.post('/optimize', json={'scenario': bad})
    assert resp.status_code == 422


def test_api_reject_extra_top_level_fields():
    resp = client.post('/optimize', json={'scenario': _data(), 'override': True})
    assert resp.status_code == 422
