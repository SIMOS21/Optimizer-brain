"""Tenant-scoped application services. Approval is a separate, audited operation."""

from dataclasses import dataclass
import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from brain.kernel.schema import Parameter
from brain.kernel.units import parse_unit
from brain.organization import compose_organization_model
from brain.organization.composition import canonical_json, checksum
from brain.organization.schema import OrganizationGraph
from brain.organization.reporting import build_report
from brain.solvers.contracts import SolveResult
from .database import set_tenant
from .models import (
    AuditEvent,
    Department,
    GraphSnapshot,
    Membership,
    ModelVersion,
    OptimizationRun,
    Organization,
    User,
    now,
)
from .schemas import DepartmentCreate, GraphCreate, MembershipSet, ModelCreate, OrganizationCreate


class ServiceError(ValueError):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


@dataclass(frozen=True)
class Tenant:
    user_id: str
    organization_id: str
    role: str
    organization_key: str


def tenant(
    session: Session,
    user: User,
    organization_id: str,
    *,
    roles: tuple[str, ...] = (),
    lock: bool = False,
) -> Tenant:
    set_tenant(session, organization_id)
    query = (
        select(Organization)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(
            Organization.id == organization_id,
            Membership.user_id == user.id,
            Membership.active.is_(True),
        )
    )
    if lock:
        query = query.with_for_update(of=Organization)
    organization = session.scalar(query)
    if organization is None:
        raise ServiceError(404, "Organisation ou ressource introuvable")
    member = session.get(Membership, (organization_id, user.id), populate_existing=True)
    if member is None or not member.active:
        raise ServiceError(404, "Organisation ou ressource introuvable")
    if roles and member.role not in roles:
        raise ServiceError(403, "Rôle insuffisant")
    return Tenant(user.id, organization_id, member.role, organization.key)


def audit(session: Session, scope: Tenant, action: str, target: str) -> None:
    session.add(
        AuditEvent(
            organization_id=scope.organization_id,
            actor_id=scope.user_id,
            action=action,
            target_id=target,
        )
    )


def create_organization(session: Session, user: User, body: OrganizationCreate) -> Organization:
    organization = Organization(key=body.key, name=body.name, created_by=user.id)
    session.add(organization)
    session.flush()
    session.add(
        Membership(organization_id=organization.id, user_id=user.id, role="ADMIN", active=True)
    )
    session.flush()
    set_tenant(session, organization.id)
    audit(
        session,
        Tenant(user.id, organization.id, "ADMIN", organization.key),
        "organization.created",
        organization.id,
    )
    session.flush()
    return organization


def set_membership(
    session: Session, user: User, organization_id: str, body: MembershipSet
) -> Membership:
    scope = tenant(session, user, organization_id, roles=("ADMIN",), lock=True)
    target = session.get(User, body.user_id)
    if target is None or not target.active:
        raise ServiceError(404, "Utilisateur introuvable")
    existing = session.get(Membership, (organization_id, body.user_id), populate_existing=True)
    if (
        existing
        and existing.active
        and existing.role == "ADMIN"
        and (not body.active or body.role != "ADMIN")
    ):
        admins = session.scalar(
            select(func.count())
            .select_from(Membership)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.organization_id == organization_id,
                Membership.role == "ADMIN",
                Membership.active.is_(True),
                User.active.is_(True),
            )
        )
        if admins == 1:
            raise ServiceError(409, "Le dernier administrateur actif doit être conservé")
    if existing is None:
        existing = Membership(organization_id=organization_id, user_id=body.user_id)
        session.add(existing)
    existing.role, existing.active = body.role, body.active
    audit(session, scope, "membership.set", body.user_id)
    session.flush()
    return existing


def create_department(
    session: Session, user: User, organization_id: str, body: DepartmentCreate
) -> Department:
    scope = tenant(session, user, organization_id, roles=("ADMIN",), lock=True)
    if body.owner_user_id is not None:
        owner = session.get(Membership, (organization_id, body.owner_user_id))
        if owner is None or not owner.active:
            raise ServiceError(422, "Le propriétaire doit être membre actif de cette organisation")
    department = Department(
        organization_id=organization_id,
        key=body.key,
        name=body.name,
        owner_user_id=body.owner_user_id,
    )
    session.add(department)
    session.flush()
    audit(session, scope, "department.created", department.id)
    session.flush()
    return department


def graph_document(graph: OrganizationGraph, parameters: dict[str, Parameter]) -> str:
    raw = graph.model_dump(mode="json")
    for field in ("departments", "resources", "edges"):
        raw[field].sort(key=lambda node: node["id"])
    for resource in raw["resources"]:
        resource["shared_with"].sort()
    return canonical_json({"graph": raw, "shared_parameters": parameters})


def _validate_graph(session: Session, scope: Tenant, body: GraphCreate) -> None:
    graph = body.graph
    if graph.organization.id != scope.organization_key:
        raise ServiceError(422, "Identité du graphe incompatible avec l'organisation autorisée")
    departments = {d.id for d in graph.departments}
    resources = {r.id: r for r in graph.resources}
    ids = (
        [graph.organization.id]
        + [d.id for d in graph.departments]
        + [r.id for r in graph.resources]
    )
    if len(set(ids)) != len(ids) or len({e.id for e in graph.edges}) != len(graph.edges):
        raise ServiceError(422, "Identifiants de graphe dupliqués")
    registered = set(
        session.scalars(
            select(Department.key).where(Department.organization_id == scope.organization_id)
        )
    )
    if not departments.issubset(registered):
        raise ServiceError(422, "Département du graphe absent du registre autorisé")
    origins = [
        graph.organization,
        *graph.departments,
        *graph.resources,
        *body.shared_parameters.values(),
    ]
    if any(not origin.approved for origin in origins):
        raise ServiceError(422, "Sources déclarées non approuvées")
    for resource in graph.resources:
        members = [resource.owner_department] + resource.shared_with
        parameter = body.shared_parameters.get(resource.capacity.parameter)
        if len(set(members)) != len(members) or not set(members).issubset(departments):
            raise ServiceError(422, "Propriétaire/périmètre de ressource invalide")
        if (
            parameter is None
            or parameter.version != resource.capacity_version
            or parameter.value < 0
        ):
            raise ServiceError(422, "Capacité inconnue, négative ou version incompatible")
        if parse_unit(parameter.unit).dimensions != parse_unit(resource.unit).dimensions:
            raise ServiceError(422, "Unité de capacité incompatible")
    for edge in graph.edges:
        if edge.type == "DEPENDS_ON":
            valid = (
                edge.source_id in departments
                and edge.target_id in departments
                and edge.source_id != edge.target_id
            )
        else:
            edge_resource = resources.get(edge.target_id)
            valid = (
                edge_resource is not None
                and edge.source_id in [edge_resource.owner_department] + edge_resource.shared_with
            )
        if not valid:
            raise ServiceError(422, "Arête de graphe invalide")


def create_graph(
    session: Session, user: User, organization_id: str, body: GraphCreate
) -> GraphSnapshot:
    scope = tenant(session, user, organization_id, roles=("ADMIN", "BUILDER"), lock=True)
    _validate_graph(session, scope, body)
    payload = graph_document(body.graph, body.shared_parameters)
    existing = session.scalar(
        select(GraphSnapshot).where(
            GraphSnapshot.organization_id == organization_id,
            GraphSnapshot.key == body.graph.organization.id,
            GraphSnapshot.version == body.graph.organization.version,
        )
    )
    if existing:
        if existing.payload != payload:
            raise ServiceError(409, "Version de graphe existante ; créer une nouvelle version")
        return existing
    record = GraphSnapshot(
        organization_id=organization_id,
        key=body.graph.organization.id,
        version=body.graph.organization.version,
        payload=payload,
        content_hash=checksum(payload),
        created_by=user.id,
    )
    session.add(record)
    session.flush()
    audit(session, scope, "graph.created", record.id)
    session.flush()
    return record


def get_graph(session: Session, organization_id: str, identity: str) -> GraphSnapshot:
    record = session.scalar(
        select(GraphSnapshot).where(
            GraphSnapshot.organization_id == organization_id, GraphSnapshot.id == identity
        )
    )
    if record is None:
        raise ServiceError(404, "Graphe introuvable")
    if checksum(record.payload) != record.content_hash:
        raise ServiceError(409, "Intégrité du graphe invalide")
    return record


def get_model(session: Session, organization_id: str, identity: str) -> ModelVersion:
    record = session.scalar(
        select(ModelVersion).where(
            ModelVersion.organization_id == organization_id, ModelVersion.id == identity
        )
    )
    if record is None:
        raise ServiceError(404, "Version de modèle introuvable")
    if checksum(record.payload) != record.content_hash:
        raise ServiceError(409, "Intégrité du modèle invalide")
    return record


def create_model(
    session: Session, user: User, organization_id: str, body: ModelCreate
) -> ModelVersion:
    scope = tenant(session, user, organization_id, roles=("ADMIN", "BUILDER"), lock=True)
    graph = get_graph(session, organization_id, body.graph_snapshot_id)
    composition = compose_organization_model(body.model)
    if (
        graph.state != "PUBLISHED"
        or graph_document(composition.source.graph, composition.source.shared_parameters)
        != graph.payload
    ):
        raise ServiceError(
            409, "Le modèle doit référencer exactement un graphe publié et ses paramètres"
        )
    if composition.source.graph.organization.id != scope.organization_key:
        raise ServiceError(422, "Organisation du modèle incompatible")
    payload = canonical_json(composition.to_dict())
    existing = session.scalar(
        select(ModelVersion).where(
            ModelVersion.organization_id == organization_id,
            ModelVersion.key == composition.ir.model_id,
            ModelVersion.version == composition.ir.model_version,
        )
    )
    if existing:
        if existing.payload != payload or existing.graph_snapshot_id != graph.id:
            raise ServiceError(409, "Version de modèle existante ; créer une nouvelle version")
        return existing
    record = ModelVersion(
        organization_id=organization_id,
        key=composition.ir.model_id,
        version=composition.ir.model_version,
        graph_snapshot_id=graph.id,
        model_hash=composition.ir.model_hash,
        data_snapshot_id=composition.ir.data_snapshot_id,
        payload=payload,
        content_hash=checksum(payload),
        created_by=user.id,
    )
    session.add(record)
    session.flush()
    audit(session, scope, "model.created", record.id)
    session.flush()
    return record


def publish(
    session: Session, user: User, organization_id: str, identity: str, *, model: bool
) -> ModelVersion | GraphSnapshot:
    scope = tenant(session, user, organization_id, roles=("ADMIN", "APPROVER"), lock=True)
    record = (
        get_model(session, organization_id, identity)
        if model
        else get_graph(session, organization_id, identity)
    )
    if record.state == "PUBLISHED":
        return record
    record.state, record.published_by, record.published_at = "PUBLISHED", user.id, now()
    audit(session, scope, "model.published" if model else "graph.published", record.id)
    session.flush()
    return record


def record_run(
    session: Session, user: User, organization_id: str, model_version_id: str, result: SolveResult
) -> OptimizationRun:
    """Trusted internal pipeline hook, never a public endpoint accepting solver claims."""
    scope = tenant(session, user, organization_id, roles=("ADMIN", "BUILDER"), lock=True)
    model = get_model(session, organization_id, model_version_id)
    if model.state != "PUBLISHED":
        raise ServiceError(409, "Modèle publié requis")
    composition = compose_organization_model(json.loads(model.payload)["organization_model"])
    report = build_report(composition, result)
    payload = canonical_json({"solve": result.to_dict(), "report": report})
    existing = session.get(OptimizationRun, result.run_id)
    if existing is not None:
        if (
            existing.organization_id != organization_id
            or existing.model_version_id != model_version_id
            or existing.payload != payload
        ):
            raise ServiceError(409, "Identité de run déjà utilisée")
        return existing
    record = OptimizationRun(
        id=result.run_id,
        organization_id=organization_id,
        model_version_id=model_version_id,
        status=result.public_status,
        payload=payload,
        content_hash=checksum(payload),
        created_by=user.id,
    )
    session.add(record)
    audit(session, scope, "run.recorded", result.run_id)
    session.flush()
    return record
