"""Explicit, revocable authority over immutable numeric-change policy documents."""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from brain.kernel.schema import Parameter, ParameterRef
from brain.organization import Composition
from brain.organization.composition import canonical_json, checksum
from . import scenarios, service
from .change_errors import ChangeError
from .change_contracts import (
    ChangePolicyCreate,
    ChangePolicyDocument,
    ChangePolicyResponse,
    ChangeRule,
    ChangeTarget,
    ChangeTargetInfo,
    ChangeTargetsResponse,
    ExpectedPolicy,
    PolicyApprovalResponse,
)
from .models import (
    Department,
    Membership,
    ScenarioChangeLink,
    ScenarioChangePolicy,
    ScenarioPolicyApproval,
    ScenarioVersion,
    User,
    new_id,
    now,
)


def parameter(composition: Composition, target: ChangeTarget) -> Parameter:
    source = composition.source
    if target.kind == "DEPARTMENT_PARAMETER":
        fragment = next((f for f in source.fragments if f.id == target.fragment_id), None)
        if fragment is None or target.resource_id is not None:
            raise service.ServiceError(422, "Sélecteur de paramètre départemental invalide")
        value = fragment.parameters.get(target.parameter_id)
        path = f"fragments[{fragment.id}].parameters.{target.parameter_id}.value"
    else:
        if target.fragment_id is not None:
            raise service.ServiceError(422, "Sélecteur partagé invalide")
        if target.kind == "RESOURCE_CAPACITY":
            resource = next((r for r in source.graph.resources if r.id == target.resource_id), None)
            if resource is None or resource.capacity.parameter != target.parameter_id:
                raise service.ServiceError(422, "Capacité inconnue ou paramètre différent")
        elif target.resource_id is not None:
            raise service.ServiceError(422, "Ressource inattendue pour un paramètre partagé")
        value = source.shared_parameters.get(target.parameter_id)
        path = f"shared_parameters.{target.parameter_id}.value"
    if value is None or target.path != path:
        raise service.ServiceError(422, "Paramètre ou chemin hors contrat autorisé")
    return value


def target_info(
    session: Session, org: str, composition: Composition, target: ChangeTarget
) -> ChangeTargetInfo:
    value = parameter(composition, target)
    source = composition.source
    owners = {
        r.owner_department
        for r in source.graph.resources
        if r.capacity.parameter == target.parameter_id
    }
    if target.kind == "DEPARTMENT_PARAMETER":
        owners = {next(f.department_id for f in source.fragments if f.id == target.fragment_id)}
    if len(owners) > 1:
        raise service.ServiceError(
            422, "Paramètre à propriétaires multiples : délégation non supportée"
        )
    owner = next(iter(owners), None)
    department = (
        session.scalar(
            select(Department).where(Department.organization_id == org, Department.key == owner)
        )
        if owner
        else None
    )
    affected = sorted(
        t.constraint_id
        for t in composition.constraint_traces
        if target.parameter_id in t.parameter_ids
    )
    affects_objective = any(
        isinstance(t.coefficient, ParameterRef) and t.coefficient.parameter == target.parameter_id
        for t in source.objective.terms
    )
    return ChangeTargetInfo(
        target=target,
        value=str(value.value),
        unit=value.unit,
        owner_department=owner,
        registered_owner_user_id=department.owner_user_id if department else None,
        affected_constraint_ids=affected,
        affects_objective=affects_objective,
    )


def targets(session: Session, actor: User, org: str, identity: str) -> ChangeTargetsResponse:
    service.tenant(session, actor, org)
    model, composition, _ = scenarios._checked_model(session, org, identity)
    if model.state != "PUBLISHED":
        raise service.ServiceError(409, "Référence publiée requise")
    selectors: list[ChangeTarget] = []
    source = composition.source
    for key in sorted(source.shared_parameters):
        selectors.append(
            ChangeTarget(
                kind="SHARED_PARAMETER", parameter_id=key, path=f"shared_parameters.{key}.value"
            )
        )
    for resource in sorted(source.graph.resources, key=lambda r: r.id):
        key = resource.capacity.parameter
        selectors.append(
            ChangeTarget(
                kind="RESOURCE_CAPACITY",
                resource_id=resource.id,
                parameter_id=key,
                path=f"shared_parameters.{key}.value",
            )
        )
    for fragment in sorted(source.fragments, key=lambda f: f.id):
        for key in sorted(fragment.parameters):
            selectors.append(
                ChangeTarget(
                    kind="DEPARTMENT_PARAMETER",
                    fragment_id=fragment.id,
                    parameter_id=key,
                    path=f"fragments[{fragment.id}].parameters.{key}.value",
                )
            )
    items = []
    for selector in selectors:
        try:
            items.append(target_info(session, org, composition, selector))
        except service.ServiceError:
            # Multi-owner targets are not offered as single-owner delegations.
            continue
    return ChangeTargetsResponse(
        organization_id=org,
        source_model_version_id=model.id,
        source_content_hash=model.content_hash,
        items=items,
    )


def accounts(
    session: Session, org: str, identities: Iterable[str], *, lock: bool
) -> dict[str, tuple[User, str]]:
    query = (
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.organization_id == org,
            Membership.active.is_(True),
            User.active.is_(True),
            User.id.in_(sorted(set(identities))),
        )
        .order_by(User.id)
        .execution_options(populate_existing=True)
    )
    if lock:
        query = query.with_for_update(of=User)
    return {user.id: (user, role) for user, role in session.execute(query)}


def validate_rules(
    session: Session,
    org: str,
    composition: Composition,
    rules: list[ChangeRule],
    *,
    lock: bool,
    extra_ids: Iterable[str] = (),
) -> None:
    if len({r.id for r in rules}) != len(rules) or len({r.target.path for r in rules}) != len(
        rules
    ):
        raise service.ServiceError(422, "Règles et chemins distincts requis")
    identities = {u for r in rules for u in [r.owner_user_id, *r.allowed_user_ids]} | set(extra_ids)
    members = accounts(session, org, identities, lock=lock)
    if any(identity not in members for identity in extra_ids):
        raise service.ServiceError(403, "Acteur révoqué")
    departments = {
        d.key: d
        for d in session.scalars(select(Department).where(Department.organization_id == org))
    }
    for rule in rules:
        info = target_info(session, org, composition, rule.target)
        department = departments.get(rule.owner_department)
        if (
            rule.unit != info.unit
            or department is None
            or (
                info.owner_department is not None and rule.owner_department != info.owner_department
            )
            or (
                department.owner_user_id is not None
                and department.owner_user_id != rule.owner_user_id
            )
        ):
            raise service.ServiceError(422, "Unité ou responsabilité de la règle incompatible")
        if (
            any(
                r.capacity.parameter == rule.target.parameter_id
                for r in composition.source.graph.resources
            )
            and rule.minimum < 0
        ):
            raise service.ServiceError(422, "Capacité non négative requise")
        if rule.owner_user_id not in members or members[rule.owner_user_id][1] not in (
            "ADMIN",
            "BUILDER",
            "APPROVER",
        ):
            raise service.ServiceError(422, "Responsable actif autorisé requis")
        if any(
            u not in members or members[u][1] not in ("ADMIN", "BUILDER")
            for u in rule.allowed_user_ids
        ):
            raise service.ServiceError(422, "Délégataires actifs ADMIN/BUILDER requis")


def get_policy(
    session: Session, org: str, identity: str
) -> tuple[ScenarioChangePolicy, ChangePolicyDocument, Composition]:
    policy = session.scalar(
        select(ScenarioChangePolicy).where(
            ScenarioChangePolicy.organization_id == org, ScenarioChangePolicy.id == identity
        )
    )
    if policy is None:
        raise service.ServiceError(404, "Politique introuvable")
    if checksum(policy.payload) != policy.content_hash:
        raise service.ServiceError(409, "Intégrité de politique invalide")
    document = ChangePolicyDocument.model_validate_json(policy.payload)
    model, composition, _ = scenarios._checked_model(session, org, policy.source_model_version_id)
    if (
        document.id,
        document.organization_id,
        document.key,
        document.version,
        document.author_id,
        document.source_model_version_id,
        document.source_content_hash,
    ) != (
        policy.id,
        org,
        policy.key,
        policy.version,
        policy.created_by,
        model.id,
        model.content_hash,
    ) or model.state != "PUBLISHED":
        raise service.ServiceError(409, "Référence ou provenance de politique incompatible")
    return policy, document, composition


def availability(
    session: Session,
    org: str,
    policy: ScenarioChangePolicy,
    document: ChangePolicyDocument,
    *,
    actor_id: str | None = None,
    lock: bool = False,
    extra_ids: Iterable[str] = (),
) -> list[str]:
    owners = {r.owner_user_id for r in document.rules}
    members = accounts(
        session,
        org,
        owners
        | ({policy.published_by} if policy.published_by else set())
        | ({actor_id} if actor_id else set())
        | set(extra_ids),
        lock=lock,
    )
    approvals = {
        a.user_id
        for a in session.scalars(
            select(ScenarioPolicyApproval).where(
                ScenarioPolicyApproval.organization_id == org,
                ScenarioPolicyApproval.policy_version_id == policy.id,
                ScenarioPolicyApproval.policy_content_hash == policy.content_hash,
            )
        )
    }
    departments = {
        d.key: d
        for d in session.scalars(select(Department).where(Department.organization_id == org))
    }
    reasons: list[str] = []
    if any(identity not in members for identity in extra_ids):
        reasons.append("ACTOR_REVOKED")
    if policy.state != "PUBLISHED":
        reasons.append("POLICY_NOT_PUBLISHED")
    if policy.state == "PUBLISHED" and (
        policy.published_by not in members
        or members[policy.published_by][1] not in ("ADMIN", "APPROVER")
    ):
        reasons.append("PUBLISHER_REVOKED")
    for rule in document.rules:
        department = departments.get(rule.owner_department)
        if (
            rule.owner_user_id not in members
            or members[rule.owner_user_id][1] not in ("ADMIN", "BUILDER", "APPROVER")
            or department is None
            or department.owner_user_id not in (None, rule.owner_user_id)
        ):
            reasons.append("OWNER_REVOKED")
        if rule.owner_user_id not in approvals:
            reasons.append("OWNER_APPROVAL_MISSING")
    if actor_id is not None and (
        actor_id not in members or members[actor_id][1] not in ("ADMIN", "BUILDER")
    ):
        reasons.append("ACTOR_REVOKED")
    return sorted(set(reasons))


def require_policy(
    session: Session,
    org: str,
    identity: str,
    *,
    expected_hash: str | None = None,
    actor_id: str | None = None,
    lock: bool = False,
    extra_ids: Iterable[str] = (),
) -> tuple[ScenarioChangePolicy, ChangePolicyDocument, Composition]:
    policy, document, composition = get_policy(session, org, identity)
    if expected_hash is not None and policy.content_hash != expected_hash:
        raise service.ServiceError(409, "Empreinte de politique différente")
    if policy.state != "PUBLISHED":
        raise ChangeError(409, "POLICY_NOT_PUBLISHED")
    reasons = availability(
        session, org, policy, document, actor_id=actor_id, lock=lock, extra_ids=extra_ids
    )
    if reasons:
        raise ChangeError(403, "POLICY_AUTHORITY_REVOKED")
    return policy, document, composition


def policy_view(session: Session, org: str, identity: str) -> ChangePolicyResponse:
    policy, document, _ = get_policy(session, org, identity)
    approvals = list(
        session.scalars(
            select(ScenarioPolicyApproval)
            .where(
                ScenarioPolicyApproval.organization_id == org,
                ScenarioPolicyApproval.policy_version_id == policy.id,
            )
            .order_by(ScenarioPolicyApproval.user_id)
        )
    )
    reasons = availability(session, org, policy, document)
    return ChangePolicyResponse(
        id=policy.id,
        organization_id=org,
        key=policy.key,
        version=policy.version,
        created_by=policy.created_by,
        created_at=policy.created_at,
        content_hash=policy.content_hash,
        state="PUBLISHED" if policy.state == "PUBLISHED" else "DRAFT",
        published_by=policy.published_by,
        published_at=policy.published_at,
        document=document,
        approvals=[
            PolicyApprovalResponse(
                user_id=a.user_id,
                created_at=a.created_at,
                policy_content_hash=a.policy_content_hash,
            )
            for a in approvals
        ],
        usable=not reasons,
        unavailability_reasons=reasons,
    )


def create_policy(
    session: Session, actor: User, org: str, body: ChangePolicyCreate
) -> ChangePolicyResponse:
    scope = service.tenant(session, actor, org, roles=("ADMIN", "BUILDER"), lock=True)
    model, composition, _ = scenarios._checked_model(session, org, body.source_model_version_id)
    if model.state != "PUBLISHED" or model.content_hash != body.expected_source_content_hash:
        raise service.ServiceError(409, "Référence publiée et empreinte exacte requises")
    if session.scalar(
        select(ScenarioChangeLink.scenario_version_id)
        .join(
            ScenarioVersion,
            (ScenarioVersion.id == ScenarioChangeLink.scenario_version_id)
            & (ScenarioVersion.organization_id == ScenarioChangeLink.organization_id),
        )
        .where(ScenarioVersion.organization_id == org, ScenarioVersion.model_version_id == model.id)
    ):
        raise service.ServiceError(409, "Une politique exige une référence hors scénario contrôlé")
    validate_rules(session, org, composition, body.rules, lock=True, extra_ids=(actor.id,))
    existing = session.scalar(
        select(ScenarioChangePolicy).where(
            ScenarioChangePolicy.organization_id == org,
            ScenarioChangePolicy.key == body.key,
            ScenarioChangePolicy.version == body.version,
        )
    )
    identity = existing.id if existing else new_id()
    document = ChangePolicyDocument(
        id=identity,
        organization_id=org,
        author_id=actor.id,
        key=body.key,
        version=body.version,
        name=body.name,
        reason=body.reason,
        source_model_version_id=model.id,
        source_content_hash=model.content_hash,
        rules=sorted(body.rules, key=lambda r: r.id),
    )
    payload = canonical_json(document)
    if existing:
        if existing.payload != payload:
            raise service.ServiceError(409, "Version de politique existante différente")
        return policy_view(session, org, identity)
    policy = ScenarioChangePolicy(
        id=identity,
        organization_id=org,
        key=body.key,
        version=body.version,
        source_model_version_id=model.id,
        payload=payload,
        content_hash=checksum(payload),
        created_by=actor.id,
    )
    session.add(policy)
    session.flush()
    service.audit(session, scope, "scenario_policy.created", identity)
    return policy_view(session, org, identity)


def approve_owner(
    session: Session, actor: User, org: str, identity: str, body: ExpectedPolicy
) -> ChangePolicyResponse:
    scope = service.tenant(session, actor, org, roles=("ADMIN", "BUILDER", "APPROVER"), lock=True)
    policy, document, composition = get_policy(session, org, identity)
    if policy.content_hash != body.expected_policy_content_hash:
        raise service.ServiceError(409, "Empreinte de politique différente")
    validate_rules(session, org, composition, document.rules, lock=True, extra_ids=(actor.id,))
    if actor.id not in {r.owner_user_id for r in document.rules}:
        raise service.ServiceError(403, "Seul un responsable nommé peut approuver ces règles")
    existing = session.get(ScenarioPolicyApproval, (org, identity, actor.id))
    if existing is None:
        if policy.state != "DRAFT":
            raise service.ServiceError(409, "Politique DRAFT requise")
        session.add(
            ScenarioPolicyApproval(
                organization_id=org,
                policy_version_id=identity,
                user_id=actor.id,
                policy_content_hash=policy.content_hash,
            )
        )
        service.audit(session, scope, "scenario_policy.owner_approved", identity)
        session.flush()
    return policy_view(session, org, identity)


def publish_policy(
    session: Session, actor: User, org: str, identity: str, body: ExpectedPolicy
) -> ChangePolicyResponse:
    scope = service.tenant(session, actor, org, roles=("ADMIN", "APPROVER"), lock=True)
    policy, document, composition = get_policy(session, org, identity)
    if policy.content_hash != body.expected_policy_content_hash:
        raise service.ServiceError(409, "Empreinte de politique différente")
    validate_rules(session, org, composition, document.rules, lock=True, extra_ids=(actor.id,))
    reasons = [
        r for r in availability(session, org, policy, document) if r != "POLICY_NOT_PUBLISHED"
    ]
    if reasons:
        raise service.ServiceError(
            403, "Accords de responsables actifs requis : " + ", ".join(reasons)
        )
    if policy.state != "PUBLISHED":
        policy.state, policy.published_by, policy.published_at = "PUBLISHED", actor.id, now()
        service.audit(session, scope, "scenario_policy.published", identity)
        session.flush()
    return policy_view(session, org, identity)
