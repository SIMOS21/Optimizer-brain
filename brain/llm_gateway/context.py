"""Deterministic, lossless facts built only from independently checked evidence."""

from fractions import Fraction
from typing import Literal

from brain.organization.composition import canonical_json, checksum
from brain.scenario_comparison import ComparisonReport
from .contracts import (
    ArtifactReference,
    ExplanationPreview,
    ExplanationSelection,
    GroundedFact,
    ExplanationResponse,
    ModelSelection,
)
from .provider import GatewayError, NvidiaSettings, strict_json

STATUS_TEXT = {
    "OPTIMAL": "Optimalité attestée par le solveur dans ses tolérances enregistrées, pas un optimum rationnel exact.",
    "FEASIBLE_NOT_PROVEN_OPTIMAL": "Plan réalisable revérifié ; optimalité non prouvée.",
    "INFEASIBLE": "Modèle déclaré infaisable ; aucune cause particulière n’est démontrée ici.",
    "TIME_LIMIT_NO_SOLUTION": "Limite de temps atteinte sans plan vérifié disponible.",
    "SOLUTION_FAILED_VALIDATION": "Résultat refusé par la vérification indépendante.",
    "UNBOUNDED": "Problème déclaré non borné ; aucun optimum fini fourni.",
    "CANCELLED": "Résolution annulée ; aucun résultat nouveau n’est déduit.",
    "INVALID_MODEL": "Modèle déclaré invalide.",
    "SOLVER_ERROR": "Erreur du solveur ; aucune décision déduite.",
    "UNKNOWN": "Preuve insuffisante ; aucune faisabilité ou optimalité déduite.",
}


def build_context(
    report: ComparisonReport, selection: ExplanationSelection, settings: NvidiaSettings
) -> ExplanationPreview:
    facts: list[GroundedFact] = []
    references: list[ArtifactReference] = []

    def add(kind: str, text: str, *values: str) -> None:
        for value in values:
            # Rational strings only, never names/units/IDs/prompts from business fields.
            if len(value) > 256 or str(Fraction(value)) != value:
                raise GatewayError("LLM_CONTEXT_TOO_LARGE", 422)
        facts.append(
            GroundedFact.model_validate(
                {
                    "id": f"f{len(facts)}",
                    "kind": kind,
                    "text": text,
                    "values": values,
                }
            )
        )

    pair = selection.baseline_run_id is not None
    sides = (
        (("Référence", report.baseline), ("Candidat", report.candidate))
        if pair
        else (("Run", report.candidate),)
    )
    for label, run in sides:
        if run is None:
            raise GatewayError("LLM_INVALID_ARTIFACT", 409)
        references.append(
            ArtifactReference(
                run_id=run.run_id,
                content_hash=run.content_hash,
                model_version_id=run.model_version_id,
                model_content_hash=run.model_content_hash,
                graph_snapshot_id=run.graph_snapshot_id,
                data_snapshot_id=run.data_snapshot_id,
                verified_plan=run.verified_plan,
                public_status=run.public_status,
            )
        )
        description = STATUS_TEXT.get(run.public_status, STATUS_TEXT["UNKNOWN"])
        if not run.verified_plan:
            # Even an incoherent favorable recorded status cannot be promoted to an assertion.
            description = (
                description
                if run.public_status not in ("OPTIMAL", "FEASIBLE_NOT_PROVEN_OPTIMAL")
                else STATUS_TEXT["UNKNOWN"]
            )
            description += (
                " Aucun objectif ni décision exploitable : plan absent ou revérification refusée."
            )
        add("STATUS", f"{label} : {description}")
        if run.verified_plan and run.objective_value is not None:
            add(
                "OBJECTIVE",
                f"{label} : objectif {run.objective_value} {run.objective_unit} ({run.objective_sense}), recalculé sur l’IR originale.",
                run.objective_value,
            )

    # Explicit truncation is disclosed; the complete immutable artifacts remain linked.
    for side, label, run in (
        ("baseline", "Référence", report.baseline),
        ("candidate", "Candidat" if pair else "Run", report.candidate),
    ):
        if (side == "baseline" and not pair) or run is None or not run.verified_plan:
            continue
        if selection.intent != "RESOURCES":
            for decision in report.decisions[:10]:
                value = decision.baseline_value if side == "baseline" else decision.candidate_value
                unit = decision.baseline_unit if side == "baseline" else decision.candidate_unit
                if value is not None:
                    add("DECISION", f"{label} : {decision.id} = {value} {unit or ''}.", value)
        for resource in report.resources[:10]:
            measure = resource.baseline if side == "baseline" else resource.candidate
            # Use typed model access rather than trusting stored report text.
            if measure is not None:
                if measure.consumption is not None and measure.remaining is not None:
                    state = (
                        "saturée dans les tolérances enregistrées"
                        if measure.state == "SATURATED"
                        else "avec marge mesurée"
                    )
                    add(
                        "RESOURCE",
                        f"{label} : ressource {resource.id}, {measure.consumption}/{measure.capacity} {measure.unit}, marge {measure.remaining} ; {state}. Une saturation ne démontre ni causalité, ni prix d’ombre, ni gain.",
                        measure.consumption,
                        measure.capacity,
                        measure.remaining,
                    )
        for constraint in report.constraints[:10]:
            measure_c = constraint.baseline if side == "baseline" else constraint.candidate
            if measure_c and measure_c.lhs is not None and measure_c.slack is not None:
                add(
                    "CONSTRAINT",
                    f"{label} : contrainte {constraint.id}, état {measure_c.state}, membre gauche {measure_c.lhs}, membre droit {measure_c.rhs}, marge {measure_c.slack}, tolérance {measure_c.tolerance} {measure_c.unit}.",
                    measure_c.lhs,
                    measure_c.rhs,
                    measure_c.slack,
                    measure_c.tolerance,
                )
    if pair:
        delta = report.observed_objective_delta
        add(
            "COMPARISON",
            (
                f"Comparaison {report.comparability}. Écart observé candidat − référence : {delta} {report.objective_unit}. Aucun gain économique démontré."
                if delta is not None
                else "Preuves ou comparabilité insuffisantes : aucun écart d’objectif exploitable, aucun gain économique démontré."
            ),
            *((delta,) if delta is not None else ()),
        )
    add(
        "LIMIT",
        "Les faits portent sur les IR et tolérances historiques. Aucun nouveau calcul de scénario, prix d’ombre, causalité ou gain économique n’est fourni.",
    )
    if len(report.decisions) > 10 or len(report.resources) > 10 or len(report.constraints) > 10:
        add(
            "LIMIT",
            "Contexte limité aux premières décisions, ressources et contraintes dans l’ordre du rapport. Consulter les artefacts pour la liste complète.",
        )
    outbound = canonical_json(
        {
            "schema_version": "7A.1",
            "intent": selection.intent,
            "facts": [{"id": f.id, "kind": f.kind, "values": f.values} for f in facts],
        }
    )
    hashes = {ref.model_content_hash for ref in references}
    availability: Literal["READY", "DISABLED", "NOT_AUTHORIZED", "MISSING_API_KEY"] = (
        "DISABLED"
        if not settings.enabled
        else "NOT_AUTHORIZED"
        if report.organization_id not in settings.organizations
        or not hashes <= settings.public_model_hashes
        else "MISSING_API_KEY"
        if not settings.api_key
        else "READY"
    )
    identity = canonical_json(
        {
            "report": report.report_hash,
            "selection": selection.model_dump(),
            "outbound": outbound,
            "model": settings.model,
        }
    )
    return ExplanationPreview(
        organization_id=report.organization_id,
        selection=selection,
        context_hash=checksum(identity),
        enabled=availability == "READY",
        availability=availability,
        model=settings.model,
        facts=tuple(facts),
        references=tuple(references),
        outbound_json=outbound,
    )


def render_explanation(preview: ExplanationPreview, content: str) -> ExplanationResponse:
    try:
        strict_json(content)  # Reject duplicate keys and non-JSON numeric constants first.
        selected = ModelSelection.model_validate_json(content)
        ids = selected.fact_ids
        if len(ids) != len(set(ids)) or not set(ids) <= {f.id for f in preview.facts}:
            raise ValueError("Unknown or repeated fact")
    except (ValueError, TypeError, RecursionError):
        raise GatewayError("LLM_INVALID_RESPONSE", 502) from None
    # The model cannot omit essential qualifications, statuses or pair limitations.
    mandatory = [f.id for f in preview.facts if f.kind in ("STATUS", "LIMIT", "COMPARISON")]
    all_ids = tuple(dict.fromkeys([*mandatory, *ids]))
    by_id = {f.id: f for f in preview.facts}
    return ExplanationResponse(
        organization_id=preview.organization_id,
        context_hash=preview.context_hash,
        model=preview.model,
        selected_fact_ids=all_ids,
        paragraphs=tuple(by_id[key].text for key in all_ids),
        facts=preview.facts,
        references=preview.references,
    )
