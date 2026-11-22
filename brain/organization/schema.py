"""Strict organization/fragment contracts; visual edges never define equations."""

import json
from typing import Annotated, Literal

from pydantic import Field

from brain.kernel.schema import (
    Constraint,
    Identifier,
    Objective,
    Parameter,
    ParameterRef,
    Provenance,
    StrictModel,
    Term,
    Text,
    UnitModel,
    Variable,
    _invalid_constant,
    _unique_object,
)


class Organization(Provenance):
    id: Identifier
    name: Text
    data_snapshot_id: Text


class DepartmentNode(Provenance):
    id: Identifier
    name: Text
    owner_id: Text  # Descriptive identity, not authentication or a permission grant.


class ResourceNode(UnitModel, Provenance):
    id: Identifier
    name: Text
    capacity: ParameterRef
    capacity_version: Text
    owner_department: Identifier
    shared_with: Annotated[list[Identifier], Field(max_length=1000)] = Field(default_factory=list)
    constraint_id: Identifier


class DependencyEdge(StrictModel):
    id: Identifier
    source_id: Identifier
    target_id: Identifier
    type: Literal["DEPENDS_ON", "USES_RESOURCE"]


class OrganizationGraph(StrictModel):
    schema_version: Literal["1.0"]
    organization: Organization
    departments: Annotated[list[DepartmentNode], Field(min_length=1, max_length=1000)]
    resources: Annotated[list[ResourceNode], Field(max_length=10000)] = Field(default_factory=list)
    edges: Annotated[list[DependencyEdge], Field(max_length=10000)] = Field(default_factory=list)


class ParameterImport(UnitModel):
    parameter: Identifier
    version: Text
    owner_department: Identifier | None  # null = explicitly shared registry.


class VariableImport(UnitModel):
    variable: Identifier
    owner_department: Identifier
    declaration_version: Text  # Version of the declaring fragment.


class ResourceUse(Provenance):
    id: Identifier
    resource_id: Identifier
    terms: Annotated[list[Term], Field(max_length=10000)]


class DepartmentFragment(Provenance):
    id: Identifier
    organization_id: Identifier
    organization_version: Text
    department_id: Identifier
    department_version: Text
    parameters: Annotated[dict[Identifier, Parameter], Field(max_length=10000)] = Field(
        default_factory=dict
    )
    parameter_refs: Annotated[list[ParameterImport], Field(max_length=10000)] = Field(
        default_factory=list
    )
    variables: Annotated[list[Variable], Field(max_length=10000)] = Field(default_factory=list)
    variable_refs: Annotated[list[VariableImport], Field(max_length=10000)] = Field(
        default_factory=list
    )
    constraints: Annotated[list[Constraint], Field(max_length=10000)] = Field(default_factory=list)
    resource_uses: Annotated[list[ResourceUse], Field(max_length=10000)] = Field(
        default_factory=list
    )


class ModelHeader(StrictModel):
    schema_version: Literal["1.0"]
    model_id: Identifier
    model_name: Text
    model_version: Text
    scenario_id: Identifier
    currency: Literal["EUR", "MAD", "USD"] | None = None
    dimensions: dict[Identifier, list[Identifier]] = Field(default_factory=dict)
    shared_parameters: Annotated[dict[Identifier, Parameter], Field(max_length=10000)] = Field(
        default_factory=dict
    )
    objective: Objective  # Exactly one global objective; no implicit departmental weighting.


class OrganizationModel(ModelHeader):
    graph: OrganizationGraph
    fragments: Annotated[list[DepartmentFragment], Field(min_length=1, max_length=1000)]


class OrganizationProject(ModelHeader):
    graph_file: Text
    fragment_files: Annotated[list[Text], Field(min_length=1, max_length=1000)]


def load_organization_json(text: str) -> OrganizationModel:
    return OrganizationModel.model_validate(
        json.loads(
            text,
            parse_float=str,
            parse_constant=_invalid_constant,
            object_pairs_hook=_unique_object,
        )
    )
