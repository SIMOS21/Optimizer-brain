"""Deterministic validation and compilation from declarative DSL to sparse IR."""

from decimal import Decimal
from fractions import Fraction
import hashlib
import json

from .ir import (
    CompilationIssue,
    IRConstraint,
    IRObjective,
    IRParameter,
    IRTerm,
    IRVariable,
    OptimizationIR,
    Origin,
    to_data,
)
from .schema import ModelDSL, ParameterRef, Provenance, Scalar, Term, Variable
from .units import Unit, parse_unit


class ModelCompilationError(ValueError):
    def __init__(self, issue: CompilationIssue):
        self.issues = (issue,)
        super().__init__(f"{issue.path}: {issue.message} [{issue.code}]")


def _fail(path: str, code: str, message: str) -> None:
    raise ModelCompilationError(CompilationIssue(path, code, message))


def _hash(value: object) -> str:
    data = json.dumps(to_data(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _origin(value: Provenance, path: str) -> Origin:
    if not value.approved:
        _fail(path + ".approved", "UNAPPROVED", "Donnée ou règle non approuvée")
    return Origin(value.source, value.approved, value.version)


class _Compiler:
    def __init__(self, model: ModelDSL):
        self.model = model
        self.departments = {d.id for d in model.departments}
        self.parameters = {
            key: IRParameter(
                key, Fraction(p.value), parse_unit(p.unit), _origin(p, f"parameters.{key}")
            )
            for key, p in sorted(model.parameters.items())
        }
        self.variables: dict[str, IRVariable] = {}

    def department(self, department: str, path: str) -> None:
        if department not in self.departments:
            _fail(path, "UNKNOWN_DEPARTMENT", f"Département inconnu : {department}")

    def scalar(self, value: Scalar, target: Unit, path: str) -> Fraction:
        if isinstance(value, Decimal):
            return Fraction(value)
        assert isinstance(value, ParameterRef)
        if value.parameter not in self.parameters:
            _fail(path, "UNKNOWN_PARAMETER", f"Paramètre inconnu : {value.parameter}")
        parameter = self.parameters[value.parameter]
        if parameter.unit.dimensions != target.dimensions:
            _fail(path, "UNIT_MISMATCH", "Unité du paramètre incompatible avec son utilisation")
        return parameter.value * parameter.unit.scale / target.scale

    def variable(self, value: Variable, path: str) -> IRVariable:
        self.department(value.department, path + ".department")
        for dimension, label in value.indices.items():
            if dimension not in self.model.dimensions:
                _fail(path + ".indices", "UNKNOWN_DIMENSION", f"Dimension inconnue : {dimension}")
            if label not in self.model.dimensions[dimension]:
                _fail(path + ".indices", "UNKNOWN_INDEX", f"Index inconnu : {dimension}.{label}")
        unit = parse_unit(value.unit)
        lower = self.scalar(value.lb, unit, path + ".lb")
        upper = self.scalar(value.ub, unit, path + ".ub")
        if lower > upper:
            _fail(path, "INVALID_BOUNDS", "La borne inférieure dépasse la borne supérieure")
        if value.type != "CONTINUOUS" and (lower.denominator != 1 or upper.denominator != 1):
            _fail(path, "INVALID_DOMAIN", "Bornes entières requises pour un domaine discret")
        if value.type == "BINARY" and (lower < 0 or upper > 1 or unit != Unit(())):
            _fail(path, "INVALID_DOMAIN", "Variable binaire sans dimension, bornée dans [0,1]")
        return IRVariable(
            value.id,
            value.type,
            lower,
            upper,
            unit,
            value.department,
            tuple(sorted(value.indices.items())),
        )

    def terms(self, terms: list[Term], target: Unit, path: str) -> tuple[IRTerm, ...]:
        coefficients: dict[str, Fraction] = {}
        for index, term in enumerate(terms):
            term_path = f"{path}[{index}]"
            if term.variable not in self.variables:
                _fail(
                    term_path + ".variable",
                    "UNKNOWN_VARIABLE",
                    f"Variable inconnue : {term.variable}",
                )
            coefficient_unit = parse_unit(term.coefficient_unit)
            variable = self.variables[term.variable]
            product = coefficient_unit.multiply(variable.unit)
            if product.dimensions != target.dimensions:
                _fail(
                    term_path,
                    "UNIT_MISMATCH",
                    "coefficient_unit × variable.unit incompatible avec unit",
                )
            coefficient = self.scalar(
                term.coefficient, coefficient_unit, term_path + ".coefficient"
            )
            coefficient *= product.scale / target.scale
            coefficients[term.variable] = coefficients.get(term.variable, Fraction(0)) + coefficient
        return tuple(
            IRTerm(key, coefficient)
            for key, coefficient in sorted(coefficients.items())
            if coefficient
        )

    def compile(self) -> OptimizationIR:
        for index, variable in enumerate(self.model.variables):
            self.variables[variable.id] = self.variable(variable, f"variables[{index}]")
        constraints = []
        warnings = []
        for index, constraint in enumerate(self.model.constraints):
            path = f"constraints[{index}]"
            self.department(constraint.owner_department, path + ".owner_department")
            origin = _origin(constraint, path)
            unit = parse_unit(constraint.unit)
            terms = self.terms(constraint.terms, unit, path + ".terms")
            rhs = self.scalar(constraint.rhs, unit, path + ".rhs")
            row = IRConstraint(
                constraint.id,
                terms,
                constraint.operator,
                rhs,
                unit,
                constraint.owner_department,
                origin,
            )
            constraints.append(row)
            # Interval bound check is a sufficient warning, never a feasibility certificate.
            minimum = maximum = Fraction(0)
            for term in terms:
                ir_variable = self.variables[term.variable]
                a, b = term.coefficient * ir_variable.lb, term.coefficient * ir_variable.ub
                minimum += min(a, b)
                maximum += max(a, b)
            impossible = (
                (row.operator == "<=" and minimum > rhs)
                or (row.operator == ">=" and maximum < rhs)
                or (row.operator == "==" and not minimum <= rhs <= maximum)
            )
            if impossible:
                warnings.append(
                    CompilationIssue(
                        path,
                        "INFEASIBLE_BY_BOUNDS",
                        "Contrainte impossible dans les bornes déclarées",
                    )
                )
        objectives = []
        for index, objective in enumerate(self.model.objectives):
            path = f"objectives[{index}]"
            self.department(objective.owner_department, path + ".owner_department")
            origin = _origin(objective, path)
            unit = parse_unit(objective.unit)
            objectives.append(
                IRObjective(
                    objective.id,
                    self.terms(objective.terms, unit, path + ".terms"),
                    objective.sense,
                    objective.priority,
                    unit,
                    objective.owner_department,
                    origin,
                )
            )
        variables = tuple(sorted(self.variables.values(), key=lambda v: v.id))
        rows = tuple(sorted(constraints, key=lambda row: row.id))
        goals = tuple(objectives)
        semantic = {
            "schema_version": self.model.schema_version,
            "variables": [(v.id, v.domain, v.lb, v.ub, v.unit, v.indices) for v in variables],
            "constraints": [(r.id, r.terms, r.operator, r.rhs, r.unit) for r in rows],
            "objectives": [(o.id, o.terms, o.sense, o.priority, o.unit) for o in goals],
        }
        return OptimizationIR(
            self.model.schema_version,
            self.model.id,
            self.model.model_version,
            self.model.data_snapshot_id,
            self.model.scenario_id,
            _hash(semantic),
            _hash(self.model.model_dump(mode="json")),
            tuple(self.parameters.values()),
            variables,
            rows,
            goals,
            (
                "Resolved parameter references and explicit unit scales",
                "Aggregated terms, removed zeros, sorted identifiers",
            ),
            tuple(warnings),
        )


def compile_model(raw: object) -> OptimizationIR:
    # Revalidate models too: frozen Pydantic inputs can still contain mutable lists/dicts.
    if isinstance(raw, ModelDSL):
        raw = raw.model_dump()
    return _Compiler(ModelDSL.model_validate(raw)).compile()
