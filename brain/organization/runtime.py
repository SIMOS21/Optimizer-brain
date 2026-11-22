"""One global solve through the phase 2 pipeline, then independently measured views."""

from dataclasses import dataclass

from brain.kernel.ir import to_data
from brain.solvers.contracts import SolveResult, SolveSettings, SolverAdapter
from brain.solvers.orchestrator import SolverOrchestrator
from .composition import Composition, compose_organization_model
from .reporting import OrganizationReport, build_report, graph_mermaid


@dataclass(frozen=True)
class OrganizationRun:
    composition: Composition
    solve: SolveResult
    report: OrganizationReport

    def to_dict(self) -> dict[str, object]:
        return {
            "composition": self.composition.to_dict(),
            "solve": self.solve.to_dict(),
            "report": to_data(self.report),
            "mermaid": graph_mermaid(self.composition),
        }


def solve_organization(
    raw: object, settings: SolveSettings | None = None, *, adapter: SolverAdapter | None = None
) -> OrganizationRun:
    composition = compose_organization_model(raw)
    result = SolverOrchestrator(adapter).run(composition.model, settings)
    return OrganizationRun(composition, result, build_report(composition, result))
