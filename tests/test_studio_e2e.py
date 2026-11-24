"""An opt-in E2E launcher must never fall back to or reset the demo database."""

import pytest

from scripts.studio_e2e import (
    E2EConfig,
    load_environment,
    runtime_environment,
    prepare_navigation_catalog,
)

RUNTIME = "postgresql+psycopg://brain_app:synthetic@127.0.0.1:55432/optimizer_brain_e2e"
MIGRATION = "postgresql+psycopg://brain_migrator:synthetic@127.0.0.1:55432/optimizer_brain_e2e"


@pytest.mark.parametrize(
    "database", ["optimizer_brain_studio", "optimizer_brain_test", "postgres", ""]
)
def test_demo_and_unit_databases_are_never_e2e_targets(database):
    with pytest.raises(ValueError, match="E2E"):
        E2EConfig(RUNTIME.replace("optimizer_brain_e2e", database), MIGRATION)


def test_runtime_cannot_use_migration_identity_or_another_server():
    with pytest.raises(ValueError, match="distinctes"):
        E2EConfig(MIGRATION, MIGRATION)
    with pytest.raises(ValueError, match="même serveur"):
        E2EConfig(RUNTIME, MIGRATION.replace("55432", "5432"))


def test_services_and_browser_never_inherit_migration_or_demo_credentials(monkeypatch):
    monkeypatch.setenv("BRAIN_MIGRATION_DATABASE_URL", "private-migration-secret")
    monkeypatch.setenv("BRAIN_E2E_MIGRATION_DATABASE_URL", MIGRATION)
    monkeypatch.setenv("BRAIN_DEMO_PASSWORD", "private-demo-secret")
    monkeypatch.setenv("BRAIN_TEST_DATABASE_URL", "private-unit-url")
    # Hosted Windows runners may have unrelated PASSWORD metadata. This
    # launcher filters the Brain/Studio namespace, not the whole operating system.
    monkeypatch.setenv("RUNNER_PASSWORD_METADATA", "public-runner-metadata")
    env = runtime_environment(E2EConfig(RUNTIME, MIGRATION))
    assert env["BRAIN_DATABASE_URL"] == RUNTIME
    assert env["STUDIO_BASE_URL"].endswith(":5181")
    assert {key for key in env if key.startswith("BRAIN_")} == {"BRAIN_DATABASE_URL"}
    assert not any(
        "MIGRATION" in key or "PASSWORD" in key or "TEST_DATABASE" in key
        for key in env
        if key.startswith("STUDIO_")
    )
    assert env["RUNNER_PASSWORD_METADATA"] == "public-runner-metadata"
    assert "synthetic" not in repr(E2EConfig(RUNTIME, MIGRATION))


def test_env_file_is_data_and_cannot_override_arbitrary_configuration(tmp_path):
    path = tmp_path / "e2e.env"
    path.write_text("BRAIN_DATABASE_URL=private-demo-url", encoding="utf-8")
    with pytest.raises(ValueError, match="non autorisée"):
        load_environment(path)


def test_navigation_catalog_cannot_target_demo_even_when_called_directly(monkeypatch):
    monkeypatch.setenv(
        "BRAIN_DATABASE_URL", RUNTIME.replace("optimizer_brain_e2e", "optimizer_brain_studio")
    )
    with pytest.raises(ValueError, match="hors base dédiée"):
        prepare_navigation_catalog("synthetic")
