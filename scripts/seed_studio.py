"""Explicit synthetic demo provisioning; never exposed as an HTTP solve endpoint."""

import argparse
import getpass
import json
import os
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select

from brain.organization.project import load_organization_file
from brain.organization.runtime import solve_organization
from brain.platform import auth, service
from brain.platform.api import create_app
from brain.platform.database import sessions
from brain.platform.models import User

ROOT = Path(__file__).resolve().parents[1]


def seed(*, username: str, password: str, history: bool, fixtures: bool = False) -> None:
    """Use governance API for publications and the existing trusted hook for history."""
    url = os.environ.get("BRAIN_MIGRATION_DATABASE_URL")
    if not url:
        raise ValueError("BRAIN_MIGRATION_DATABASE_URL requis pour le provisionnement explicite")
    engine = create_engine(url, hide_parameters=True)
    users: dict[str, str] = {}
    with sessions(engine).begin() as session:
        for role in ("admin", "builder", "approver", "viewer"):
            name = f"{username}_{role}"
            user = session.scalar(select(User).where(User.username == name))
            if user is None:
                user = auth.create_user(session, name, password, f"Studio démo · {role}")
            elif not user.active or not auth.HASHER.verify(user.password_hash, password):
                raise ValueError(
                    "Compte de démonstration existant incompatible ; aucun mot de passe réécrit"
                )
            users[role] = user.id
    engine.dispose()
    app = create_app()
    manifest: dict[str, Any] = {"username_prefix": username, "organizations": {}}
    with TestClient(app) as client:

        def request(
            method: str, path: str, body: object = None, *, authenticated: bool = True
        ) -> Any:
            if body is None:
                response = client.request(
                    method, "/api/v1" + path, headers=headers if authenticated else {}
                )
            else:
                response = client.request(
                    method, "/api/v1" + path, headers=headers if authenticated else {}, json=body
                )
            if response.status_code not in (200, 201):
                raise ValueError(f"Provisionnement refusé par l’API : HTTP {response.status_code}")
            return response.json()

        headers: dict[str, str] = {}
        login = request(
            "POST",
            "/auth/login",
            {"username": f"{username}_admin", "password": password},
            authenticated=False,
        )
        headers = {"Authorization": "Bearer " + login["access_token"]}
        accessible = request("GET", "/organizations?limit=100")["items"]
        for example in ("factory", "university"):
            source = load_organization_file(ROOT / f"examples/organizations/{example}/project.json")
            key = source.graph.organization.id
            organization = next((item for item in accessible if item["key"] == key), None)
            if organization is None:
                organization = request(
                    "POST", "/organizations", {"key": key, "name": source.graph.organization.name}
                )
            org_id = organization["id"]
            base = f"/organizations/{org_id}"
            if example == "factory":
                for role in ("builder", "approver", "viewer"):
                    request(
                        "PUT", base + "/memberships", {"user_id": users[role], "role": role.upper()}
                    )
            registered = {
                item["key"] for item in request("GET", base + "/departments?limit=100")["items"]
            }
            for department in source.graph.departments:
                if department.id not in registered:
                    request(
                        "POST",
                        base + "/departments",
                        {
                            "key": department.id,
                            "name": department.name,
                            "owner_user_id": users["admin"],
                        },
                    )
            graph = request(
                "POST",
                base + "/graphs",
                {
                    "graph": source.graph.model_dump(mode="json"),
                    "shared_parameters": {
                        key: parameter.model_dump(mode="json")
                        for key, parameter in source.shared_parameters.items()
                    },
                },
            )
            graph = request("POST", base + f"/graphs/{graph['id']}/publish")
            model = request(
                "POST",
                base + "/model-versions",
                {"graph_snapshot_id": graph["id"], "model": source.model_dump(mode="json")},
            )
            model = request("POST", base + f"/model-versions/{model['id']}/publish")
            runs = request("GET", base + "/optimization-runs?limit=100")["items"]
            existing_run = next(
                (run for run in runs if run["model_version_id"] == model["id"]), None
            )
            run_id: str | None
            if history and existing_run is None:
                solved = solve_organization(source).solve  # CLI provisioning only, not the browser.
                with app.state.session_factory.begin() as session:
                    user = session.get(User, users["admin"])
                    assert user is not None
                    run = service.record_run(session, user, org_id, model["id"], solved)
                    run_id = run.id
            else:
                run_id = existing_run["id"] if existing_run else None
            run_document = request("GET", base + f"/optimization-runs/{run_id}") if run_id else None
            manifest["organizations"][example] = {
                "id": org_id,
                "graph_id": graph["id"],
                "model_id": model["id"],
                "run_id": run_id,
            }
            if fixtures:
                target = ROOT / "frontend/tests/fixtures" / f"{example}.json"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(
                    json.dumps(
                        {
                            "organization": organization,
                            "graph": graph,
                            "model": model,
                            "run": run_document,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )
        client.post("/api/v1/auth/logout", headers=headers)
    target = ROOT / ".local/studio/manifest.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        "Deux organisations synthétiques publiées ; manifeste local sans secret : .local/studio/manifest.json"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Provisionner explicitement les deux exemples synthétiques pour le Studio"
    )
    parser.add_argument("--username-prefix", default="studio_demo")
    parser.add_argument(
        "--with-history",
        action="store_true",
        help="Résoudre via le pipeline Python existant et conserver les runs vérifiés",
    )
    parser.add_argument(
        "--fixtures",
        action="store_true",
        help="Exporter uniquement les réponses métier non secrètes pour les tests contractuels",
    )
    args = parser.parse_args()
    seed(
        username=args.username_prefix,
        password=os.environ.get("BRAIN_DEMO_PASSWORD")
        or getpass.getpass("Mot de passe des comptes synthétiques : "),
        history=args.with_history,
        fixtures=args.fixtures,
    )


if __name__ == "__main__":
    main()
