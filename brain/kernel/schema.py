"""DSL v1 input contracts. Semantics and reference resolution live in compiler.py."""

import json
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from .numbers import Number
from .units import parse_unit

Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_]*$", max_length=100)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, frozen=True, allow_inf_nan=False, revalidate_instances="always"
    )


class Provenance(StrictModel):
    source: Text
    approved: bool
    version: Text


class Department(StrictModel):
    id: Identifier
    name: Text


class UnitModel(StrictModel):
    unit: Annotated[str, Field(max_length=128)]

    @field_validator("unit")
    @classmethod
    def valid_unit(cls, value: str) -> str:
        parse_unit(value)
        return value


class Parameter(UnitModel, Provenance):
    value: Number


class ParameterRef(StrictModel):
    parameter: Identifier


Scalar = Number | ParameterRef


class Variable(UnitModel):
    id: Identifier
    type: Literal["BINARY", "INTEGER", "CONTINUOUS"]
    lb: Scalar
    ub: Scalar
    department: Identifier
    indices: Annotated[dict[Identifier, Identifier], Field(max_length=100)] = Field(
        default_factory=dict
    )


class Term(StrictModel):
    variable: Identifier
    coefficient: Scalar
    coefficient_unit: Annotated[str, Field(max_length=128)]

    @field_validator("coefficient_unit")
    @classmethod
    def valid_unit(cls, value: str) -> str:
        parse_unit(value)
        return value


class Constraint(UnitModel, Provenance):
    id: Identifier
    owner_department: Identifier
    kind: Literal["HARD"]
    terms: Annotated[list[Term], Field(max_length=10000)]
    operator: Literal["<=", ">=", "=="]
    rhs: Scalar


class Objective(UnitModel, Provenance):
    id: Identifier
    owner_department: Identifier
    sense: Literal["MAX", "MIN"]
    priority: Annotated[int, Field(ge=1)] = 1
    terms: Annotated[list[Term], Field(max_length=10000)]


class ModelDSL(StrictModel):
    schema_version: Literal["1.0"]
    id: Identifier
    name: Text
    model_version: Text
    data_snapshot_id: Text
    scenario_id: Identifier
    currency: Literal["EUR", "MAD", "USD"] | None = None
    dimensions: Annotated[
        dict[Identifier, Annotated[list[Identifier], Field(min_length=1, max_length=10000)]],
        Field(max_length=100),
    ] = Field(default_factory=dict)
    departments: Annotated[list[Department], Field(min_length=1, max_length=1000)]
    parameters: Annotated[dict[Identifier, Parameter], Field(max_length=10000)]
    variables: Annotated[list[Variable], Field(min_length=1, max_length=10000)]
    constraints: Annotated[list[Constraint], Field(max_length=10000)]
    objectives: Annotated[list[Objective], Field(min_length=1, max_length=1)]

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        for dimension, labels in self.dimensions.items():
            if len(labels) != len(set(labels)):
                raise ValueError(f"dimensions.{dimension}: labels dupliqués")
        for field in ("departments", "variables", "constraints", "objectives"):
            items = getattr(self, field)
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"{field}: identifiants dupliqués")
        return self


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Clé JSON dupliquée : {key}")
        result[key] = value
    return result


def _invalid_constant(value: str) -> object:
    raise ValueError(f"Constante JSON interdite : {value}")


def load_model_json(text: str) -> ModelDSL:
    """Preserve JSON decimal digits and reject duplicate keys before Pydantic."""
    # parse_float=str avoids a lossy binary floating-point intermediate.
    raw = json.loads(
        text, parse_float=str, parse_constant=_invalid_constant, object_pairs_hook=_unique_object
    )
    return ModelDSL.model_validate(raw)
