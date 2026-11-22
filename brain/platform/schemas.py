"""Versioned frontend-facing contracts; no arbitrary user/tenant identity fields."""

from typing import Annotated, Generic, Literal, TypeVar
from pydantic import Field, JsonValue, SecretStr, StringConstraints
from brain.constraint_diagnostics import DiagnosticsReport
from brain.kernel.schema import Identifier, ModelDSL, Parameter, StrictModel, Text
from brain.organization.schema import OrganizationGraph, OrganizationModel
from brain.solvers.contracts import SolveSettings

Role = Literal["ADMIN", "BUILDER", "APPROVER", "VIEWER"]


class LoginRequest(StrictModel):
    username: Annotated[str, StringConstraints(min_length=3, max_length=128)]
    password: SecretStr = Field(min_length=1, max_length=1024)


class OrganizationCreate(StrictModel):
    key: Identifier
    name: Text


class MembershipSet(StrictModel):
    user_id: Annotated[str, StringConstraints(min_length=36, max_length=36)]
    role: Role
    active: bool = True


class DepartmentCreate(StrictModel):
    key: Identifier
    name: Text
    owner_user_id: str | None = None


class GraphCreate(StrictModel):
    graph: OrganizationGraph
    shared_parameters: dict[Identifier, Parameter]


class ModelCreate(StrictModel):
    graph_snapshot_id: str
    model: OrganizationModel


Item = TypeVar("Item")


class Page(StrictModel, Generic[Item]):
    items: list[Item]
    limit: int
    offset: int


class TokenResponse(StrictModel):
    access_token: str
    token_type: Literal["bearer"]
    expires_at: int


class UserResponse(StrictModel):
    id: str
    username: str
    display_name: str


class OrganizationResponse(StrictModel):
    id: str
    key: str
    name: str
    role: Role


class MembershipResponse(StrictModel):
    user_id: str
    organization_id: str
    role: Role
    active: bool


class DepartmentResponse(StrictModel):
    id: str
    key: str
    name: str
    owner_user_id: str | None


class ArtifactMetadata(StrictModel):
    id: str
    organization_id: str
    created_at: int
    created_by: str
    content_hash: str
    key: str | None = None
    version: str | None = None
    state: Literal["DRAFT", "PUBLISHED"] | None = None
    published_by: str | None = None
    published_at: int | None = None
    graph_snapshot_id: str | None = None
    model_hash: str | None = None
    data_snapshot_id: str | None = None
    model_version_id: str | None = None
    status: str | None = None


class ArtifactResponse(ArtifactMetadata):
    document: JsonValue = None


class ConstraintTraceDocument(StrictModel):
    constraint_id: str
    owner_department: str
    fragment_ids: list[str]
    contribution_ids: list[str]
    parameter_ids: list[str]
    resource_id: str | None
    source_paths: list[str]


class ResourceTraceDocument(StrictModel):
    resource_id: str
    parameter_id: str
    constraint_id: str | None
    fragment_ids: list[str]
    contribution_ids: list[str]


class CompositionDocument(StrictModel):
    organization_model: OrganizationModel
    dsl: ModelDSL
    ir: dict[str, JsonValue]
    model_hash: str
    model_manifest_hash: str
    composition_manifest_hash: str
    constraint_traces: list[ConstraintTraceDocument]
    resource_traces: list[ResourceTraceDocument]


class RunDocument(StrictModel):
    solve: dict[str, JsonValue]
    report: dict[str, JsonValue]


class GraphArtifactResponse(ArtifactMetadata):
    document: GraphCreate


class ModelArtifactResponse(ArtifactMetadata):
    document: CompositionDocument


class RunArtifactResponse(ArtifactMetadata):
    document: RunDocument


class OptimizationJobCreate(StrictModel):
    settings: SolveSettings = Field(default_factory=SolveSettings)


class OptimizationJobResponse(StrictModel):
    id: str
    organization_id: str
    model_version_id: str
    created_by: str
    state: Literal["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]
    settings: SolveSettings
    solver_status: str | None
    run_id: str | None
    error_code: str | None
    cancel_requested: bool
    attempt_number: int
    created_at: int
    updated_at: int
    started_at: int | None
    finished_at: int | None


class AuditResponse(StrictModel):
    id: str
    actor_id: str
    action: str
    target_id: str
    created_at: int


class DiagnosticsResponse(StrictModel):
    id: str
    organization_id: str
    artifact_kind: Literal["MODEL_VERSION", "RUN"]
    content_hash: str
    model_version_id: str
    model_content_hash: str
    report: DiagnosticsReport
