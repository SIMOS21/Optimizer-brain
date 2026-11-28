"""Read-only artifact explanations with durable, cross-process outbound quotas."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from brain.llm_gateway.context import build_context
from brain.llm_gateway.contracts import ExplanationPreview, ExplanationSelection
from brain.llm_gateway.provider import GatewayError, NvidiaSettings
from . import service
from .comparisons import compare_artifacts
from .database import database_now
from .models import AuditEvent, User


def preview_artifacts(
    session: Session,
    actor: User,
    org: str,
    selection: ExplanationSelection,
    settings: NvidiaSettings,
) -> ExplanationPreview:
    # Self-comparison reuses the exact historical reconstruction and verifier path.
    report = compare_artifacts(
        session, actor, org, selection.baseline_run_id or selection.run_id, selection.run_id
    )
    return build_context(report, selection, settings)


def reserve_call(
    session: Session, actor: User, org: str, settings: NvidiaSettings, preview: ExplanationPreview
) -> None:
    # Serializes quota reservations across API instances on PostgreSQL, not a process-local counter.
    scope = service.tenant(session, actor, org, lock=True)
    instant = database_now(session)
    calls = (
        session.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(
                AuditEvent.organization_id == org,
                AuditEvent.action == "llm.request.reserved",
                AuditEvent.created_at >= instant - 3600,
            )
        )
        or 0
    )
    if calls >= settings.calls_per_hour:
        raise GatewayError("LLM_QUOTA_EXCEEDED", 429)
    session.add(
        AuditEvent(
            organization_id=org,
            actor_id=scope.user_id,
            action="llm.request.reserved",
            target_id=preview.context_hash,
            created_at=instant,
        )
    )
    # Commit BEFORE external I/O. Failures/disconnects consume the reservation;
    # rollback of the HTTP response cannot erase usage and bypass the quota.
    session.commit()
