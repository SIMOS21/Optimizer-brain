"""Closed contracts for numeric scenario hypotheses, never executable patches."""

from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, field_serializer, model_validator

from brain.kernel.numbers import Number
from brain.kernel.schema import Identifier, StrictModel, Text, UnitModel

Hash = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]


class ChangeTarget(StrictModel):
    kind: Literal["SHARED_PARAMETER", "DEPARTMENT_PARAMETER", "RESOURCE_CAPACITY"]
    parameter_id: Identifier
    fragment_id: Identifier | None = None
    resource_id: Identifier | None = None
    path: Text


class ChangeRule(UnitModel):
    id: Identifier
    target: ChangeTarget
    operation: Literal["SET"] = "SET"
    domain: Literal["INTEGER", "DECIMAL"]
    minimum: Number
    maximum: Number
    owner_department: Identifier
    owner_user_id: str
    allowed_user_ids: Annotated[list[str], Field(min_length=1, max_length=100)]
    approval: Literal["OWNER_ACK_AND_PUBLICATION"] = "OWNER_ACK_AND_PUBLICATION"

    @field_serializer("minimum", "maximum")
    def exact_decimal(self, value: Decimal) -> str:
        return str(value)

    @model_validator(mode="after")
    def valid_range(self) -> Self:
        if self.minimum > self.maximum or len(set(self.allowed_user_ids)) != len(
            self.allowed_user_ids
        ):
            raise ValueError("Bornes ordonnées et utilisateurs autorisés distincts requis")
        if self.domain == "INTEGER" and any(
            v != v.to_integral_value() for v in (self.minimum, self.maximum)
        ):
            raise ValueError("Bornes entières requises")
        return self


class ChangePolicyCreate(StrictModel):
    key: Identifier
    version: Text
    name: Text
    reason: Text
    source_model_version_id: str
    expected_source_content_hash: Hash
    rules: Annotated[list[ChangeRule], Field(min_length=1, max_length=50)]


class ChangePolicyDocument(StrictModel):
    schema_version: Literal["5B.2"] = "5B.2"
    id: str
    organization_id: str
    author_id: str
    key: str
    version: str
    name: str
    reason: str
    source_model_version_id: str
    source_content_hash: str
    rules: list[ChangeRule]


class PolicyApprovalResponse(StrictModel):
    user_id: str
    created_at: int
    policy_content_hash: str


class ChangePolicyResponse(StrictModel):
    id: str
    organization_id: str
    key: str
    version: str
    created_by: str
    created_at: int
    content_hash: str
    state: Literal["DRAFT", "PUBLISHED"]
    published_by: str | None
    published_at: int | None
    document: ChangePolicyDocument
    approvals: list[PolicyApprovalResponse]
    usable: bool
    unavailability_reasons: list[str]


class ExpectedPolicy(StrictModel):
    expected_policy_content_hash: Hash


class RequestedChange(UnitModel):
    rule_id: Identifier
    operation: Literal["SET"] = "SET"
    value: Number
    source: Text


class ControlledProposal(StrictModel):
    key: Identifier
    version: Text
    name: Text
    reason: Text
    source_model_version_id: str
    expected_source_content_hash: Hash
    policy_version_id: str
    expected_policy_content_hash: Hash
    parent_scenario_id: str | None = None
    changes: Annotated[list[RequestedChange], Field(min_length=1, max_length=50)]


class ControlledCommit(StrictModel):
    proposal: ControlledProposal
    expected_preview_hash: Hash


class RecordedChange(StrictModel):
    rule_id: str
    target: ChangeTarget
    unit: str
    domain: Literal["INTEGER", "DECIMAL"]
    owner_department: str
    owner_user_id: str
    original_value: str
    previous_value: str
    proposed_value: str
    source: str
    changed_by: str


class ChangePreview(StrictModel):
    organization_id: str
    source_model_version_id: str
    source_content_hash: str
    policy_version_id: str
    policy_content_hash: str
    parent_scenario_id: str | None
    preview_hash: str
    model_hash: str
    changes: list[RecordedChange]
    affected_constraint_ids: list[str]
    affects_objective: bool
    creates_new_snapshot: Literal[True] = True
    requires_graph_publication: Literal[True] = True
    requires_model_publication: Literal[True] = True


class ControlledScenarioDocument(StrictModel):
    schema_version: Literal["5B.2"] = "5B.2"
    kind: Literal["CONTROLLED_CHANGES"] = "CONTROLLED_CHANGES"
    id: str
    organization_id: str
    key: str
    version: str
    name: str
    reason: str
    author_id: str
    source_model_version_id: str
    source_content_hash: str
    source_graph_snapshot_id: str
    source_data_snapshot_id: str
    model_version_id: str
    model_content_hash: str
    graph_snapshot_id: str
    graph_content_hash: str
    data_snapshot_id: str
    scenario_id: str
    policy_version_id: str
    policy_content_hash: str
    parent_scenario_id: str | None
    preview_hash: str
    changes: list[RecordedChange]


class ChangeTargetInfo(StrictModel):
    target: ChangeTarget
    unit: str
    value: str
    owner_department: str | None
    registered_owner_user_id: str | None
    affected_constraint_ids: list[str]
    affects_objective: bool


class ChangeTargetsResponse(StrictModel):
    organization_id: str
    source_model_version_id: str
    source_content_hash: str
    items: list[ChangeTargetInfo]
