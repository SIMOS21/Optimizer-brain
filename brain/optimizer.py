"""MILP optimization Brain: no LLM, prompts, or stochastic text generation."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix

from .models import Allocation, Plan, Scenario, evaluate


@dataclass
class Solution:
    status: str
    plan: Plan | None
    metrics: dict[str, Any] | None
    solver_message: str
    mip_gap: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            'status': self.status,
            'plan': self.plan.to_dict() if self.plan else None,
            'metrics': self.metrics,
            'solver_message': self.solver_message,
            'mip_gap': self.mip_gap,
        }


def solve(s: Scenario, *, time_limit_seconds: float = 20.0) -> Solution:
    """Maximize net contribution subject to department-level hard constraints.

    Variables for each SKU: [produced, subcontracted, delivered, setup_binary],
    plus a shared integer machine-overtime variable.
    """
    if not (0 < time_limit_seconds <= 300):
        raise ValueError('time_limit_seconds doit etre compris entre 0 et 300')
    n = len(s.products)
    m = n * 4 + 1
    t_idx = m - 1
    c = np.zeros(m)
    upper_bounds = np.zeros(m)
    for i, p in enumerate(s.products):
        j = 4 * i
        c[j:j + 4] = [p.make_cost, p.outsource_cost, p.ship_cost - p.unit_revenue, p.setup_cost]
        upper_bounds[j:j + 4] = [p.demand, min(p.demand, p.outsource_limit), p.demand, 1]
    c[t_idx] = s.overtime_hour_cost
    upper_bounds[t_idx] = s.overtime_max

    rows: list[dict[int, float]] = []
    lbs: list[float] = []
    ubs: list[float] = []

    def add(coeffs: dict[int, float], lower: float = -np.inf, upper: float = np.inf) -> None:
        rows.append(coeffs)
        lbs.append(lower)
        ubs.append(upper)

    for i, p in enumerate(s.products):
        q, o, sh, y = 4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3
        add({sh: 1}, lower=p.min_deliver)
        add({sh: 1, q: -1, o: -1}, upper=p.inventory)
        add({q: 1, o: 1, sh: -1}, upper=0)
        add({q: 1, y: -p.demand}, upper=0)

    machine = {t_idx: -1}
    labor = {}
    logistics = {}
    budget = {t_idx: s.overtime_hour_cost}
    all_ship = {}
    for i, p in enumerate(s.products):
        q, o, sh, y = 4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3
        machine[q] = p.machine_hours
        labor[q] = p.labor_hours
        logistics[sh] = p.logistics_units
        budget.update({q: p.make_cost, o: p.outsource_cost, sh: p.ship_cost, y: p.setup_cost})
        all_ship[sh] = 1
    add(machine, upper=s.machine_capacity)
    add(labor, upper=s.labor_capacity)
    add(logistics, upper=s.logistics_capacity)
    add(budget, upper=s.budget)
    add(all_ship, lower=s.min_total_deliver)

    matrix = lil_matrix((len(rows), m), dtype=float)
    for k, row in enumerate(rows):
        for j, value in row.items():
            matrix[k, j] = value

    res = milp(
        c=c,
        integrality=np.ones(m, dtype=int),
        bounds=Bounds(np.zeros(m), upper_bounds),
        constraints=LinearConstraint(matrix.tocsr(), np.asarray(lbs), np.asarray(ubs)),
        options={'time_limit': time_limit_seconds, 'mip_rel_gap': 1e-7, 'disp': False},
    )

    status_by_code = {0: 'optimal', 1: 'time_limit_or_iteration_limit', 2: 'infeasible', 3: 'unbounded', 4: 'solver_error'}
    status = status_by_code.get(res.status, 'unknown')
    gap = float(res.mip_gap) if getattr(res, 'mip_gap', None) is not None else None
    if res.x is None:
        return Solution(status, None, None, str(res.message), gap)

    integer_values = np.rint(res.x).astype(int)
    allocations = tuple(Allocation(p.id, int(integer_values[4*i]), int(integer_values[4*i+1]),
                                   int(integer_values[4*i+2])) for i,p in enumerate(s.products))
    plan = Plan(allocations, int(integer_values[t_idx]))
    metrics = evaluate(s, plan)
    if not metrics['feasible']:
        return Solution('invalid_solver_solution', None, metrics, str(res.message), gap)
    if status == 'time_limit_or_iteration_limit':
        status = 'feasible_not_proven_optimal'
    return Solution(status, plan, metrics, str(res.message), gap)
