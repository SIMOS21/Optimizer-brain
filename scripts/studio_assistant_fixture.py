"""Explicit fake hosted provider for the isolated E2E sandbox only, never production."""

import json
import os
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy.engine import make_url

from brain.llm_gateway.provider import NvidiaSettings
from brain.platform.api import create_app as secure_app


class DeterministicProvider:
    def complete(self, context: str) -> str:
        data = json.loads(context)
        ids = [fact["id"] for fact in data["facts"]][:8]
        return json.dumps({"schema_version": "7A.1", "fact_ids": ids})


def create_app() -> FastAPI:
    url = make_url(os.environ.get("BRAIN_DATABASE_URL", ""))
    if (
        url.database != "optimizer_brain_e2e"
        or url.host not in ("127.0.0.1", "localhost", "::1")
        or os.environ.get("STUDIO_E2E") != "1"
    ):
        raise ValueError("Faux fournisseur réservé à PostgreSQL E2E local")
    folder = Path(os.environ["STUDIO_E2E_FIXTURES_DIR"])
    fixtures = [
        json.loads((folder / f"{sector}.json").read_text(encoding="utf-8"))
        for sector in ("factory", "university")
    ]
    settings = NvidiaSettings(
        enabled=True,
        api_key="synthetic-fixture-no-network",
        organizations=frozenset(f["organization"]["id"] for f in fixtures),
        public_model_hashes=frozenset(f["model"]["content_hash"] for f in fixtures),
        calls_per_hour=100,
    )
    return secure_app(nvidia_settings=settings, explanation_provider=DeterministicProvider())
