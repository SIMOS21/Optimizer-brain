"""Deterministic bottleneck reports; binding is not the same as shadow price."""
from .models import Scenario
from .optimizer import Solution


def resource_report(s: Scenario, solution: Solution) -> list[dict]:
    if not solution.metrics or not solution.metrics.get('feasible') or not solution.plan:
        return []
    m = solution.metrics
    resources = [
        ('Production / machines', m['machine_hours'], s.machine_capacity + solution.plan.overtime_hours, 'heures'),
        ('Ressources humaines', m['labor_hours'], s.labor_capacity, 'heures'),
        ('Logistique', m['logistics_units'], s.logistics_capacity, 'unites de charge'),
        ('Finance', m['total_cost'], s.budget, 'EUR'),
    ]
    return [
        {
            'department': name,
            'used': used,
            'capacity': capacity,
            'remaining': round(max(0.0, capacity - used), 2),
            'saturated': abs(capacity - used) <= 1e-6,
            'unit': unit,
        }
        for name, used, capacity, unit in resources
    ]
