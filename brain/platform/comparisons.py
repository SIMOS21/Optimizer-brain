"""Authorized read-only reconstruction for the pure scenario comparison engine."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from brain.organization.composition import canonical_json, checksum
from brain.scenario_comparison import ComparisonInput, ComparisonReport, compare_runs
from . import scenarios, service
from .models import OptimizationRun, ScenarioVersion, User
from .schemas import ScenarioResponse

logger = logging.getLogger(__name__)


def _input(session: Session, org: str, record: OptimizationRun) -> ComparisonInput:
    if record.organization_id != org or checksum(record.payload) != record.content_hash:
        raise service.ServiceError(409, "Intégrité du run invalide")
    model, composition, graph = scenarios._checked_model(session, org, record.model_version_id)
    if model.state != "PUBLISHED":
        raise service.ServiceError(409, "Un run historique doit référencer un modèle publié")
    current = model
    seen: set[str] = set()
    leaf: ScenarioResponse | None = None
    while True:
        if current.id in seen or len(seen) >= 16:
            raise service.ServiceError(409, "Filiation de référence cyclique ou trop profonde")
        seen.add(current.id)
        scenario = session.scalar(
            select(ScenarioVersion).where(
                ScenarioVersion.organization_id == org,
                ScenarioVersion.model_version_id == current.id,
            )
        )
        if scenario is None:
            break
        # Historical integrity only: revoked policy owners do not erase access
        # to immutable results for an otherwise authorized current reader.
        view = scenarios.scenario_view(session, org, scenario)
        if leaf is None:
            leaf = view
            if view.document.scenario_id != composition.ir.scenario_id:
                raise service.ServiceError(409, "Scénario du run incompatible")
        current, _, _ = scenarios._checked_model(session, org, scenario.source_model_version_id)
        if current.state != "PUBLISHED":
            raise service.ServiceError(409, "Référence historique non publiée")
    return ComparisonInput(
        organization_id=org,
        run_id=record.id,
        record_status=record.status,
        content_hash=record.content_hash,
        document_json=record.payload,
        created_at=record.created_at,
        created_by=record.created_by,
        model_version_id=model.id,
        model_content_hash=model.content_hash,
        graph_snapshot_id=graph.id,
        graph_content_hash=graph.content_hash,
        reference_model_version_id=current.id,
        reference_content_hash=current.content_hash,
        composition=composition,
        scenario_version_id=leaf.id if leaf else None,
        scenario_content_hash=leaf.content_hash if leaf else None,
        scenario_name=leaf.document.name if leaf else None,
        assumptions_json=canonical_json(leaf.document.changes if leaf else ()),
    )


def compare_artifacts(
    session: Session,
    actor: User,
    organization_id: str,
    baseline_run_id: str | None,
    candidate_run_id: str | None,
) -> ComparisonReport:
    service.tenant(session, actor, organization_id)
    identities = {key for key in (baseline_run_id, candidate_run_id) if key is not None}
    rows = (
        {
            record.id: record
            for record in session.scalars(
                select(OptimizationRun).where(
                    OptimizationRun.organization_id == organization_id,
                    OptimizationRun.id.in_(identities),
                )
            )
        }
        if identities
        else {}
    )
    # Authorize BOTH inputs before reading any evidence. Unknown and foreign IDs
    # return the same response, even for an actor belonging to both tenants.
    if rows.keys() != identities:
        raise service.ServiceError(
            404, "Runs introuvables ou inaccessibles ; un scénario doit posséder un run enregistré"
        )
    try:
        inputs = {key: _input(session, organization_id, rows[key]) for key in sorted(identities)}
        result = compare_runs(
            organization_id,
            inputs.get(baseline_run_id or ""),
            inputs.get(candidate_run_id or ""),
        )
    except service.ServiceError:
        raise
    except (ValueError, KeyError, TypeError) as exc:
        raise service.ServiceError(
            409, "Intégrité ou reconstruction des artefacts de comparaison incompatible"
        ) from exc
    logger.info(
        "scenario.comparison actor=%s organization=%s baseline=%s candidate=%s report=%s qualification=%s",
        actor.id,
        organization_id,
        baseline_run_id,
        candidate_run_id,
        result.report_hash,
        result.comparability,
    )
    return result
