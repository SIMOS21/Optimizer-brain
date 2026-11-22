"""Compile, check support, solve, independently verify, then qualify the result."""

from datetime import datetime, timezone
from dataclasses import replace
from fractions import Fraction
import math
from time import perf_counter
from uuid import uuid4

from pydantic import ValidationError

from brain.kernel import ModelCompilationError, compile_model, load_model_json
from brain.kernel.ir import OptimizationIR
from brain.kernel.verification import SolutionVerifier
from .contracts import (
    RawSolveResult,
    SolveResult,
    SolveSettings,
    SolverAdapter,
    Status,
    SupportReport,
)


def _finite(value: float | None) -> float | None:
    return value if value is not None and math.isfinite(value) else None


class SolverOrchestrator:
    def __init__(self, adapter: SolverAdapter | None = None):
        if adapter is None:
            from .highs import HighsAdapter

            adapter = HighsAdapter()
        self.adapter = adapter
        self.verifier = SolutionVerifier()

    def run(self, raw_model: object, settings: SolveSettings | None = None) -> SolveResult:
        settings = SolveSettings.model_validate(settings.model_dump() if settings else {})
        started = datetime.now(timezone.utc).isoformat()
        clock = perf_counter()
        capabilities = self.adapter.get_capabilities()
        model: OptimizationIR | None = None
        raw: RawSolveResult | None = None
        support: SupportReport | None = None
        warnings: list[str] = []

        def finish(status: Status, message: str = "") -> SolveResult:
            nonlocal raw
            report = None
            decisions = None
            objective = None
            bound = _finite(raw.best_bound) if raw else None
            gap = _finite(raw.relative_gap) if raw else None
            solver_objective = _finite(raw.objective) if raw else None
            absolute_gap = None
            certificate = label = None
            if raw and raw.decisions is not None and model:
                candidate = dict(raw.decisions)
                report = self.verifier.verify(
                    model, candidate, raw.objective, settings.verification
                )
                if len(candidate) != len(raw.decisions):
                    issue = "Identifiants de décision dupliqués dans la réponse backend"
                    report = replace(report, valid=False, issues=report.issues + (issue,))
                    status = "SOLUTION_FAILED_VALIDATION"
                if not report.valid:
                    status = "SOLUTION_FAILED_VALIDATION"
                elif status != "SOLUTION_FAILED_VALIDATION":
                    if status in ("INFEASIBLE", "UNBOUNDED"):
                        status = "ERROR"
                        warnings.append("Statut backend contradictoire avec un témoin réalisable")
                    elif status not in ("ERROR", "INVALID_MODEL"):
                        decisions, objective = raw.decisions, report.objective_value
                        if status == "UNKNOWN":
                            status = "FEASIBLE"
            elif status == "OPTIMAL":
                status = "ERROR"
                warnings.append("Statut optimal sans solution à vérifier")
            if gap is not None and gap < 0:
                warnings.append("Gap backend négatif ignoré")
                gap = None
                if status == "OPTIMAL":
                    status = "FEASIBLE"
            if raw and raw.relative_gap is not None and not math.isfinite(raw.relative_gap):
                warnings.append("Gap backend non fini indisponible")
            if raw and raw.best_bound is not None and bound is None:
                warnings.append("Borne backend non finie indisponible")
            if bound is not None and solver_objective is not None:
                absolute_gap = abs(
                    Fraction.from_float(solver_objective) - Fraction.from_float(bound)
                )
                assert model is not None
                difference = Fraction.from_float(bound) - Fraction.from_float(solver_objective)
                if model.objectives[0].sense == "MIN":
                    difference = -difference
                if difference < -Fraction(settings.verification.objective_absolute_tolerance):
                    warnings.append("Borne backend incohérente avec l'objectif ; preuve refusée")
                    bound = gap = absolute_gap = None
                    if status == "OPTIMAL":
                        status = "FEASIBLE"
            if status == "OPTIMAL" and solver_objective is None:
                status = "FEASIBLE"
                warnings.append("Objectif backend absent ; preuve d'optimalité non publiée")
            conversion = support.conversion if support else None
            if conversion and conversion.rounded_count:
                warnings.append(
                    "Conversion rationnel/binary64 non exacte ; statut du modèle original non certifié"
                )
                if status == "OPTIMAL":
                    status = "FEASIBLE"
                elif status in ("INFEASIBLE", "UNBOUNDED"):
                    status = "UNKNOWN"
            if status == "OPTIMAL":
                certificate = "solver_tolerances"
                label = (
                    "optimal à tolérance près (modèle binary64, sans certificat rationnel strict)"
                )
            if capabilities.solver_version is None:
                warnings.append("Version native HiGHS indisponible via cette installation SciPy")
            public = {
                "FEASIBLE": "FEASIBLE_NOT_PROVEN_OPTIMAL",
                "ERROR": "SOLVER_ERROR",
                "TIME_LIMIT": "FEASIBLE_NOT_PROVEN_OPTIMAL"
                if decisions is not None
                else "TIME_LIMIT_NO_SOLUTION",
            }.get(status, status)
            return SolveResult(
                run_id=str(uuid4()),
                status=status,
                public_status=public,
                termination_reason=raw.termination_reason if raw else status.lower(),
                model_id=model.model_id if model else None,
                model_version=model.model_version if model else None,
                data_snapshot_id=model.data_snapshot_id if model else None,
                scenario_id=model.scenario_id if model else None,
                model_hash=model.model_hash if model else None,
                manifest_hash=model.manifest_hash if model else None,
                solver_name=capabilities.name,
                solver_version=capabilities.solver_version,
                interface_name=capabilities.interface_name,
                interface_version=capabilities.interface_version,
                solver_status_raw=raw.status_code if raw else None,
                solver_message=message or (raw.message if raw else ""),
                solver_options=raw.options if raw else (),
                backend_defaults=raw.backend_defaults if raw else (),
                settings=settings,
                started_at=started,
                duration_ms=(perf_counter() - clock) * 1000,
                decision_values=decisions,
                objective_value=objective,
                objective_unit=model.objectives[0].unit if model else None,
                solver_objective_value=solver_objective,
                best_bound=bound,
                absolute_gap=absolute_gap,
                relative_gap=gap,
                gap_scope="binary64_backend_model"
                if bound is not None or gap is not None
                else None,
                certificate_scope=certificate,
                optimality_label=label,
                primal_residual_max=report.primal_residual_max if report else None,
                integrality_residual_max=report.integrality_residual_max if report else None,
                validation_report=report,
                conversion_report=conversion,
                warnings=tuple(warnings),
            )

        try:
            model = compile_model(
                load_model_json(raw_model) if isinstance(raw_model, str) else raw_model
            )
        except (ValidationError, ModelCompilationError, ValueError) as exc:
            return finish("INVALID_MODEL", str(exc))
        warnings.extend(f"{issue.path}: {issue.code}: {issue.message}" for issue in model.warnings)
        try:
            support = self.adapter.supports(model)
            if not support.supported:
                return finish("INVALID_MODEL", "; ".join(support.issues))
            raw = self.adapter.solve(model, settings)
            if raw.termination_reason in ("unknown", "ambiguous", "limit"):
                warnings.append(
                    "Terminaison inconnue, ambiguë ou limitée : aucune preuve d'optimalité"
                )
            statuses: dict[str, Status] = {
                "optimal": "OPTIMAL",
                "infeasible": "INFEASIBLE",
                "unbounded": "UNBOUNDED",
                "time_limit": "TIME_LIMIT",
                "error": "ERROR",
            }
            status = statuses.get(raw.termination_reason, "UNKNOWN")
            if status == "OPTIMAL" and capabilities.name == "highs" and raw.status_code != 0:
                status = "UNKNOWN"
                warnings.append("Code natif incompatible avec la déclaration d'optimalité")
            return finish(status)
        except Exception as exc:
            # Native/backend failures must produce an auditable failed run, never a plan.
            raw = None
            return finish("ERROR", f"{type(exc).__name__}: {exc}")
