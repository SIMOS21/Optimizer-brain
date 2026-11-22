"""First Scenario Lab slice: immutable identical clones through existing governance."""

import json
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from brain.organization import Composition, compose_organization_model
from brain.organization.composition import canonical_json, checksum
from . import service
from .models import GraphSnapshot, ModelVersion, ScenarioVersion, User, new_id
from .schemas import ModelCreate, ScenarioCreate, ScenarioDocument, ScenarioResponse


def _checked_model(
    session: Session, organization_id: str, identity: str
) -> tuple[ModelVersion, Composition, GraphSnapshot]:
    model = service.get_model(session, organization_id, identity)
    composition = compose_organization_model(json.loads(model.payload)["organization_model"])
    ir = composition.ir
    if canonical_json(composition.to_dict()) != model.payload or (
        model.key,
        model.version,
        model.model_hash,
        model.data_snapshot_id,
    ) != (ir.model_id, ir.model_version, ir.model_hash, ir.data_snapshot_id):
        raise service.ServiceError(409, "Reconstruction du modèle historique incompatible")
    graph = service.get_graph(session, organization_id, model.graph_snapshot_id)
    if graph.state != "PUBLISHED" or graph.payload != service.graph_document(
        composition.source.graph, composition.source.shared_parameters
    ):
        raise service.ServiceError(409, "Snapshot du modèle incompatible")
    return model, composition, graph


def _clone(composition: Composition, scenario_identity: str) -> dict[str, object]:
    source: dict[str, object] = json.loads(composition.source_json)
    # Only identity metadata changes; parameters, constraints and snapshot stay exact.
    source["model_version"] = scenario_identity
    source["scenario_id"] = scenario_identity
    return source


def scenario_view(
    session: Session, organization_id: str, record: ScenarioVersion
) -> ScenarioResponse:
    if record.organization_id != organization_id or checksum(record.payload) != record.content_hash:
        raise service.ServiceError(409, "Intégrité du scénario invalide")
    document = ScenarioDocument.model_validate_json(record.payload)
    source, composition, graph = _checked_model(
        session, organization_id, record.source_model_version_id
    )
    derived, derived_composition, _ = _checked_model(
        session, organization_id, record.model_version_id
    )
    identity = "scenario_" + record.id.replace("-", "")
    if (
        source.state != "PUBLISHED"
        or (
            document.id,
            document.organization_id,
            document.key,
            document.version,
            document.author_id,
            document.source_model_version_id,
            document.model_version_id,
            document.graph_snapshot_id,
            document.data_snapshot_id,
            document.source_content_hash,
            document.model_content_hash,
            document.graph_content_hash,
            document.scenario_id,
        )
        != (
            record.id,
            organization_id,
            record.key,
            record.version,
            record.created_by,
            source.id,
            derived.id,
            record.graph_snapshot_id,
            record.data_snapshot_id,
            source.content_hash,
            derived.content_hash,
            graph.content_hash,
            identity,
        )
        or graph.id != record.graph_snapshot_id
        or derived.graph_snapshot_id != graph.id
        or source.data_snapshot_id != record.data_snapshot_id
        or derived.data_snapshot_id != record.data_snapshot_id
        or canonical_json(_clone(composition, identity)) != derived_composition.source_json
        or source.model_hash != derived.model_hash
    ):
        raise service.ServiceError(409, "Provenance du scénario incompatible")
    state: Literal["DRAFT", "PUBLISHED"]
    if derived.state == "DRAFT":
        state = "DRAFT"
    elif derived.state == "PUBLISHED":
        state = "PUBLISHED"
    else:
        raise service.ServiceError(409, "État du modèle dérivé incompatible")
    return ScenarioResponse(
        id=record.id,
        organization_id=organization_id,
        key=record.key,
        version=record.version,
        created_by=record.created_by,
        created_at=record.created_at,
        content_hash=record.content_hash,
        model_version_id=derived.id,
        source_model_version_id=source.id,
        model_state=state,
        document=document,
    )


def create_scenario(
    session: Session, actor: User, organization_id: str, body: ScenarioCreate
) -> ScenarioResponse:
    scope = service.tenant(session, actor, organization_id, roles=("ADMIN", "BUILDER"), lock=True)
    source, composition, graph = _checked_model(
        session, organization_id, body.source_model_version_id
    )
    if source.state != "PUBLISHED":
        raise service.ServiceError(409, "Référence publiée requise")
    if source.content_hash != body.expected_source_content_hash:
        raise service.ServiceError(409, "Empreinte de référence différente ; recharger le modèle")
    request_hash = checksum(canonical_json({"request": body, "author_id": actor.id}))
    family = session.scalars(
        select(ScenarioVersion).where(
            ScenarioVersion.organization_id == organization_id, ScenarioVersion.key == body.key
        )
    ).all()
    for existing in family:
        if existing.source_model_version_id != source.id:
            raise service.ServiceError(409, "Une famille de scénarios conserve sa référence")
        if existing.version == body.version:
            if existing.request_hash != request_hash:
                raise service.ServiceError(
                    409, "Version existante avec un contenu ou auteur différent"
                )
            return scenario_view(session, organization_id, existing)
    identity = new_id()
    scenario_identity = "scenario_" + identity.replace("-", "")
    # Reuse existing compilation, publication boundary and organization registry checks.
    derived = service.create_model(
        session,
        actor,
        organization_id,
        ModelCreate.model_validate(
            {"graph_snapshot_id": graph.id, "model": _clone(composition, scenario_identity)}
        ),
    )
    if derived.id == source.id or derived.model_hash != source.model_hash:
        raise service.ServiceError(409, "Le clone doit rester mathématiquement identique et isolé")
    document = ScenarioDocument(
        id=identity,
        organization_id=organization_id,
        key=body.key,
        version=body.version,
        name=body.name,
        reason=body.reason,
        author_id=actor.id,
        source_model_version_id=source.id,
        source_content_hash=source.content_hash,
        model_version_id=derived.id,
        model_content_hash=derived.content_hash,
        graph_snapshot_id=graph.id,
        graph_content_hash=graph.content_hash,
        data_snapshot_id=source.data_snapshot_id,
        scenario_id=scenario_identity,
    )
    payload = canonical_json(document)
    record = ScenarioVersion(
        id=identity,
        organization_id=organization_id,
        key=body.key,
        version=body.version,
        source_model_version_id=source.id,
        model_version_id=derived.id,
        graph_snapshot_id=graph.id,
        data_snapshot_id=source.data_snapshot_id,
        request_hash=request_hash,
        payload=payload,
        content_hash=checksum(payload),
        created_by=actor.id,
    )
    session.add(record)
    service.audit(session, scope, "scenario.created", identity)
    session.flush()
    return scenario_view(session, organization_id, record)


def get_scenario(
    session: Session, actor: User, organization_id: str, identity: str
) -> ScenarioResponse:
    service.tenant(session, actor, organization_id)
    record = session.scalar(
        select(ScenarioVersion).where(
            ScenarioVersion.organization_id == organization_id, ScenarioVersion.id == identity
        )
    )
    if record is None:
        raise service.ServiceError(404, "Scénario introuvable")
    return scenario_view(session, organization_id, record)


def list_scenarios(
    session: Session, actor: User, organization_id: str, limit: int, offset: int
) -> dict[str, object]:
    service.tenant(session, actor, organization_id)
    records = session.scalars(
        select(ScenarioVersion)
        .where(ScenarioVersion.organization_id == organization_id)
        .order_by(ScenarioVersion.key, ScenarioVersion.version, ScenarioVersion.id)
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [scenario_view(session, organization_id, r) for r in records],
        "limit": limit,
        "offset": offset,
    }
