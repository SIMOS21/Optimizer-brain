"""Reconstruct diagnostic inputs from immutable, tenant-scoped artifacts only."""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from brain.constraint_diagnostics import diagnose
from brain.kernel.schema import StrictModel
from brain.organization import compose_organization_model
from brain.organization.composition import canonical_json, checksum
from brain.solvers.contracts import SolveSettings
from . import service
from .models import OptimizationRun, User
from .schemas import DiagnosticsResponse


class _RecordedEvidence(StrictModel):
    model_id: str
    model_version: str
    model_hash: str
    manifest_hash: str
    data_snapshot_id: str
    scenario_id: str
    status: str
    decision_values: dict[str, float] | None
    solver_objective_value: float | None
    settings: SolveSettings


def artifact_diagnostics(
    session: Session, actor: User, organization_id: str, identity: str, *, run: bool
) -> DiagnosticsResponse:
    # Same membership/RLS boundary as other read-only Studio artifact endpoints.
    service.tenant(session, actor, organization_id)
    history = None
    if run:
        history = session.scalar(
            select(OptimizationRun).where(
                OptimizationRun.organization_id == organization_id,
                OptimizationRun.id == identity,
            )
        )
        if history is None:
            raise service.ServiceError(404, "Run introuvable")
    model = service.get_model(
        session, organization_id, history.model_version_id if history else identity
    )
    for record in (model, history):
        if record is not None and checksum(record.payload) != record.content_hash:
            raise service.ServiceError(409, "Intégrité de l'artefact invalide")
    composition = compose_organization_model(json.loads(model.payload)["organization_model"])
    # Fail closed if a future compiler/composer cannot reproduce the historical
    # artifact. Do not silently replace the stored IR or reinterpret its lineage.
    if canonical_json(composition.to_dict()) != model.payload:
        raise service.ServiceError(409, "Reconstruction du modèle historique incompatible")
    evidence = None
    if history is not None:
        solved = json.loads(history.payload)["solve"]
        evidence = _RecordedEvidence.model_validate(
            {key: solved[key] for key in _RecordedEvidence.model_fields}
        )
        ir = composition.ir
        if (
            evidence.model_id,
            evidence.model_version,
            evidence.model_hash,
            evidence.manifest_hash,
            evidence.data_snapshot_id,
            evidence.scenario_id,
        ) != (
            ir.model_id,
            ir.model_version,
            ir.model_hash,
            ir.manifest_hash,
            ir.data_snapshot_id,
            ir.scenario_id,
        ):
            raise service.ServiceError(409, "Provenance du run incompatible avec le modèle")
    report = diagnose(
        composition.ir,
        traces=composition.constraint_traces,
        composition_manifest_hash=composition.manifest_hash,
        decisions=evidence.decision_values if evidence else None,
        verification_settings=evidence.settings.verification if evidence else None,
        solver_objective=evidence.solver_objective_value if evidence else None,
        solver_status=evidence.status if evidence else None,
    )
    return DiagnosticsResponse(
        id=identity,
        organization_id=organization_id,
        artifact_kind="RUN" if history else "MODEL_VERSION",
        content_hash=history.content_hash if history else model.content_hash,
        model_version_id=model.id,
        model_content_hash=model.content_hash,
        report=report,
    )
