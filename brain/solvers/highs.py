"""Generic sparse MILP adapter using the same SciPy/HiGHS backend as the MVP."""

from dataclasses import dataclass
from fractions import Fraction
from importlib import import_module
import math
from typing import Any

import numpy as np
from numpy.typing import NDArray
import scipy
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csc_matrix

from brain.kernel.ir import OptimizationIR
from .contracts import (
    ConversionReport,
    Option,
    RawSolveResult,
    SolveSettings,
    SolverCapabilities,
    SupportReport,
)


@dataclass
class _Conversion:
    count: int = 0
    rounded: int = 0
    absolute: Fraction = Fraction(0)
    relative: Fraction = Fraction(0)

    def number(self, value: Fraction, path: str, *, coefficient: bool = False) -> float:
        try:
            converted = float(value)
        except OverflowError as exc:
            raise ValueError(f"{path}: overflow binary64") from exc
        if not math.isfinite(converted) or abs(value) > 10**12:
            raise ValueError(f"{path}: valeur hors politique numérique (|valeur| <= 1e12)")
        if value and (converted == 0 or (coefficient and abs(value) <= Fraction(1, 10**9))):
            raise ValueError(
                f"{path}: coefficient trop petit ou underflow ; remettre les unités à l'échelle"
            )
        error = abs(Fraction.from_float(converted) - value)
        relative = error / abs(value) if value else Fraction(0)
        if relative > Fraction(1, 10**12):
            raise ValueError(f"{path}: perte de précision excessive")
        self.count += 1
        self.rounded += bool(error)
        self.absolute = max(self.absolute, error)
        self.relative = max(self.relative, relative)
        return converted

    def report(self) -> ConversionReport:
        return ConversionReport(self.count, self.rounded, self.absolute, self.relative)


@dataclass(frozen=True)
class MatrixProblem:
    objective: NDArray[np.float64]
    integrality: NDArray[np.int32]
    lower_bounds: NDArray[np.float64]
    upper_bounds: NDArray[np.float64]
    # SciPy's sparse/optimization modules do not ship complete typing stubs.
    constraints: Any
    conversion: ConversionReport


def to_milp(model: OptimizationIR) -> MatrixProblem:
    if len(model.objectives) != 1 or not model.variables:
        raise ValueError("Un objectif et au moins une variable requis")
    if model.objectives[0].sense not in ("MAX", "MIN"):
        raise ValueError("Sens d'objectif non supporté")
    converter = _Conversion()
    registry = {variable.id: index for index, variable in enumerate(model.variables)}
    if len(registry) != len(model.variables):
        raise ValueError("Identifiants de variables dupliqués")
    lower, upper, integrality = [], [], []
    for variable in model.variables:
        if variable.domain not in ("CONTINUOUS", "INTEGER", "BINARY"):
            raise ValueError("Domaine non supporté")
        lb = (
            converter.number(variable.lb, variable.id + ".lb")
            if variable.lb is not None
            else -np.inf
        )
        ub = (
            converter.number(variable.ub, variable.id + ".ub")
            if variable.ub is not None
            else np.inf
        )
        if lb > ub or (variable.lb != variable.ub and lb == ub):
            raise ValueError(f"{variable.id}: bornes inversées ou confondues par conversion")
        lower.append(lb)
        upper.append(ub)
        integrality.append(0 if variable.domain == "CONTINUOUS" else 1)
    c = np.zeros(len(model.variables), dtype=np.float64)
    sign = -1 if model.objectives[0].sense == "MAX" else 1
    for term in model.objectives[0].terms:
        c[registry[term.variable]] += sign * converter.number(
            term.coefficient, "objective." + term.variable, coefficient=True
        )
    row_indices, column_indices, data, row_lower, row_upper = [], [], [], [], []
    for index, row in enumerate(model.constraints):
        if row.operator not in ("<=", ">=", "=="):
            raise ValueError("Comparateur non supporté")
        rhs = converter.number(row.rhs, row.id + ".rhs")
        row_lower.append(rhs if row.operator in (">=", "==") else -np.inf)
        row_upper.append(rhs if row.operator in ("<=", "==") else np.inf)
        for term in row.terms:
            row_indices.append(index)
            column_indices.append(registry[term.variable])
            data.append(
                converter.number(term.coefficient, row.id + "." + term.variable, coefficient=True)
            )
    matrix = csc_matrix(
        (data, (row_indices, column_indices)),
        shape=(len(model.constraints), len(model.variables)),
        dtype=np.float64,
    )
    return MatrixProblem(
        c,
        np.asarray(integrality, dtype=np.int32),
        np.asarray(lower),
        np.asarray(upper),
        LinearConstraint(matrix, np.asarray(row_lower), np.asarray(row_upper)),
        converter.report(),
    )


def _backend_metadata() -> tuple[str | None, tuple[tuple[str, Option], ...]]:
    # Optional inspection only: the private layout differs between SciPy versions.
    # Unknown values remain null/absent, never inferred from the SciPy version.
    try:
        core = import_module("scipy.optimize._highspy._core")
        version = ".".join(
            str(getattr(core, "HIGHS_VERSION_" + part)) for part in ("MAJOR", "MINOR", "PATCH")
        )
        options = core._Highs().getOptions()
        defaults: list[tuple[str, Option]] = []
        for name in (
            "primal_feasibility_tolerance",
            "dual_feasibility_tolerance",
            "mip_feasibility_tolerance",
            "mip_abs_gap",
            "small_matrix_value",
            "large_matrix_value",
            "infinite_bound",
            "infinite_cost",
        ):
            value = getattr(options, name, None)
            if isinstance(value, (int, float)) and math.isfinite(value):
                defaults.append((name, float(value)))
        return version, tuple(defaults)
    except (ImportError, AttributeError, TypeError, RuntimeError):
        return None, ()


class HighsAdapter:
    def get_capabilities(self) -> SolverCapabilities:
        version, _ = _backend_metadata()
        return SolverCapabilities("highs", version, "scipy.optimize.milp", scipy.__version__)

    def supports(self, model: OptimizationIR) -> SupportReport:
        try:
            problem = to_milp(model)
            return SupportReport(True, conversion=problem.conversion)
        except (ValueError, KeyError, OverflowError) as exc:
            return SupportReport(False, (str(exc),))

    def solve(self, model: OptimizationIR, settings: SolveSettings) -> RawSolveResult:
        problem = to_milp(model)
        options: dict[str, Option] = {
            "time_limit": settings.time_limit_seconds,
            "mip_rel_gap": settings.mip_rel_gap,
            "presolve": settings.presolve,
            "disp": False,
        }
        if settings.node_limit is not None:
            options["node_limit"] = settings.node_limit
        # SciPy may mutate the dictionary; retain an immutable copy of supplied options.
        used = tuple(sorted(options.items()))
        result = milp(
            c=problem.objective,
            integrality=problem.integrality,
            bounds=Bounds(problem.lower_bounds, problem.upper_bounds),
            constraints=problem.constraints,
            options=dict(options),
        )
        status = getattr(result, "status", None)
        code = (
            int(status)
            if isinstance(status, (int, np.integer)) and not isinstance(status, bool)
            else None
        )
        message = str(getattr(result, "message", ""))
        reasons: dict[int | None, str] = {
            0: "optimal",
            1: "limit",
            2: "infeasible",
            3: "unbounded",
            4: "error",
        }
        reason = reasons.get(code, "unknown")
        if code == 1 and "time limit reached" in message.lower():
            reason = "time_limit"
        if code == 4 and any(
            text in message.lower()
            for text in ("unbounded or infeasible", "infeasible or unbounded")
        ):
            reason = "ambiguous"
        if code == 0 and (
            getattr(result, "success", None) is not True
            or any(
                text in message.lower()
                for text in ("unknown", "not optimal", "limit reached", "infeasible", "unbounded")
            )
        ):
            reason = "unknown"
        values = getattr(result, "x", None)
        decisions = None
        if values is not None:
            decisions = tuple(
                (
                    model.variables[index].id
                    if index < len(model.variables)
                    else f"unexpected_{index}",
                    float(value),
                )
                for index, value in enumerate(values)
            )
        sign = -1 if model.objectives[0].sense == "MAX" else 1
        objective = getattr(result, "fun", None)
        bound = getattr(result, "mip_dual_bound", None)
        gap = getattr(result, "mip_gap", None)
        _, defaults = _backend_metadata()
        return RawSolveResult(
            code,
            message,
            reason,
            decisions,
            sign * float(objective) if objective is not None else None,
            sign * float(bound) if bound is not None else None,
            float(gap) if gap is not None else None,
            used,
            defaults,
        )
