"""Compose independently declared fragments into one existing ModelDSL/IR."""

from collections.abc import Iterable
from dataclasses import dataclass
import hashlib
import json
import re
from typing import NoReturn

from pydantic import BaseModel

from brain.kernel import ModelCompilationError, compile_model, load_model_json
from brain.kernel.ir import OptimizationIR, to_data
from brain.kernel.schema import (
    Constraint,
    Department,
    ModelDSL,
    Parameter,
    ParameterRef,
    Provenance,
    Scalar,
    Term,
    Variable,
)
from brain.kernel.units import parse_unit
from .schema import DepartmentFragment, OrganizationModel, ResourceUse, load_organization_json


def canonical_json(value: object) -> str:
    return json.dumps(
        to_data(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    )


def checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class CompositionError(ValueError):
    def __init__(self, path: str, code: str, message: str):
        self.path, self.code, self.message = path, code, message
        super().__init__(f"{path}: {message} [{code}]")


def fail(path: str, code: str, message: str) -> NoReturn:
    raise CompositionError(path, code, message)


@dataclass(frozen=True)
class ConstraintTrace:
    constraint_id: str
    owner_department: str
    fragment_ids: tuple[str, ...]
    contribution_ids: tuple[str, ...]
    parameter_ids: tuple[str, ...]
    resource_id: str | None
    source_paths: tuple[str, ...]


@dataclass(frozen=True)
class ResourceTrace:
    resource_id: str
    parameter_id: str
    constraint_id: str | None
    fragment_ids: tuple[str, ...]
    contribution_ids: tuple[str, ...]


@dataclass(frozen=True)
class Composition:
    # Only immutable strings, IR and tuples escape the compiler. Model properties
    # return detached Pydantic copies; input mutation cannot rewrite a snapshot.
    source_json: str
    dsl_json: str
    ir: OptimizationIR
    manifest_hash: str
    constraint_traces: tuple[ConstraintTrace, ...]
    resource_traces: tuple[ResourceTrace, ...]

    @property
    def source(self) -> OrganizationModel:
        return load_organization_json(self.source_json)

    @property
    def model(self) -> ModelDSL:
        return load_model_json(self.dsl_json)

    def to_dict(self) -> dict[str, object]:
        return {
            "organization_model": json.loads(self.source_json),
            "dsl": json.loads(self.dsl_json),
            "ir": to_data(self.ir),
            "model_hash": self.ir.model_hash,
            "model_manifest_hash": self.ir.manifest_hash,
            "composition_manifest_hash": self.manifest_hash,
            "constraint_traces": to_data(self.constraint_traces),
            "resource_traces": to_data(self.resource_traces),
        }


def _unique(values: Iterable[str], path: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            fail(path, "DUPLICATE_ID", f"Identifiant redéclaré : {value}")
        seen.add(value)


def _approved(value: Provenance, path: str) -> None:
    if not value.approved:
        fail(path + ".approved", "UNAPPROVED", "Approbation déclarée requise")


def _parameter_refs(values: Iterable[Scalar | None]) -> set[str]:
    return {value.parameter for value in values if isinstance(value, ParameterRef)}


def _sorted_terms(terms: Iterable[Term]) -> list[Term]:
    return sorted(terms, key=lambda term: (term.variable, canonical_json(term)))


def _canonical_source(source: OrganizationModel) -> str:
    raw = source.model_dump(mode="json")
    graph = raw["graph"]
    for key in ("departments", "resources", "edges"):
        graph[key].sort(key=lambda item: item["id"])
    for resource in graph["resources"]:
        resource["shared_with"].sort()
    raw["fragments"].sort(key=lambda item: item["id"])
    for fragment in raw["fragments"]:
        for key, identity in (
            ("variables", "id"),
            ("constraints", "id"),
            ("resource_uses", "id"),
            ("variable_refs", "variable"),
            ("parameter_refs", "parameter"),
        ):
            fragment[key].sort(key=lambda item: item[identity])
        for expression in fragment["constraints"] + fragment["resource_uses"]:
            expression["terms"].sort(key=canonical_json)
    raw["objective"]["terms"].sort(key=canonical_json)
    for values in raw["dimensions"].values():
        values.sort()
    return canonical_json(raw)


class _Composer:
    def __init__(self, source: OrganizationModel):
        self.source = source
        self.graph = source.graph
        self.departments = {d.id: d for d in self.graph.departments}
        self.resources = {r.id: r for r in self.graph.resources}
        self.parameters: dict[str, Parameter] = {}
        self.parameter_owners: dict[str, str | None] = {}
        self.variables: dict[str, Variable] = {}
        self.variable_fragments: dict[str, DepartmentFragment] = {}
        self.traces: list[ConstraintTrace] = []
        self.resource_traces: list[ResourceTrace] = []

    def graph_validate(self) -> None:
        _approved(self.graph.organization, "graph.organization")
        _unique(
            [self.graph.organization.id]
            + list(d.id for d in self.graph.departments)
            + list(r.id for r in self.graph.resources),
            "graph.nodes",
        )
        _unique((edge.id for edge in self.graph.edges), "graph.edges")
        _unique(
            (resource.constraint_id for resource in self.graph.resources),
            "graph.resources.constraint_id",
        )
        for department in self.graph.departments:
            _approved(department, f"graph.departments[{department.id}]")
        for resource in self.graph.resources:
            path = f"graph.resources[{resource.id}]"
            _approved(resource, path)
            _unique([resource.owner_department] + resource.shared_with, path + ".shared_with")
            for owner in [resource.owner_department] + resource.shared_with:
                if owner not in self.departments:
                    fail(path, "UNKNOWN_DEPARTMENT", owner)
        for edge in self.graph.edges:
            path = f"graph.edges[{edge.id}]"
            if edge.type == "DEPENDS_ON":
                if (
                    edge.source_id not in self.departments
                    or edge.target_id not in self.departments
                    or edge.source_id == edge.target_id
                ):
                    fail(
                        path,
                        "INVALID_EDGE",
                        "DEPENDS_ON exige deux départements distincts, source -> cible",
                    )
            else:
                if edge.source_id not in self.departments or edge.target_id not in self.resources:
                    fail(path, "INVALID_EDGE", "USES_RESOURCE exige département -> ressource")
                resource = self.resources[edge.target_id]
                if edge.source_id not in [resource.owner_department] + resource.shared_with:
                    fail(
                        path, "RESOURCE_SCOPE", "Département hors périmètre déclaré de la ressource"
                    )

    def register(self) -> None:
        _unique((fragment.id for fragment in self.source.fragments), "fragments")
        # One contribution module per department/version in this first composition grammar.
        _unique(
            (fragment.department_id for fragment in self.source.fragments),
            "fragments.department_id",
        )
        for key, parameter in self.source.shared_parameters.items():
            _approved(parameter, f"shared_parameters[{key}]")
            self.parameters[key] = parameter
            self.parameter_owners[key] = None
        for fragment in self.source.fragments:
            path = f"fragments[{fragment.id}]"
            _approved(fragment, path)
            if fragment.organization_id != self.graph.organization.id:
                fail(
                    path + ".organization_id",
                    "UNKNOWN_ORGANIZATION",
                    "Fragment d'une autre organisation",
                )
            if fragment.organization_version != self.graph.organization.version:
                fail(
                    path + ".organization_version",
                    "VERSION_CONFLICT",
                    "Organisation/version du fragment incompatible avec le graphe",
                )
            if fragment.department_id not in self.departments:
                fail(path + ".department_id", "UNKNOWN_DEPARTMENT", fragment.department_id)
            if fragment.department_version != self.departments[fragment.department_id].version:
                fail(
                    path + ".department_version",
                    "VERSION_CONFLICT",
                    "Version du département incompatible",
                )
            for key, parameter in fragment.parameters.items():
                if key in self.parameters:
                    fail(
                        path + f".parameters[{key}]",
                        "PARAMETER_COLLISION",
                        "Déclarer une référence, pas une seconde valeur",
                    )
                _approved(parameter, path + f".parameters[{key}]")
                self.parameters[key] = parameter
                self.parameter_owners[key] = fragment.department_id
            for variable in fragment.variables:
                if variable.id in self.variables:
                    fail(
                        path + f".variables[{variable.id}]",
                        "VARIABLE_COLLISION",
                        "Une seule déclaration par identité, même si le contenu est identique",
                    )
                if variable.department != fragment.department_id:
                    fail(
                        path + f".variables[{variable.id}].department",
                        "OWNERSHIP",
                        "Seul le fragment propriétaire déclare la variable",
                    )
                self.variables[variable.id] = variable
                self.variable_fragments[variable.id] = fragment
        for resource in self.graph.resources:
            path = f"graph.resources[{resource.id}].capacity"
            key = resource.capacity.parameter
            if key not in self.source.shared_parameters:
                fail(path, "UNKNOWN_SHARED_PARAMETER", key)
            parameter = self.parameters[key]
            if parameter.version != resource.capacity_version:
                fail(path, "VERSION_CONFLICT", "Version du paramètre de capacité incompatible")
            if parse_unit(parameter.unit).dimensions != parse_unit(resource.unit).dimensions:
                fail(path, "UNIT_MISMATCH", "Unité de capacité incompatible avec la ressource")
            if parameter.value < 0:
                fail(path, "INVALID_CAPACITY", "Une capacité de ressource doit être non négative")

    def fragment_scope(self, fragment: DepartmentFragment) -> tuple[set[str], set[str]]:
        path = f"fragments[{fragment.id}]"
        _unique((ref.variable for ref in fragment.variable_refs), path + ".variable_refs")
        _unique((ref.parameter for ref in fragment.parameter_refs), path + ".parameter_refs")
        visible_variables = {v.id for v in fragment.variables}
        visible_parameters = set(fragment.parameters)
        for ref in fragment.variable_refs:
            ref_path = path + f".variable_refs[{ref.variable}]"
            if ref.variable not in self.variables:
                fail(ref_path, "UNKNOWN_VARIABLE", ref.variable)
            declaration = self.variables[ref.variable]
            if ref.owner_department != declaration.department:
                fail(ref_path, "OWNERSHIP", "Propriétaire de variable incorrect")
            if ref.declaration_version != self.variable_fragments[ref.variable].version:
                fail(
                    ref_path, "VERSION_CONFLICT", "Version de déclaration de variable incompatible"
                )
            if parse_unit(ref.unit) != parse_unit(declaration.unit):
                fail(
                    ref_path,
                    "UNIT_MISMATCH",
                    "Unité de référence de variable différente de la déclaration",
                )
            visible_variables.add(ref.variable)
        for parameter_ref in fragment.parameter_refs:
            ref_path = path + f".parameter_refs[{parameter_ref.parameter}]"
            if parameter_ref.parameter not in self.parameters:
                fail(ref_path, "UNKNOWN_PARAMETER", parameter_ref.parameter)
            declaration_parameter = self.parameters[parameter_ref.parameter]
            if parameter_ref.owner_department != self.parameter_owners[parameter_ref.parameter]:
                fail(ref_path, "OWNERSHIP", "Propriétaire de paramètre incorrect")
            if parameter_ref.version != declaration_parameter.version:
                fail(ref_path, "VERSION_CONFLICT", "Version de paramètre incompatible")
            if parse_unit(parameter_ref.unit) != parse_unit(declaration_parameter.unit):
                fail(
                    ref_path,
                    "UNIT_MISMATCH",
                    "Unité de référence de paramètre différente de la déclaration",
                )
            visible_parameters.add(parameter_ref.parameter)
        return visible_variables, visible_parameters

    def expressions(
        self,
        fragment: DepartmentFragment,
        terms: list[Term],
        scalars: Iterable[Scalar | None],
        path: str,
        scope: tuple[set[str], set[str]],
    ) -> tuple[str, ...]:
        visible_variables, visible_parameters = scope
        for index, term in enumerate(terms):
            if term.variable not in visible_variables:
                fail(
                    f"{path}.terms[{index}].variable",
                    "UNDECLARED_REFERENCE",
                    f"Déclaration ou import explicite requis : {term.variable}",
                )
        refs = _parameter_refs([*scalars, *(term.coefficient for term in terms)])
        if not refs.issubset(visible_parameters):
            fail(
                path,
                "UNDECLARED_REFERENCE",
                f"Paramètres non importés : {sorted(refs - visible_parameters)}",
            )
        return tuple(sorted(refs))

    def compose(self) -> Composition:
        self.graph_validate()
        self.register()
        constraints: list[Constraint] = []
        uses: dict[str, list[tuple[DepartmentFragment, ResourceUse]]] = {
            key: [] for key in self.resources
        }
        for fragment in self.source.fragments:
            path = f"fragments[{fragment.id}]"
            scope = self.fragment_scope(fragment)
            _unique((use.id for use in fragment.resource_uses), path + ".resource_uses")
            for variable in fragment.variables:
                self.expressions(
                    fragment,
                    [],
                    [variable.lb, variable.ub],
                    path + f".variables[{variable.id}]",
                    scope,
                )
            for constraint in fragment.constraints:
                constraint_path = path + f".constraints[{constraint.id}]"
                _approved(constraint, constraint_path)
                if constraint.owner_department != fragment.department_id:
                    fail(
                        constraint_path + ".owner_department",
                        "OWNERSHIP",
                        "Le fragment ne possède pas cette règle",
                    )
                refs = self.expressions(
                    fragment, constraint.terms, [constraint.rhs], constraint_path, scope
                )
                constraints.append(
                    constraint.model_copy(update={"terms": _sorted_terms(constraint.terms)})
                )
                self.traces.append(
                    ConstraintTrace(
                        constraint.id,
                        constraint.owner_department,
                        (fragment.id,),
                        (),
                        refs,
                        None,
                        (constraint_path,),
                    )
                )
            for use in fragment.resource_uses:
                use_path = path + f".resource_uses[{use.id}]"
                _approved(use, use_path)
                if use.resource_id not in self.resources:
                    fail(use_path + ".resource_id", "UNKNOWN_RESOURCE", use.resource_id)
                resource = self.resources[use.resource_id]
                if fragment.department_id not in [resource.owner_department] + resource.shared_with:
                    fail(use_path, "RESOURCE_SCOPE", "Contribution hors périmètre déclaré")
                self.expressions(fragment, use.terms, [], use_path, scope)
                uses[use.resource_id].append((fragment, use))
        for key, resource in sorted(self.resources.items()):
            contributions = uses[key]
            fragment_ids = tuple(sorted({fragment.id for fragment, _ in contributions}))
            use_ids = tuple(sorted(f"{fragment.id}/{use.id}" for fragment, use in contributions))
            constraint_id = resource.constraint_id if contributions else None
            self.resource_traces.append(
                ResourceTrace(
                    key, resource.capacity.parameter, constraint_id, fragment_ids, use_ids
                )
            )
            if not contributions:
                continue  # A graph node alone never creates a mathematical rule.
            all_terms = _sorted_terms(term for _, use in contributions for term in use.terms)
            constraints.append(
                Constraint(
                    id=resource.constraint_id,
                    owner_department=resource.owner_department,
                    kind="HARD",
                    terms=all_terms,
                    operator="<=",
                    rhs=resource.capacity,
                    unit=resource.unit,
                    source=resource.source,
                    approved=resource.approved,
                    version=resource.version,
                )
            )
            resource_refs = _parameter_refs(
                [resource.capacity, *(term.coefficient for term in all_terms)]
            )
            paths = tuple(
                sorted(
                    f"fragments[{fragment.id}].resource_uses[{use.id}]"
                    for fragment, use in contributions
                )
            )
            self.traces.append(
                ConstraintTrace(
                    resource.constraint_id,
                    resource.owner_department,
                    fragment_ids,
                    use_ids,
                    tuple(sorted(resource_refs)),
                    key,
                    paths,
                )
            )
        _unique((constraint.id for constraint in constraints), "composed.constraints")
        _approved(self.source.objective, "objective")
        dsl = ModelDSL(
            schema_version="1.0",
            id=self.source.model_id,
            name=self.source.model_name,
            model_version=self.source.model_version,
            data_snapshot_id=self.graph.organization.data_snapshot_id,
            scenario_id=self.source.scenario_id,
            currency=self.source.currency,
            dimensions={key: sorted(labels) for key, labels in self.source.dimensions.items()},
            departments=[
                Department(id=d.id, name=d.name)
                for d in sorted(self.graph.departments, key=lambda d: d.id)
            ],
            parameters=dict(sorted(self.parameters.items())),
            variables=sorted(self.variables.values(), key=lambda variable: variable.id),
            constraints=sorted(constraints, key=lambda constraint: constraint.id),
            objectives=[
                self.source.objective.model_copy(
                    update={"terms": _sorted_terms(self.source.objective.terms)}
                )
            ],
        )
        try:
            ir = compile_model(dsl)
        except ModelCompilationError as exc:
            issue = exc.issues[0]
            match = re.match(r"constraints\[(\d+)\]", issue.path)
            location = issue.path
            if match:
                identity = dsl.constraints[int(match[1])].id
                trace = next(t for t in self.traces if t.constraint_id == identity)
                location = " + ".join(trace.source_paths) + " -> " + issue.path
            variable_match = re.match(r"variables\[(\d+)\]", issue.path)
            if variable_match:
                variable_id = dsl.variables[int(variable_match[1])].id
                fragment_id = self.variable_fragments[variable_id].id
                location = f"fragments[{fragment_id}].variables[{variable_id}] -> {issue.path}"
            if issue.path.startswith("objectives"):
                location = "objective -> " + issue.path
            raise CompositionError(location, issue.code, issue.message) from exc
        source_json = _canonical_source(self.source)
        dsl_json = canonical_json(dsl)
        traces = tuple(sorted(self.traces, key=lambda trace: trace.constraint_id))
        resource_traces = tuple(sorted(self.resource_traces, key=lambda trace: trace.resource_id))
        manifest_hash = checksum(
            canonical_json(
                {
                    "source": json.loads(source_json),
                    "dsl": json.loads(dsl_json),
                    "ir": to_data(ir),
                    "traces": to_data(traces),
                    "resources": to_data(resource_traces),
                }
            )
        )
        return Composition(source_json, dsl_json, ir, manifest_hash, traces, resource_traces)


def compose_organization_model(raw: object) -> Composition:
    if isinstance(raw, str):
        source = load_organization_json(raw)
    else:
        source = OrganizationModel.model_validate(
            raw.model_dump() if isinstance(raw, BaseModel) else raw
        )
    return _Composer(source).compose()
