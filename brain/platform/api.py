"""Secure phase 4A ASGI app. The legacy demo remains a separate entry point."""

from collections.abc import AsyncIterator, Callable, Coroutine, Iterator
from contextlib import asynccontextmanager
from decimal import Decimal
import json
from threading import BoundedSemaphore
from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.responses import Response

from brain.kernel.schema import _invalid_constant, _unique_object
from brain.organization.composition import checksum
from . import auth, service, scenarios, change_policies, scenario_changes
from .change_contracts import (
    ChangePolicyCreate,
    ChangePolicyResponse,
    ExpectedPolicy,
    ChangeTargetsResponse,
    ChangePreview,
    ControlledProposal,
    ControlledCommit,
)
from .change_errors import ChangeError, ChangeErrorResponse
from .models import ScenarioChangePolicy
from .diagnostics import artifact_diagnostics
from .comparisons import compare_artifacts
from .explanations import preview_artifacts, reserve_call
from brain.llm_gateway.contracts import (
    ExplanationSelection,
    ExplanationRequest,
    ExplanationPreview,
    ExplanationResponse,
)
from brain.llm_gateway.provider import (
    GatewayError,
    NvidiaSettings,
    NvidiaProvider,
    ExplanationProvider,
)
from brain.llm_gateway.context import render_explanation
from brain.scenario_comparison import ComparisonReport
from .database import SCHEMA_REVISION, Settings, make_engine, sessions
from .models import (
    AuditEvent,
    Department,
    GraphSnapshot,
    Membership,
    ModelVersion,
    OptimizationJob,
    OptimizationRun,
    Organization,
    User,
)
from .schemas import (
    ArtifactResponse,
    GraphArtifactResponse,
    ModelArtifactResponse,
    RunArtifactResponse,
    ComparisonSelection,
    AuditResponse,
    DepartmentCreate,
    DepartmentResponse,
    DiagnosticsResponse,
    ScenarioCreate,
    ScenarioResponse,
    GraphCreate,
    LoginRequest,
    MembershipSet,
    MembershipResponse,
    ModelCreate,
    OptimizationJobCreate,
    OptimizationJobResponse,
    OrganizationCreate,
    OrganizationResponse,
    Page,
    TokenResponse,
    UserResponse,
)


class PreciseRequest(Request):
    async def json(self) -> Any:
        body = await self.body()
        if len(body) > 10 * 1024 * 1024:
            raise HTTPException(413, "Requête au-delà de 10 MiB")
        return json.loads(
            body,
            parse_float=Decimal,
            parse_constant=_invalid_constant,
            object_pairs_hook=_unique_object,
        )


class SecureJSONRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            precise = PreciseRequest(request.scope, request.receive)
            if request.method in ("POST", "PATCH", "PUT") and await precise.body():
                try:
                    await precise.json()
                except ValueError as exc:
                    raise HTTPException(422, "JSON invalide") from exc
            try:
                return await original(precise)
            except RequestValidationError as exc:
                raise HTTPException(
                    422,
                    [{key: error[key] for key in ("loc", "type", "msg")} for error in exc.errors()],
                ) from exc
            except ChangeError as exc:
                raise HTTPException(exc.status, {"code": exc.code}) from exc
            except GatewayError as exc:
                raise HTTPException(exc.status, {"code": exc.code}) from None
            except service.ServiceError as exc:
                raise HTTPException(exc.status, str(exc)) from exc
            except IntegrityError as exc:
                raise HTTPException(409, "Conflit d'identité, de version ou de référence") from exc
            except ValueError as exc:
                raise HTTPException(422, "Document ou paramètres invalides") from exc

        return handler


def db(request: Request) -> Iterator[Session]:
    session: Session = request.app.state.session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# Commit/rollback before sending any success response. Request-scoped yield
# cleanup happens after the body, allowing an immediate GET/worker to miss an
# acknowledged write (and making a failed commit too late to reject success).
DB = Annotated[Session, Depends(db, scope="function")]
bearer = HTTPBearer(auto_error=False)


def current_user(
    session: DB, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
) -> User:
    try:
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise auth.AuthenticationError()
        return auth.authenticate(session, credentials.credentials)
    except auth.AuthenticationError as exc:
        raise HTTPException(
            401, "Authentification requise", headers={"WWW-Authenticate": "Bearer"}
        ) from exc


Actor = Annotated[User, Depends(current_user)]
CHANGE_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": ChangeErrorResponse, "description": description}
    for status, description in (
        (403, "Forbidden controlled change"),
        (409, "Controlled change conflict"),
        (422, "Invalid controlled change"),
    )
}

router = APIRouter(prefix="/api/v1", route_class=SecureJSONRoute)


@router.post(
    "/organizations/{organization_id}/assistant/preview", response_model=ExplanationPreview
)
def explanation_preview(
    organization_id: str, body: ExplanationSelection, actor: Actor, session: DB, request: Request
) -> ExplanationPreview:
    return preview_artifacts(
        session, actor, organization_id, body, request.app.state.nvidia_settings
    )


@router.post(
    "/organizations/{organization_id}/assistant/explain", response_model=ExplanationResponse
)
def explain_artifacts(
    organization_id: str,
    body: ExplanationRequest,
    actor: Actor,
    session: DB,
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> ExplanationResponse:
    selection = ExplanationSelection(
        run_id=body.run_id, baseline_run_id=body.baseline_run_id, intent=body.intent
    )
    settings: NvidiaSettings = request.app.state.nvidia_settings
    preview = preview_artifacts(session, actor, organization_id, selection, settings)
    if not preview.enabled:
        raise GatewayError(
            "LLM_" + preview.availability, 403 if preview.availability == "NOT_AUTHORIZED" else 503
        )
    if preview.context_hash != body.context_hash:
        raise GatewayError("LLM_CONTEXT_CHANGED", 409)
    slots: BoundedSemaphore = request.app.state.explanation_slots
    if not slots.acquire(blocking=False):
        raise GatewayError("LLM_BUSY", 429)
    try:
        reserve_call(session, actor, organization_id, settings, preview)
        provider: ExplanationProvider = request.app.state.explanation_provider
        response = render_explanation(preview, provider.complete(preview.outbound_json))
    finally:
        slots.release()
    # Revocations/expiry during a slow hosted request must not return a protected result.
    session.expire_all()
    try:
        if credentials is None:
            raise auth.AuthenticationError()
        current = auth.authenticate(session, credentials.credentials)
    except auth.AuthenticationError:
        raise HTTPException(401, "Authentification requise") from None
    service.tenant(session, current, organization_id)
    return response


def artifact_view(
    record: GraphSnapshot | ModelVersion | OptimizationRun, *, detail: bool = False
) -> dict[str, object]:
    if checksum(record.payload) != record.content_hash:
        raise service.ServiceError(409, "Intégrité de l'artefact invalide")
    view: dict[str, object] = {
        "id": record.id,
        "organization_id": record.organization_id,
        "created_at": record.created_at,
        "created_by": record.created_by,
        "content_hash": record.content_hash,
    }
    if isinstance(record, (GraphSnapshot, ModelVersion)):
        view.update(
            key=record.key,
            version=record.version,
            state=record.state,
            published_by=record.published_by,
            published_at=record.published_at,
        )
    else:
        view.update(status=record.status, model_version_id=record.model_version_id)
    if isinstance(record, ModelVersion):
        view.update(
            model_hash=record.model_hash,
            data_snapshot_id=record.data_snapshot_id,
            graph_snapshot_id=record.graph_snapshot_id,
        )
    if detail:
        view["document"] = json.loads(record.payload)
    return view


def optimization_job_view(record: OptimizationJob) -> dict[str, object]:
    return {
        "id": record.id,
        "organization_id": record.organization_id,
        "model_version_id": record.model_version_id,
        "created_by": record.created_by,
        "state": record.state,
        "settings": json.loads(record.settings),
        "solver_status": record.solver_status,
        "run_id": record.run_id,
        "error_code": record.error_code,
        "cancel_requested": record.cancel_requested_at is not None,
        "attempt_number": record.attempt_number,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "started_at": record.started_at,
        "finished_at": record.finished_at,
    }


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, session: DB, request: Request) -> object:
    try:
        issued = auth.login(
            session,
            body.username,
            body.password.get_secret_value(),
            lifetime=request.app.state.settings.session_seconds,
        )
    except ValueError:
        issued = None
    session.commit()  # Failed-attempt counters must survive the 401 response.
    if issued is None:
        raise HTTPException(401, "Identifiants invalides", headers={"WWW-Authenticate": "Bearer"})
    return {
        "access_token": issued.access_token,
        "token_type": "bearer",
        "expires_at": issued.expires_at,
    }


@router.post("/auth/logout", status_code=204)
def logout(
    session: DB,
    actor: Actor,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Response:
    assert credentials is not None
    auth.logout(session, credentials.credentials)
    return Response(status_code=204)


@router.get("/auth/me", response_model=UserResponse)
def me(actor: Actor) -> object:
    return {"id": actor.id, "username": actor.username, "display_name": actor.display_name}


@router.post("/organizations", status_code=201, response_model=OrganizationResponse)
def organization_create(body: OrganizationCreate, session: DB, actor: Actor) -> object:
    record = service.create_organization(session, actor, body)
    return {"id": record.id, "key": record.key, "name": record.name, "role": "ADMIN"}


Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/organizations", response_model=Page[OrganizationResponse])
def organizations(session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0) -> object:
    records = session.execute(
        select(Organization, Membership.role)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == actor.id, Membership.active.is_(True))
        .order_by(Organization.id)
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [
            {"id": record.id, "key": record.key, "name": record.name, "role": role}
            for record, role in records
        ],
        "limit": limit,
        "offset": offset,
    }


@router.get("/organizations/{organization_id}", response_model=OrganizationResponse)
def organization_get(organization_id: str, session: DB, actor: Actor) -> object:
    scope = service.tenant(session, actor, organization_id)
    record = session.get(Organization, organization_id)
    assert record is not None
    return {"id": record.id, "key": record.key, "name": record.name, "role": scope.role}


@router.put("/organizations/{organization_id}/memberships", response_model=MembershipResponse)
def membership_set(organization_id: str, body: MembershipSet, session: DB, actor: Actor) -> object:
    record = service.set_membership(session, actor, organization_id, body)
    return {
        "user_id": record.user_id,
        "organization_id": record.organization_id,
        "role": record.role,
        "active": record.active,
    }


@router.get("/organizations/{organization_id}/memberships", response_model=Page[MembershipResponse])
def memberships(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id)
    return {
        "items": [
            {
                "user_id": member.user_id,
                "organization_id": member.organization_id,
                "role": member.role,
                "active": member.active,
            }
            for member in session.scalars(
                select(Membership)
                .where(Membership.organization_id == organization_id)
                .order_by(Membership.user_id)
                .limit(limit)
                .offset(offset)
            )
        ],
        "limit": limit,
        "offset": offset,
    }


@router.post(
    "/organizations/{organization_id}/departments",
    status_code=201,
    response_model=DepartmentResponse,
)
def department_create(
    organization_id: str, body: DepartmentCreate, session: DB, actor: Actor
) -> object:
    record = service.create_department(session, actor, organization_id, body)
    return {
        "id": record.id,
        "key": record.key,
        "name": record.name,
        "owner_user_id": record.owner_user_id,
    }


@router.get("/organizations/{organization_id}/departments", response_model=Page[DepartmentResponse])
def departments(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id)
    return {
        "items": [
            {"id": d.id, "key": d.key, "name": d.name, "owner_user_id": d.owner_user_id}
            for d in session.scalars(
                select(Department)
                .where(Department.organization_id == organization_id)
                .order_by(Department.id)
                .limit(limit)
                .offset(offset)
            )
        ],
        "limit": limit,
        "offset": offset,
    }


@router.post(
    "/organizations/{organization_id}/graphs", status_code=201, response_model=GraphArtifactResponse
)
def graph_create(organization_id: str, body: GraphCreate, session: DB, actor: Actor) -> object:
    return artifact_view(service.create_graph(session, actor, organization_id, body), detail=True)


@router.get("/organizations/{organization_id}/graphs", response_model=Page[ArtifactResponse])
def graphs(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id)
    return {
        "items": [
            artifact_view(r)
            for r in session.scalars(
                select(GraphSnapshot)
                .where(GraphSnapshot.organization_id == organization_id)
                .order_by(GraphSnapshot.id)
                .limit(limit)
                .offset(offset)
            )
        ],
        "limit": limit,
        "offset": offset,
    }


@router.get(
    "/organizations/{organization_id}/graphs/{identity}", response_model=GraphArtifactResponse
)
def graph_get(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    service.tenant(session, actor, organization_id)
    return artifact_view(service.get_graph(session, organization_id, identity), detail=True)


@router.post(
    "/organizations/{organization_id}/graphs/{identity}/publish",
    response_model=GraphArtifactResponse,
)
def graph_publish(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    return artifact_view(
        service.publish(session, actor, organization_id, identity, model=False), detail=True
    )


@router.post(
    "/organizations/{organization_id}/model-versions",
    status_code=201,
    response_model=ModelArtifactResponse,
)
def model_create(organization_id: str, body: ModelCreate, session: DB, actor: Actor) -> object:
    return artifact_view(service.create_model(session, actor, organization_id, body), detail=True)


@router.get(
    "/organizations/{organization_id}/model-versions", response_model=Page[ArtifactResponse]
)
def models(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id)
    return {
        "items": [
            artifact_view(r)
            for r in session.scalars(
                select(ModelVersion)
                .where(ModelVersion.organization_id == organization_id)
                .order_by(ModelVersion.id)
                .limit(limit)
                .offset(offset)
            )
        ],
        "limit": limit,
        "offset": offset,
    }


@router.get(
    "/organizations/{organization_id}/model-versions/{identity}",
    response_model=ModelArtifactResponse,
)
def model_get(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    service.tenant(session, actor, organization_id)
    return artifact_view(service.get_model(session, organization_id, identity), detail=True)


@router.get(
    "/organizations/{organization_id}/model-versions/{identity}/diagnostics",
    response_model=DiagnosticsResponse,
)
def model_diagnostics(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    return artifact_diagnostics(session, actor, organization_id, identity, run=False)


@router.post(
    "/organizations/{organization_id}/model-versions/{identity}/publish",
    response_model=ModelArtifactResponse,
)
def model_publish(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    return artifact_view(
        service.publish(session, actor, organization_id, identity, model=True), detail=True
    )


@router.post(
    "/organizations/{organization_id}/model-versions/{identity}/optimization-jobs",
    status_code=202,
    response_model=OptimizationJobResponse,
)
def optimization_job_create(
    organization_id: str,
    identity: str,
    body: OptimizationJobCreate,
    session: DB,
    actor: Actor,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)],
) -> object:
    job = service.create_optimization_job(
        session, actor, organization_id, identity, idempotency_key, body
    )
    return optimization_job_view(job)


@router.get(
    "/organizations/{organization_id}/optimization-jobs",
    response_model=Page[OptimizationJobResponse],
)
def optimization_jobs(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id)
    records = session.scalars(
        select(OptimizationJob)
        .where(OptimizationJob.organization_id == organization_id)
        .order_by(OptimizationJob.created_at.desc(), OptimizationJob.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [optimization_job_view(record) for record in records],
        "limit": limit,
        "offset": offset,
    }


@router.get(
    "/organizations/{organization_id}/optimization-jobs/{identity}",
    response_model=OptimizationJobResponse,
)
def optimization_job_get(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    service.tenant(session, actor, organization_id)
    return optimization_job_view(service.get_optimization_job(session, organization_id, identity))


@router.post(
    "/organizations/{organization_id}/optimization-jobs/{identity}/cancel",
    response_model=OptimizationJobResponse,
)
def optimization_job_cancel(
    organization_id: str, identity: str, session: DB, actor: Actor
) -> object:
    job = service.request_optimization_job_cancellation(session, actor, organization_id, identity)
    return optimization_job_view(job)


@router.get(
    "/organizations/{organization_id}/optimization-runs", response_model=Page[ArtifactResponse]
)
def runs(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id)
    return {
        "items": [
            artifact_view(r)
            for r in session.scalars(
                select(OptimizationRun)
                .where(OptimizationRun.organization_id == organization_id)
                .order_by(OptimizationRun.id)
                .limit(limit)
                .offset(offset)
            )
        ],
        "limit": limit,
        "offset": offset,
    }


@router.get(
    "/organizations/{organization_id}/optimization-runs/{identity}",
    response_model=RunArtifactResponse,
)
def run_get(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    service.tenant(session, actor, organization_id)
    record = session.scalar(
        select(OptimizationRun).where(
            OptimizationRun.organization_id == organization_id, OptimizationRun.id == identity
        )
    )
    if record is None:
        raise service.ServiceError(404, "Run introuvable")
    return artifact_view(record, detail=True)


@router.get(
    "/organizations/{organization_id}/optimization-runs/{identity}/diagnostics",
    response_model=DiagnosticsResponse,
)
def run_diagnostics(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    return artifact_diagnostics(session, actor, organization_id, identity, run=True)


@router.get(
    "/organizations/{organization_id}/scenario-comparisons",
    response_model=ComparisonReport,
)
def scenario_comparison(
    organization_id: str,
    session: DB,
    actor: Actor,
    selection: Annotated[ComparisonSelection, Query()],
) -> object:
    return compare_artifacts(
        session, actor, organization_id, selection.baseline_run_id, selection.candidate_run_id
    )


@router.post(
    "/organizations/{organization_id}/scenarios", status_code=201, response_model=ScenarioResponse
)
def scenario_create(
    organization_id: str, body: ScenarioCreate, session: DB, actor: Actor
) -> object:
    return scenarios.create_scenario(session, actor, organization_id, body)


@router.get(
    "/organizations/{organization_id}/model-versions/{identity}/scenario-targets",
    response_model=ChangeTargetsResponse,
)
def scenario_targets(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    return change_policies.targets(session, actor, organization_id, identity)


@router.post(
    "/organizations/{organization_id}/scenario-change-policies",
    response_model=ChangePolicyResponse,
    status_code=201,
)
def change_policy_create(
    organization_id: str, body: ChangePolicyCreate, session: DB, actor: Actor
) -> object:
    return change_policies.create_policy(session, actor, organization_id, body)


@router.get(
    "/organizations/{organization_id}/scenario-change-policies",
    response_model=Page[ChangePolicyResponse],
)
def change_policy_list(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id)
    identities = session.scalars(
        select(ScenarioChangePolicy.id)
        .where(ScenarioChangePolicy.organization_id == organization_id)
        .order_by(ScenarioChangePolicy.key, ScenarioChangePolicy.version)
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [
            change_policies.policy_view(session, organization_id, identity)
            for identity in identities
        ],
        "limit": limit,
        "offset": offset,
    }


@router.get(
    "/organizations/{organization_id}/scenario-change-policies/{identity}",
    response_model=ChangePolicyResponse,
)
def change_policy_get(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    service.tenant(session, actor, organization_id)
    return change_policies.policy_view(session, organization_id, identity)


@router.post(
    "/organizations/{organization_id}/scenario-change-policies/{identity}/owner-approval",
    response_model=ChangePolicyResponse,
)
def change_policy_owner_approval(
    organization_id: str, identity: str, body: ExpectedPolicy, session: DB, actor: Actor
) -> object:
    return change_policies.approve_owner(session, actor, organization_id, identity, body)


@router.post(
    "/organizations/{organization_id}/scenario-change-policies/{identity}/publish",
    response_model=ChangePolicyResponse,
)
def change_policy_publish(
    organization_id: str, identity: str, body: ExpectedPolicy, session: DB, actor: Actor
) -> object:
    return change_policies.publish_policy(session, actor, organization_id, identity, body)


@router.post(
    "/organizations/{organization_id}/controlled-scenarios/preview",
    response_model=ChangePreview,
    responses=CHANGE_RESPONSES,
)
def controlled_scenario_preview(
    organization_id: str, body: ControlledProposal, session: DB, actor: Actor
) -> object:
    return scenario_changes.preview(session, actor, organization_id, body)


@router.post(
    "/organizations/{organization_id}/controlled-scenarios",
    status_code=201,
    response_model=ScenarioResponse,
)
def controlled_scenario_create(
    organization_id: str, body: ControlledCommit, session: DB, actor: Actor
) -> object:
    return scenario_changes.create_controlled(session, actor, organization_id, body)


@router.get("/organizations/{organization_id}/scenarios", response_model=Page[ScenarioResponse])
def scenario_list(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    return scenarios.list_scenarios(session, actor, organization_id, limit, offset)


@router.get(
    "/organizations/{organization_id}/scenarios/{identity}", response_model=ScenarioResponse
)
def scenario_get(organization_id: str, identity: str, session: DB, actor: Actor) -> object:
    return scenarios.get_scenario(session, actor, organization_id, identity)


@router.get("/organizations/{organization_id}/audit-events", response_model=Page[AuditResponse])
def audit_events(
    organization_id: str, session: DB, actor: Actor, limit: Limit = 50, offset: Offset = 0
) -> object:
    service.tenant(session, actor, organization_id, roles=("ADMIN", "APPROVER"))
    return {
        "items": [
            {
                "id": r.id,
                "actor_id": r.actor_id,
                "action": r.action,
                "target_id": r.target_id,
                "created_at": r.created_at,
            }
            for r in session.scalars(
                select(AuditEvent)
                .where(AuditEvent.organization_id == organization_id)
                .order_by(AuditEvent.created_at, AuditEvent.id)
                .limit(limit)
                .offset(offset)
            )
        ],
        "limit": limit,
        "offset": offset,
    }


def create_app(
    settings: Settings | None = None,
    *,
    nvidia_settings: NvidiaSettings | None = None,
    explanation_provider: ExplanationProvider | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    engine = make_engine(settings)
    if engine.dialect.name == "postgresql":
        with engine.connect() as connection:
            role = connection.execute(
                text("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")
            ).one()
            if role[0] or role[1]:
                engine.dispose()
                raise ValueError("L'API refuse un rôle PostgreSQL superuser/BYPASSRLS")
            revision = (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            )
            if revision != [SCHEMA_REVISION]:
                engine.dispose()
                raise ValueError(f"Migration {SCHEMA_REVISION} requise avant le démarrage")
            if connection.scalar(
                text("SELECT has_table_privilege(current_user, 'graph_snapshots', 'TRUNCATE')")
            ) or connection.scalar(
                text("SELECT has_table_privilege(current_user, 'optimization_jobs', 'TRUNCATE')")
            ):
                engine.dispose()
                raise ValueError("Le rôle de l'API ne doit pas pouvoir tronquer l'historique")

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="Optimization Brain Governance API", version="0.4c.0", lifespan=lifespan)
    app.state.engine, app.state.settings, app.state.session_factory = (
        engine,
        settings,
        sessions(engine),
    )
    app.state.nvidia_settings = nvidia_settings or NvidiaSettings.from_env()
    app.state.explanation_provider = explanation_provider or NvidiaProvider(
        app.state.nvidia_settings
    )
    app.state.explanation_slots = BoundedSemaphore(4)
    app.include_router(router)

    @app.middleware("http")
    async def headers(
        request: Request, call_next: Callable[[Request], Coroutine[Any, Any, Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health")
    def health() -> object:
        return {"status": "ok", "phase": "4C", "llm_required": False}

    return app
