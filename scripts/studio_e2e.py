"""Opt-in local/CI E2E sandbox. Dedicated database, no reset or demo fallback."""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass, field
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from typing import Iterator
import urllib.request

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
DATABASE = "optimizer_brain_e2e"
API_PORT = 8002
STUDIO_PORT = 5181
DIRECTORY = ROOT / ".local/e2e"
ENV_KEYS = {"BRAIN_E2E_DATABASE_URL", "BRAIN_E2E_MIGRATION_DATABASE_URL", "BRAIN_E2E_PASSWORD"}


@dataclass(frozen=True)
class E2EConfig:
    runtime_url: str = field(repr=False)
    migration_url: str = field(repr=False)

    def __post_init__(self) -> None:
        try:
            runtime, migration = make_url(self.runtime_url), make_url(self.migration_url)
        except Exception:
            raise ValueError("URLs E2E explicites et valides requises") from None
        for url in (runtime, migration):
            if (
                url.drivername != "postgresql+psycopg"
                or url.database != DATABASE
                or url.host not in ("127.0.0.1", "localhost", "::1")
                or not url.username
                or not url.password
            ):
                raise ValueError("E2E refusé : PostgreSQL local optimizer_brain_e2e requis")
        if (runtime.host, runtime.port) != (migration.host, migration.port):
            raise ValueError("Les URLs E2E doivent cibler le même serveur")
        if runtime.username == migration.username:
            raise ValueError("Identités runtime et migration distinctes requises")

    @classmethod
    def from_env(cls) -> "E2EConfig":
        return cls(
            os.environ.get("BRAIN_E2E_DATABASE_URL", ""),
            os.environ.get("BRAIN_E2E_MIGRATION_DATABASE_URL", ""),
        )


def load_environment(path: Path) -> None:
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        key, separator, value = raw.partition("=")
        if not separator or key not in ENV_KEYS:
            raise ValueError("Le fichier E2E contient une clé non autorisée")
        os.environ[key] = value


def runtime_environment(config: E2EConfig) -> dict[str, str]:
    result = {
        k: v for k, v in os.environ.items() if not k.startswith(("BRAIN_", "STUDIO_", "NVIDIA_"))
    }
    result.update(
        NVIDIA_ENABLED="false",
        BRAIN_DATABASE_URL=config.runtime_url,
        STUDIO_API_TARGET=f"http://127.0.0.1:{API_PORT}",
        STUDIO_BASE_URL=f"http://127.0.0.1:{STUDIO_PORT}",
        STUDIO_E2E="1",
        STUDIO_E2E_FIXTURES_DIR=str(DIRECTORY / "fixtures"),
        STUDIO_PYTHON=sys.executable,
        STUDIO_SCREENSHOT_DIR="test-results/screenshots",
    )
    return result


@contextmanager
def provisioning_environment(config: E2EConfig) -> Iterator[None]:
    keys = ("BRAIN_DATABASE_URL", "BRAIN_MIGRATION_DATABASE_URL")
    previous = {key: os.environ.get(key) for key in keys}
    os.environ.update(
        BRAIN_DATABASE_URL=config.runtime_url, BRAIN_MIGRATION_DATABASE_URL=config.migration_url
    )
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def prepare(config: E2EConfig) -> str:
    """Create if absent, upgrade and seed idempotently. Never delete existing data."""
    from scripts.seed_studio import seed

    DIRECTORY.mkdir(parents=True, exist_ok=True)
    password_file = DIRECTORY / "password.txt"
    password = os.environ.get("BRAIN_E2E_PASSWORD")
    if not password:
        password = (
            password_file.read_text().strip()
            if password_file.exists()
            else secrets.token_urlsafe(32)
        )
    bootstrap = create_engine(
        make_url(config.migration_url).set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        hide_parameters=True,
    )
    try:
        with bootstrap.connect() as connection:
            if not connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": DATABASE}
            ):
                connection.execute(text("CREATE DATABASE optimizer_brain_e2e"))
    finally:
        bootstrap.dispose()
    engine = create_engine(config.migration_url, hide_parameters=True)
    try:
        with engine.begin() as connection:
            if connection.scalar(text("SELECT current_database()")) != DATABASE:
                raise ValueError("Base E2E incompatible ; aucune migration effectuée")
            alembic = Config(str(ROOT / "alembic.ini"))
            alembic.attributes["connection"] = connection
            command.upgrade(alembic, "head")
    finally:
        engine.dispose()
    with provisioning_environment(config):
        seed(
            username="studio_demo",
            password=password,
            history=True,
            fixtures=True,
            fixture_directory=DIRECTORY / "fixtures",
            manifest_path=DIRECTORY / "manifest.json",
        )
        prepare_navigation_catalog(password)
    password_file.write_text(password + "\n", encoding="utf-8")
    return password


def prepare_navigation_catalog(password: str) -> None:
    """Twenty explicitly marked synthetic spaces, only in the guarded E2E DB."""
    if make_url(os.environ.get("BRAIN_DATABASE_URL", "")).database != DATABASE:
        raise ValueError("Catalogue E2E refusé hors base dédiée")
    from fastapi.testclient import TestClient
    from brain.platform.api import create_app

    with TestClient(create_app()) as client:
        login = client.post(
            "/api/v1/auth/login", json={"username": "studio_demo_admin", "password": password}
        )
        if login.status_code != 200:
            raise RuntimeError("Authentification du catalogue E2E refusée")
        headers = {"Authorization": "Bearer " + login.json()["access_token"]}
        keys: set[str] = set()
        for offset in range(0, 100_000, 100):
            response = client.get(
                f"/api/v1/organizations?limit=100&offset={offset}", headers=headers
            )
            if response.status_code != 200:
                raise RuntimeError("Lecture du catalogue E2E refusée")
            rows = response.json()["items"]
            keys.update(row["key"] for row in rows)
            if len(rows) < 100:
                break
        for index in range(1, 21):
            key = f"studio_import_ux_fixture_{index:02}"
            if key not in keys:
                created = client.post(
                    "/api/v1/organizations",
                    headers=headers,
                    json={"key": key, "name": f"Espace de test navigation {index:02}"},
                )
                if created.status_code != 201:
                    raise RuntimeError("Création du catalogue E2E refusée")
        client.post("/api/v1/auth/logout", headers=headers)


def available_port(port: int) -> None:
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError:
            raise ValueError(f"Port E2E {port} occupé ; aucun service existant réutilisé") from None


@contextmanager
def background(
    args: list[str], env: dict[str, str], label: str, cwd: Path
) -> Iterator[subprocess.Popen[bytes]]:
    with (DIRECTORY / f"{label}.log").open("wb") as logfile:
        process = subprocess.Popen(
            args,
            cwd=cwd,
            env=env,
            stdout=logfile,
            stderr=logfile,
            start_new_session=os.name != "nt",
        )
        try:
            yield process
        finally:
            if process.poll() is None:
                if sys.platform == "win32":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                    )
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if sys.platform != "win32":
                        os.killpg(process.pid, signal.SIGKILL)
                    process.kill()
                    process.wait()


def wait_ready(url: str, process: subprocess.Popen[bytes]) -> None:
    for _ in range(150):
        if process.poll() is not None:
            raise RuntimeError("Service E2E arrêté ; consulter son journal local privé")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.2)
    raise RuntimeError("Délai de démarrage du service E2E dépassé")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--measure", choices=("before", "after"))
    parser.add_argument("--graph-measure", choices=("before", "after"))
    parser.add_argument("--execution-measure", choices=("before", "after"))
    parser.add_argument("--scenario-measure", choices=("before", "after"))
    parser.add_argument("--comparison-measure", action="store_true")
    parser.add_argument(
        "--assistant-fixture",
        action="store_true",
        help="Fake provider; isolated E2E database only, no NVIDIA network",
    )
    args, tests = parser.parse_known_args()
    if args.env_file:
        load_environment(args.env_file)
    config = E2EConfig.from_env()
    # Refuse occupied ports before provisioning or touching the E2E database.
    if not args.prepare_only:
        for port in (API_PORT, STUDIO_PORT):
            available_port(port)
    password = prepare(config)
    if args.prepare_only:
        return 0
    node = shutil.which("node")
    if not node:
        raise ValueError("Node.js requis")
    frontend = ROOT / "frontend"
    env = runtime_environment(config)
    if args.assistant_fixture:
        env["STUDIO_ASSISTANT_FIXTURE"] = "1"
    if not args.skip_build:
        for command_args in (
            [node, "node_modules/typescript/bin/tsc", "-b"],
            [node, "node_modules/vite/bin/vite.js", "build"],
        ):
            subprocess.run(command_args, cwd=frontend, env=env, check=True)
    with background(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "scripts.studio_assistant_fixture:create_app"
            if args.assistant_fixture
            else "brain.platform.api:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(API_PORT),
            "--no-access-log",
        ],
        env,
        "api",
        ROOT,
    ) as api:
        wait_ready(f"http://127.0.0.1:{API_PORT}/health", api)
        with background(
            [
                node,
                "node_modules/vite/bin/vite.js",
                "dev" if args.graph_measure else "preview",
                "--host",
                "127.0.0.1",
                "--port",
                str(STUDIO_PORT),
                "--strictPort",
            ],
            env,
            "studio",
            frontend,
        ) as studio:
            wait_ready(env["STUDIO_BASE_URL"], studio)
            print(f"Studio E2E isolé : {env['STUDIO_BASE_URL']} ; aucune purge", flush=True)
            if args.serve:
                while True:
                    if api.poll() is not None or studio.poll() is not None:
                        raise RuntimeError("Service E2E interrompu")
                    time.sleep(1)
            test_env = {**env, "BRAIN_DEMO_PASSWORD": password}
            if args.comparison_measure:
                return subprocess.call(
                    [node, str(ROOT / "scripts/measure_comparison.mjs")],
                    cwd=frontend,
                    env=test_env,
                )
            if args.scenario_measure:
                return subprocess.call(
                    [
                        node,
                        str(ROOT / "scripts/measure_scenario_history.mjs"),
                        args.scenario_measure,
                    ],
                    cwd=frontend,
                    env=test_env,
                )
            if args.execution_measure:
                return subprocess.call(
                    [node, str(ROOT / "scripts/measure_execution.mjs"), args.execution_measure],
                    cwd=frontend,
                    env=test_env,
                )
            if args.graph_measure:
                return subprocess.call(
                    [node, str(ROOT / "scripts/measure_graph.mjs"), args.graph_measure],
                    cwd=frontend,
                    env=test_env,
                )
            if args.measure:
                return subprocess.call(
                    [node, str(ROOT / "scripts/measure_studio.mjs"), args.measure],
                    cwd=frontend,
                    env=test_env,
                )
            return subprocess.call(
                [node, "node_modules/@playwright/test/cli.js", "test", *tests],
                cwd=frontend,
                env=test_env,
            )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130) from None
    except Exception as error:
        # Never print database URLs/passwords from third-party exception messages.
        print(
            f"Lancement E2E refusé ou interrompu ({type(error).__name__}). Vérifiez la configuration et les journaux privés.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
