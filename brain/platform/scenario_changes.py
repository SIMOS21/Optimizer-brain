"""Compile explicitly authorized numeric hypotheses into new immutable artifacts."""

from decimal import Decimal
from fractions import Fraction
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from brain.kernel.numbers import decimal_value
from brain.organization import Composition, compose_organization_model
from brain.organization.composition import canonical_json, checksum
from brain.organization.schema import OrganizationModel
from . import change_policies as policies, scenarios, service
from .change_errors import ChangeError
from .change_contracts import (
    ChangePolicyDocument,
    ChangePreview,
    ChangeRule,
    ControlledCommit,
    ControlledProposal,
    ControlledScenarioDocument,
    RecordedChange,
)
from .models import ScenarioChangeLink, ScenarioVersion, User, new_id
from .schemas import GraphCreate, ModelCreate, ScenarioResponse


def _record(session: Session, org: str, identity: str) -> ScenarioVersion:
    record = session.scalar(
        select(ScenarioVersion).where(
            ScenarioVersion.organization_id == org, ScenarioVersion.id == identity
        )
    )
    if record is None:
        raise service.ServiceError(404, "Scénario parent introuvable")
    if checksum(record.payload) != record.content_hash:
        raise service.ServiceError(409, "Intégrité du scénario invalide")
    return record


def _rules(document: ChangePolicyDocument) -> dict[str, ChangeRule]:
    return {r.id: r for r in document.rules}


def _validate_change(rule: ChangeRule, value: Decimal, unit: str, *, actor_id: str | None) -> None:
    if unit != rule.unit:
        raise ChangeError(422, "UNIT_CHANGE_FORBIDDEN")
    if actor_id is not None and actor_id not in rule.allowed_user_ids:
        raise ChangeError(403, "CHANGE_NOT_DELEGATED")
    if not Fraction(rule.minimum) <= Fraction(value) <= Fraction(rule.maximum):
        raise ChangeError(422, "CHANGE_OUT_OF_RANGE")
    if rule.domain == "INTEGER" and Fraction(value).denominator != 1:
        raise ChangeError(422, "INTEGER_REQUIRED")


def assemble(
    reference: Composition, changes: list[RecordedChange], identity: str, policy_id: str
) -> OrganizationModel:
    """Selectors choose exact numeric slots; paths are never interpreted or executed."""
    raw = json.loads(reference.source_json)
    raw["model_version"] = raw["scenario_id"] = identity
    raw["graph"]["organization"].update(
        version=identity,
        data_snapshot_id="data_" + identity,
        source=f"scenario:{identity};policy:{policy_id}",
    )
    changed = {c.target.parameter_id: c for c in changes}
    for change in changes:
        target = change.target
        registry = (
            raw["shared_parameters"]
            if target.kind != "DEPARTMENT_PARAMETER"
            else next(f["parameters"] for f in raw["fragments"] if f["id"] == target.fragment_id)
        )
        registry[target.parameter_id].update(
            value=change.proposed_value,
            version=identity,
            source=f"scenario:{identity};policy:{policy_id};actor:{change.changed_by}",
        )
    for resource in raw["graph"]["resources"]:
        if resource["capacity"]["parameter"] in changed:
            resource.update(
                capacity_version=identity,
                version=identity,
                source=f"scenario:{identity};policy:{policy_id}",
            )
    for fragment in raw["fragments"]:
        fragment["organization_version"] = fragment["version"] = identity
        for ref in fragment["variable_refs"]:
            ref["declaration_version"] = identity
        for ref in fragment["parameter_refs"]:
            if ref["parameter"] in changed:
                ref["version"] = identity
    return OrganizationModel.model_validate(raw)


def controlled_view(
    session: Session, org: str, record: ScenarioVersion, *, seen: frozenset[str] = frozenset()
) -> ScenarioResponse:
    if record.id in seen or len(seen) >= 16:
        raise service.ServiceError(409, "Filiation cyclique ou profondeur supérieure à 16")
    if checksum(record.payload) != record.content_hash or record.organization_id != org:
        raise service.ServiceError(409, "Intégrité du scénario invalide")
    document = ControlledScenarioDocument.model_validate_json(record.payload)
    link = session.get(ScenarioChangeLink, (org, record.id))
    if link is None or (link.policy_version_id, link.parent_scenario_id) != (
        document.policy_version_id,
        document.parent_scenario_id,
    ):
        raise service.ServiceError(409, "Lien de politique ou parent incompatible")
    policy, policy_document, reference = policies.get_policy(session, org, link.policy_version_id)
    source, _, source_graph = scenarios._checked_model(session, org, record.source_model_version_id)
    derived, composition, graph = scenarios._checked_model(
        session, org, record.model_version_id, require_published_graph=False
    )
    inherited: dict[str, RecordedChange] = {}
    if document.parent_scenario_id:
        parent = _record(session, org, document.parent_scenario_id)
        if json.loads(parent.payload).get("kind") == "CONTROLLED_CHANGES":
            parent_view = controlled_view(session, org, parent, seen=seen | {record.id})
            parent_doc = parent_view.document
            assert isinstance(parent_doc, ControlledScenarioDocument)
            if parent_doc.policy_version_id != policy.id:
                raise service.ServiceError(409, "Politique du parent différente")
            inherited = {c.rule_id: c for c in parent_doc.changes}
        else:
            parent_view = scenarios.scenario_view(session, org, parent)
        if parent_view.model_state != "PUBLISHED" or parent.source_model_version_id != source.id:
            raise service.ServiceError(409, "Parent publié issu de la même référence requis")
    rules = _rules(policy_document)
    if len({c.rule_id for c in document.changes}) != len(document.changes):
        raise service.ServiceError(409, "Changements de scénario dupliqués")
    for change in document.changes:
        prior = inherited.get(change.rule_id)
        if change != prior and (
            change.changed_by != record.created_by
            or change.previous_value != (prior.proposed_value if prior else change.original_value)
        ):
            raise service.ServiceError(
                409, "Auteur ou valeur précédente incompatible avec le parent"
            )
        rule = rules.get(change.rule_id)
        if rule is None or (
            change.target,
            change.unit,
            change.domain,
            change.owner_department,
            change.owner_user_id,
            change.original_value,
        ) != (
            rule.target,
            rule.unit,
            rule.domain,
            rule.owner_department,
            rule.owner_user_id,
            str(policies.parameter(reference, rule.target).value),
        ):
            raise service.ServiceError(409, "Changement incompatible avec la politique")
        _validate_change(rule, decimal_value(change.proposed_value), change.unit, actor_id=None)
    if not set(inherited).issubset(c.rule_id for c in document.changes):
        raise service.ServiceError(409, "Changement hérité supprimé")
    identity = "scenario_" + record.id.replace("-", "")
    expected = assemble(reference, document.changes, identity, policy.id)
    if (
        (
            document.id,
            document.organization_id,
            document.key,
            document.version,
            document.author_id,
            document.source_model_version_id,
            document.source_content_hash,
            document.model_version_id,
            document.model_content_hash,
            document.graph_snapshot_id,
            document.graph_content_hash,
            document.data_snapshot_id,
            document.source_graph_snapshot_id,
            document.source_data_snapshot_id,
            document.scenario_id,
            document.policy_content_hash,
            document.preview_hash,
        )
        != (
            record.id,
            org,
            record.key,
            record.version,
            record.created_by,
            source.id,
            source.content_hash,
            derived.id,
            derived.content_hash,
            graph.id,
            graph.content_hash,
            record.data_snapshot_id,
            source_graph.id,
            source.data_snapshot_id,
            identity,
            policy.content_hash,
            record.request_hash,
        )
        or policy.source_model_version_id != source.id
        or policy.state != "PUBLISHED"
        or derived.data_snapshot_id != record.data_snapshot_id
        or record.graph_snapshot_id != graph.id
        or canonical_json(compose_organization_model(expected).to_dict()) != derived.payload
        or (derived.state == "PUBLISHED" and graph.state != "PUBLISHED")
    ):
        raise service.ServiceError(
            409, "Artefacts ou provenance du scénario contrôlé incompatibles"
        )
    return ScenarioResponse(
        id=record.id,
        organization_id=org,
        key=record.key,
        version=record.version,
        created_by=record.created_by,
        created_at=record.created_at,
        content_hash=record.content_hash,
        model_version_id=derived.id,
        source_model_version_id=source.id,
        model_state="PUBLISHED" if derived.state == "PUBLISHED" else "DRAFT",
        document=document,
    )


def preview(session: Session, actor: User, org: str, proposal: ControlledProposal) -> ChangePreview:
    service.tenant(session, actor, org, roles=("ADMIN", "BUILDER"), lock=True)
    policy, document, reference = policies.require_policy(
        session,
        org,
        proposal.policy_version_id,
        expected_hash=proposal.expected_policy_content_hash,
        actor_id=actor.id,
        lock=True,
    )
    if (proposal.source_model_version_id, proposal.expected_source_content_hash) != (
        document.source_model_version_id,
        document.source_content_hash,
    ):
        raise service.ServiceError(409, "Politique et référence différentes")
    if len({c.rule_id for c in proposal.changes}) != len(proposal.changes):
        raise service.ServiceError(422, "Changements dupliqués")
    parent_hash = None
    cumulative: dict[str, RecordedChange] = {}
    if proposal.parent_scenario_id:
        parent = _record(session, org, proposal.parent_scenario_id)
        parent_view = scenarios.scenario_view(session, org, parent)
        if (
            parent_view.source_model_version_id != document.source_model_version_id
            or parent_view.model_state != "PUBLISHED"
        ):
            raise service.ServiceError(409, "Parent publié de la même référence requis")
        if isinstance(parent_view.document, ControlledScenarioDocument):
            if parent_view.document.policy_version_id != policy.id:
                raise service.ServiceError(409, "Le parent doit utiliser la même politique")
            cumulative = {c.rule_id: c for c in parent_view.document.changes}
        parent_hash = parent.content_hash
    rules = _rules(document)
    for requested in proposal.changes:
        rule = rules.get(requested.rule_id)
        if rule is None:
            raise ChangeError(422, "RULE_NOT_ALLOWED")
        _validate_change(rule, requested.value, requested.unit, actor_id=actor.id)
        original = str(policies.parameter(reference, rule.target).value)
        previous = cumulative[rule.id].proposed_value if rule.id in cumulative else original
        cumulative[rule.id] = RecordedChange(
            rule_id=rule.id,
            target=rule.target,
            unit=rule.unit,
            domain=rule.domain,
            owner_department=rule.owner_department,
            owner_user_id=rule.owner_user_id,
            original_value=original,
            previous_value=previous,
            proposed_value=str(requested.value),
            changed_by=actor.id,
            source=requested.source,
        )
    for change in cumulative.values():
        _validate_change(
            rules[change.rule_id],
            decimal_value(change.proposed_value),
            change.unit,
            actor_id=actor.id,
        )
    changes = sorted(cumulative.values(), key=lambda c: c.rule_id)
    token = checksum(
        canonical_json(
            {
                "proposal": proposal,
                "author": actor.id,
                "parent_hash": parent_hash,
                "policy_hash": policy.content_hash,
                "changes": changes,
            }
        )
    )
    compiled = compose_organization_model(
        assemble(reference, changes, "preview_" + token[:32], policy.id)
    )
    affected: set[str] = set()
    objective = False
    for change in changes:
        info = policies.target_info(session, org, reference, change.target)
        affected.update(info.affected_constraint_ids)
        objective |= info.affects_objective
    return ChangePreview(
        organization_id=org,
        source_model_version_id=document.source_model_version_id,
        source_content_hash=document.source_content_hash,
        policy_version_id=policy.id,
        policy_content_hash=policy.content_hash,
        parent_scenario_id=proposal.parent_scenario_id,
        preview_hash=token,
        model_hash=compiled.ir.model_hash,
        changes=changes,
        affected_constraint_ids=sorted(affected),
        affects_objective=objective,
    )


def create_controlled(
    session: Session, actor: User, org: str, body: ControlledCommit
) -> ScenarioResponse:
    scope = service.tenant(session, actor, org, roles=("ADMIN", "BUILDER"), lock=True)
    proposed = body.proposal
    report = preview(session, actor, org, proposed)
    if report.preview_hash != body.expected_preview_hash:
        raise ChangeError(409, "PREVIEW_CHANGED")
    family = session.scalars(
        select(ScenarioVersion).where(
            ScenarioVersion.organization_id == org, ScenarioVersion.key == proposed.key
        )
    ).all()
    for existing in family:
        if existing.source_model_version_id != proposed.source_model_version_id:
            raise service.ServiceError(409, "Référence de famille différente")
        if existing.version == proposed.version:
            if existing.request_hash != report.preview_hash:
                raise service.ServiceError(409, "Version de scénario existante différente")
            return scenarios.scenario_view(session, org, existing)
    policy, policy_document, reference = policies.require_policy(
        session, org, proposed.policy_version_id
    )
    source, _, source_graph = scenarios._checked_model(
        session, org, policy_document.source_model_version_id
    )
    identity = new_id()
    scenario_identity = "scenario_" + identity.replace("-", "")
    changed = assemble(reference, report.changes, scenario_identity, policy.id)
    graph = service.create_graph(
        session,
        actor,
        org,
        GraphCreate(graph=changed.graph, shared_parameters=changed.shared_parameters),
    )
    model = service.create_model(
        session,
        actor,
        org,
        ModelCreate(graph_snapshot_id=graph.id, model=changed),
        allow_draft_graph=True,
    )
    if model.model_hash != report.model_hash:
        raise service.ServiceError(409, "La compilation diffère de la prévisualisation")
    document = ControlledScenarioDocument(
        id=identity,
        organization_id=org,
        key=proposed.key,
        version=proposed.version,
        name=proposed.name,
        reason=proposed.reason,
        author_id=actor.id,
        source_model_version_id=source.id,
        source_content_hash=source.content_hash,
        source_graph_snapshot_id=source_graph.id,
        source_data_snapshot_id=source.data_snapshot_id,
        model_version_id=model.id,
        model_content_hash=model.content_hash,
        graph_snapshot_id=graph.id,
        graph_content_hash=graph.content_hash,
        data_snapshot_id=model.data_snapshot_id,
        scenario_id=scenario_identity,
        policy_version_id=policy.id,
        policy_content_hash=policy.content_hash,
        parent_scenario_id=proposed.parent_scenario_id,
        preview_hash=report.preview_hash,
        changes=report.changes,
    )
    payload = canonical_json(document)
    record = ScenarioVersion(
        id=identity,
        organization_id=org,
        key=proposed.key,
        version=proposed.version,
        source_model_version_id=source.id,
        model_version_id=model.id,
        graph_snapshot_id=graph.id,
        data_snapshot_id=model.data_snapshot_id,
        request_hash=report.preview_hash,
        payload=payload,
        content_hash=checksum(payload),
        created_by=actor.id,
    )
    session.add(record)
    session.flush()
    session.add(
        ScenarioChangeLink(
            organization_id=org,
            scenario_version_id=identity,
            policy_version_id=policy.id,
            parent_scenario_id=proposed.parent_scenario_id,
        )
    )
    service.audit(
        session,
        scope,
        "scenario.controlled_created",
        identity,
    )
    session.flush()
    return controlled_view(session, org, record)


def guard_artifact(
    session: Session, actor: User, org: str, identity: str, *, model: bool, execution: bool
) -> None:
    query = (
        select(ScenarioVersion)
        .join(
            ScenarioChangeLink,
            (ScenarioVersion.id == ScenarioChangeLink.scenario_version_id)
            & (ScenarioVersion.organization_id == ScenarioChangeLink.organization_id),
        )
        .where(
            ScenarioVersion.organization_id == org,
            ScenarioVersion.model_version_id == identity
            if model
            else ScenarioVersion.graph_snapshot_id == identity,
        )
    )
    record = session.scalar(query)
    if record is None:
        return
    response = controlled_view(session, org, record)
    document = response.document
    assert isinstance(document, ControlledScenarioDocument)
    _, policy_document, _ = policies.require_policy(
        session,
        org,
        document.policy_version_id,
        expected_hash=document.policy_content_hash,
        actor_id=actor.id if execution else None,
        lock=True,
        extra_ids=(actor.id,),
    )
    if execution:
        rules = _rules(policy_document)
        for change in document.changes:
            _validate_change(
                rules[change.rule_id],
                decimal_value(change.proposed_value),
                change.unit,
                actor_id=actor.id,
            )


def protect_graph_reuse(
    session: Session, actor: User, org: str, graph_id: str, payload: str
) -> None:
    """A generic ModelCreate cannot detach controlled data from its policy lineage."""
    record = session.scalar(
        select(ScenarioVersion)
        .join(
            ScenarioChangeLink,
            (ScenarioVersion.id == ScenarioChangeLink.scenario_version_id)
            & (ScenarioVersion.organization_id == ScenarioChangeLink.organization_id),
        )
        .where(
            ScenarioVersion.organization_id == org, ScenarioVersion.graph_snapshot_id == graph_id
        )
    )
    if record is not None:
        guard_artifact(session, actor, org, record.model_version_id, model=True, execution=True)
        original = service.get_model(session, org, record.model_version_id)
        if payload != original.payload:
            raise service.ServiceError(
                409,
                "Un graphe contrôlé conserve sa filiation ; utiliser un nouveau scénario sous politique",
            )
