"""Immutable sparse mathematical representation, independent of any solver."""

from dataclasses import dataclass, fields, is_dataclass
from fractions import Fraction
from typing import Literal

from .units import Unit

Domain = Literal["BINARY", "INTEGER", "CONTINUOUS"]
Operator = Literal["<=", ">=", "=="]
Sense = Literal["MAX", "MIN"]


@dataclass(frozen=True)
class Origin:
    source: str
    approved: bool
    version: str


@dataclass(frozen=True)
class IRParameter:
    id: str
    value: Fraction
    unit: Unit
    origin: Origin


@dataclass(frozen=True)
class IRVariable:
    id: str
    domain: Domain
    lb: Fraction
    ub: Fraction
    unit: Unit
    department: str
    indices: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class IRTerm:
    variable: str
    coefficient: Fraction


@dataclass(frozen=True)
class IRConstraint:
    id: str
    terms: tuple[IRTerm, ...]
    operator: Operator
    rhs: Fraction
    unit: Unit
    owner_department: str
    origin: Origin


@dataclass(frozen=True)
class IRObjective:
    id: str
    terms: tuple[IRTerm, ...]
    sense: Sense
    priority: int
    unit: Unit
    owner_department: str
    origin: Origin


@dataclass(frozen=True)
class CompilationIssue:
    path: str
    code: str
    message: str


@dataclass(frozen=True)
class OptimizationIR:
    schema_version: str
    model_id: str
    model_version: str
    data_snapshot_id: str
    scenario_id: str
    model_hash: str
    manifest_hash: str
    parameters: tuple[IRParameter, ...]
    variables: tuple[IRVariable, ...]
    constraints: tuple[IRConstraint, ...]
    objectives: tuple[IRObjective, ...]
    transformations: tuple[str, ...]
    warnings: tuple[CompilationIssue, ...]


def to_data(value: object) -> object:
    """Canonical JSON-compatible export; rational numbers are never rounded."""
    if isinstance(value, Fraction):
        return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: to_data(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, (tuple, list)):
        return [to_data(item) for item in value]
    if isinstance(value, dict):
        return {key: to_data(item) for key, item in value.items()}
    return value
