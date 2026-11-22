"""Append-only, checksummed local snapshots using SQLite atomic transactions."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3

from brain.kernel.ir import to_data
from .composition import Composition, canonical_json, checksum, compose_organization_model
from .reporting import build_report, graph_mermaid
from .runtime import OrganizationRun


class SnapshotConflictError(ValueError):
    """A published identity/version already has different content."""


class SnapshotIntegrityError(ValueError):
    """Stored bytes/checksums or derived artifacts disagree."""


class SnapshotStore:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.directory = directory.resolve()
        self.path = self.directory / "snapshots.sqlite3"
        if self.path.is_symlink() or not self.path.resolve().is_relative_to(self.directory):
            raise ValueError("Le fichier de stockage doit rester dans le répertoire configuré")

    def _connect(self) -> sqlite3.Connection:
        if self.path.is_symlink() or not self.path.resolve().is_relative_to(self.directory):
            raise ValueError("Chemin du stockage modifié ou redirigé")
        connection = sqlite3.connect(self.path, timeout=10)
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute(
            "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, organization_id TEXT NOT NULL, record_id TEXT NOT NULL, version TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (kind, organization_id, record_id, version))"
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'composition' CHECK (kind='composition'), organization_id TEXT NOT NULL, model_id TEXT NOT NULL, model_version TEXT NOT NULL, bundle_hash TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, FOREIGN KEY (kind, organization_id, model_id, model_version) REFERENCES records(kind, organization_id, record_id, version))"
        )
        return connection

    @staticmethod
    def _records(composition: Composition) -> list[tuple[str, str, str, object]]:
        source = composition.source
        organization = source.graph.organization
        records: list[tuple[str, str, str, object]] = [
            ("graph", organization.id, organization.version, source.graph),
            (
                "parameter_snapshot",
                organization.data_snapshot_id,
                "1",
                composition.model.parameters,
            ),
            ("composition", source.model_id, source.model_version, composition.to_dict()),
            ("objective", source.objective.id, source.objective.version, source.objective),
        ]
        records.extend(("department", d.id, d.version, d) for d in source.graph.departments)
        records.extend(("resource", r.id, r.version, r) for r in source.graph.resources)
        records.extend(("fragment", f.id, f.version, f) for f in source.fragments)
        records.extend(
            ("parameter", key, p.version, p) for key, p in composition.model.parameters.items()
        )
        return sorted(records, key=lambda record: record[:3])

    @staticmethod
    def _checked(content_hash: str, payload: str) -> str:
        if checksum(payload) != content_hash:
            raise SnapshotIntegrityError("Checksum d'un artefact local invalide")
        return payload

    def _put(
        self,
        connection: sqlite3.Connection,
        kind: str,
        organization: str,
        identity: str,
        version: str,
        value: object,
    ) -> None:
        payload = canonical_json(value)
        digest = checksum(payload)
        existing = connection.execute(
            "SELECT content_hash, payload FROM records WHERE kind=? AND organization_id=? AND record_id=? AND version=?",
            (kind, organization, identity, version),
        ).fetchone()
        if existing is not None:
            self._checked(existing[0], existing[1])
            if existing != (digest, payload):
                raise SnapshotConflictError(
                    f"Version publiée non modifiable : {kind}/{organization}/{identity}@{version}"
                )
            return
        connection.execute(
            "INSERT INTO records(kind,organization_id,record_id,version,content_hash,payload) VALUES(?,?,?,?,?,?)",
            (kind, organization, identity, version, digest, payload),
        )

    def publish(self, composition: Composition, run: OrganizationRun | None = None) -> str:
        # Validate immutable content and every derived artifact before publication.
        checked = compose_organization_model(composition.source_json)
        if checked.to_dict() != composition.to_dict():
            raise SnapshotIntegrityError("Composition ou IR modifiée après compilation")
        source = checked.source
        run_payload = None
        if run is not None:
            if run.composition.to_dict() != checked.to_dict():
                raise SnapshotIntegrityError("Run associé à une autre composition")
            measured = build_report(checked, run.solve)
            if measured != run.report:
                raise SnapshotIntegrityError("Rapport de run modifié ou non reproductible")
            run_payload = canonical_json(
                {
                    "composition_manifest_hash": checked.manifest_hash,
                    "solve": run.solve.to_dict(),
                    "report": to_data(measured),
                    "mermaid": graph_mermaid(checked),
                }
            )
        bundle_hash = checksum(canonical_json(checked.to_dict()))
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                for kind, identity, version, value in self._records(checked):
                    self._put(
                        connection, kind, source.graph.organization.id, identity, version, value
                    )
                if run is not None and run_payload is not None:
                    digest = checksum(run_payload)
                    existing = connection.execute(
                        "SELECT content_hash,payload FROM runs WHERE run_id=?", (run.solve.run_id,)
                    ).fetchone()
                    if existing:
                        self._checked(existing[0], existing[1])
                        if existing != (digest, run_payload):
                            raise SnapshotConflictError("Un run publié ne peut pas être remplacé")
                    else:
                        connection.execute(
                            "INSERT INTO runs(run_id,organization_id,model_id,model_version,bundle_hash,content_hash,payload) VALUES(?,?,?,?,?,?,?)",
                            (
                                run.solve.run_id,
                                source.graph.organization.id,
                                source.model_id,
                                source.model_version,
                                bundle_hash,
                                digest,
                                run_payload,
                            ),
                        )
        return checked.manifest_hash

    def load_snapshot(self, organization_id: str, model_id: str, version: str) -> Composition:
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("BEGIN")
                row = connection.execute(
                    "SELECT content_hash,payload FROM records WHERE kind='composition' AND organization_id=? AND record_id=? AND version=?",
                    (organization_id, model_id, version),
                ).fetchone()
                if row is None:
                    raise KeyError("Snapshot local introuvable")
                payload = self._checked(row[0], row[1])
                try:
                    stored = json.loads(payload)
                    composition = compose_organization_model(stored["organization_model"])
                    if canonical_json(composition.to_dict()) != payload:
                        raise SnapshotIntegrityError(
                            "Artefacts dérivés différents de la source publiée"
                        )
                    if (
                        composition.source.graph.organization.id,
                        composition.ir.model_id,
                        composition.ir.model_version,
                    ) != (organization_id, model_id, version):
                        raise SnapshotIntegrityError("Identité du snapshot incohérente")
                    for kind, identity, record_version, value in self._records(composition):
                        component = connection.execute(
                            "SELECT content_hash,payload FROM records WHERE kind=? AND organization_id=? AND record_id=? AND version=?",
                            (kind, organization_id, identity, record_version),
                        ).fetchone()
                        if component is None or self._checked(
                            component[0], component[1]
                        ) != canonical_json(value):
                            raise SnapshotIntegrityError("Composant publié absent ou incohérent")
                except (TypeError, ValueError, KeyError) as exc:
                    raise SnapshotIntegrityError(str(exc)) from exc
        return composition

    def load_run(self, run_id: str) -> dict[str, object]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT organization_id,model_id,model_version,bundle_hash,content_hash,payload FROM runs WHERE run_id=?",
                (run_id,),
            ).fetchone()
        if row is None:
            raise KeyError("Run local introuvable")
        payload = self._checked(row[4], row[5])
        composition = self.load_snapshot(row[0], row[1], row[2])
        if checksum(canonical_json(composition.to_dict())) != row[3]:
            raise SnapshotIntegrityError("Référence du run vers le snapshot invalide")
        stored = json.loads(payload)
        if (
            not isinstance(stored, dict)
            or stored.get("composition_manifest_hash") != composition.manifest_hash
        ):
            raise SnapshotIntegrityError("Manifeste du run incohérent")
        if not isinstance(stored.get("solve"), dict) or stored["solve"].get("run_id") != run_id:
            raise SnapshotIntegrityError("Identité du run incohérente")
        return stored

    def history(self, organization_id: str, model_id: str) -> tuple[tuple[str, str], ...]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT version,content_hash FROM records WHERE kind='composition' AND organization_id=? AND record_id=? ORDER BY version",
                (organization_id, model_id),
            ).fetchall()
        return tuple((str(version), str(digest)) for version, digest in rows)
