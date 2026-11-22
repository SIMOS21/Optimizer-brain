"""Strict, LLM-independent data contracts for department inputs."""
from __future__ import annotations

from dataclasses import dataclass, asdict
import math
from typing import Any

PRODUCT_FIELDS = {
    'id', 'demand', 'min_deliver', 'inventory', 'unit_revenue',
    'make_cost', 'outsource_cost', 'ship_cost', 'setup_cost',
    'machine_hours', 'labor_hours', 'logistics_units', 'outsource_limit',
}
SCENARIO_FIELDS = {
    'name', 'products', 'machine_capacity', 'labor_capacity',
    'logistics_capacity', 'budget', 'overtime_max', 'overtime_hour_cost',
    'min_total_deliver',
}
COUNTS = {'demand', 'min_deliver', 'inventory', 'outsource_limit'}
NONNEG_PRODUCT = PRODUCT_FIELDS - {'id'}
NONNEG_SCENARIO = SCENARIO_FIELDS - {'name', 'products'}


def _check_number(value: Any, name: str, integer: bool = False) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f'{name}: valeur numerique >= 0 attendue')
    if integer and not isinstance(value, int):
        raise ValueError(f'{name}: entier attendu')


@dataclass(frozen=True)
class Product:
    id: str
    demand: int
    min_deliver: int
    inventory: int
    unit_revenue: float
    make_cost: float
    outsource_cost: float
    ship_cost: float
    setup_cost: float
    machine_hours: float
    labor_hours: float
    logistics_units: float
    outsource_limit: int

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> 'Product':
        if not isinstance(raw, dict) or set(raw) != PRODUCT_FIELDS:
            raise ValueError(f'Produit: champs attendus exactement: {sorted(PRODUCT_FIELDS)}')
        if not isinstance(raw['id'], str) or not raw['id'].strip():
            raise ValueError('Produit: id non vide attendu')
        for key in NONNEG_PRODUCT:
            _check_number(raw[key], f"{raw['id']}.{key}", key in COUNTS)
        if raw['min_deliver'] > raw['demand']:
            raise ValueError(f"{raw['id']}: min_deliver > demand")
        return cls(**raw)


@dataclass(frozen=True)
class Scenario:
    name: str
    products: tuple[Product, ...]
    machine_capacity: float
    labor_capacity: float
    logistics_capacity: float
    budget: float
    overtime_max: int
    overtime_hour_cost: float
    min_total_deliver: int = 0

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> 'Scenario':
        if not isinstance(raw, dict) or not set(raw).issubset(SCENARIO_FIELDS):
            raise ValueError(f'Scenario: champs inconnus; attendus {sorted(SCENARIO_FIELDS)}')
        required = SCENARIO_FIELDS - {'min_total_deliver'}
        if not required.issubset(raw):
            raise ValueError(f"Scenario: champs manquants: {sorted(required - set(raw))}")
        if not isinstance(raw['name'], str) or not raw['name'].strip():
            raise ValueError('Scenario: nom non vide attendu')
        if not isinstance(raw['products'], list) or not raw['products']:
            raise ValueError('Scenario: liste non vide de produits attendue')
        products = tuple(Product.from_dict(p) for p in raw['products'])
        if len({p.id for p in products}) != len(products):
            raise ValueError('Scenario: identifiants de produit dupliques')
        normalized = {**raw, 'min_total_deliver': raw.get('min_total_deliver', 0)}
        for key in NONNEG_SCENARIO:
            _check_number(normalized[key], key, key in {'overtime_max', 'min_total_deliver'})
        if normalized['min_total_deliver'] > sum(p.demand for p in products):
            raise ValueError('Scenario: min_total_deliver depasse la demande totale')
        normalized['products'] = products
        return cls(**normalized)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d['products'] = [asdict(p) for p in self.products]
        return d


@dataclass(frozen=True)
class Allocation:
    product_id: str
    make: int
    outsource: int
    ship: int


@dataclass(frozen=True)
class Plan:
    allocations: tuple[Allocation, ...]
    overtime_hours: int = 0

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> 'Plan':
        if not isinstance(raw, dict) or set(raw) != {'allocations', 'overtime_hours'}:
            raise ValueError('Plan: seuls allocations et overtime_hours sont autorises')
        _check_number(raw['overtime_hours'], 'overtime_hours', integer=True)
        if not isinstance(raw['allocations'], list):
            raise ValueError('Plan: allocations doit etre une liste')
        allocations = []
        for a in raw['allocations']:
            if not isinstance(a, dict) or set(a) != {'product_id', 'make', 'outsource', 'ship'}:
                raise ValueError('Allocation: champs invalides')
            if not isinstance(a['product_id'], str):
                raise ValueError('Allocation: product_id invalide')
            for name in ('make', 'outsource', 'ship'):
                _check_number(a[name], f"{a['product_id']}.{name}", integer=True)
            allocations.append(Allocation(**a))
        return cls(tuple(allocations), raw['overtime_hours'])

    def to_dict(self) -> dict[str, Any]:
        return {'allocations': [asdict(a) for a in self.allocations], 'overtime_hours': self.overtime_hours}


def evaluate(s: Scenario, plan: Plan) -> dict[str, Any]:
    """Independent verification of a plan, not trusting an LLM or a solver output."""
    by_id = {a.product_id: a for a in plan.allocations}
    p_ids = {p.id for p in s.products}
    issues = []
    if len(by_id) != len(plan.allocations) or set(by_id) != p_ids:
        issues.append('Plan: produit absent, inconnu ou duplique')
        return {'feasible': False, 'issues': issues}

    total_revenue = total_cost = machine = labor = logistics = 0.0
    total_ship = 0
    for p in s.products:
        a = by_id[p.id]
        for key in ('make', 'outsource', 'ship'):
            v = getattr(a, key)
            if isinstance(v, bool) or not isinstance(v, int) or v < 0:
                issues.append(f'{p.id}: {key} invalide')
        if a.ship > p.demand:
            issues.append(f'{p.id}: demande depassee')
        if a.ship < p.min_deliver:
            issues.append(f'{p.id}: engagement commercial non respecte')
        if a.outsource > p.outsource_limit:
            issues.append(f'{p.id}: plafond de sous-traitance depasse')
        if a.make + a.outsource > a.ship:
            issues.append(f'{p.id}: production non affectee a une livraison')
        if a.ship > a.make + a.outsource + p.inventory:
            issues.append(f'{p.id}: manque de stock / fabrication / sous-traitance')
        total_revenue += a.ship * p.unit_revenue
        total_cost += (a.make * p.make_cost + a.outsource * p.outsource_cost
                       + a.ship * p.ship_cost + (p.setup_cost if a.make > 0 else 0))
        machine += a.make * p.machine_hours
        labor += a.make * p.labor_hours
        logistics += a.ship * p.logistics_units
        total_ship += a.ship

    if isinstance(plan.overtime_hours, bool) or not isinstance(plan.overtime_hours, int) or plan.overtime_hours < 0:
        issues.append('Heures supplementaires invalides')
    if plan.overtime_hours > s.overtime_max:
        issues.append('Heures supplementaires au-dessus du plafond')
    total_cost += plan.overtime_hours * s.overtime_hour_cost
    if machine > s.machine_capacity + plan.overtime_hours + 1e-6:
        issues.append('Capacite machine depassee')
    if labor > s.labor_capacity + 1e-6:
        issues.append('Capacite RH depassee')
    if logistics > s.logistics_capacity + 1e-6:
        issues.append('Capacite logistique depassee')
    if total_cost > s.budget + 1e-6:
        issues.append('Budget financier depasse')
    if total_ship < s.min_total_deliver:
        issues.append('Engagement global de livraison non respecte')

    demand_total = sum(p.demand for p in s.products)
    return {
        'feasible': not issues,
        'issues': issues,
        'revenue': round(total_revenue, 2),
        'total_cost': round(total_cost, 2),
        'profit': round(total_revenue - total_cost, 2),
        'delivered_units': total_ship,
        'service_rate_pct': round(total_ship / demand_total * 100, 2) if demand_total else 100.0,
        'machine_hours': round(machine, 2),
        'labor_hours': round(labor, 2),
        'logistics_units': round(logistics, 2),
        'budget_usage_pct': round(total_cost / s.budget * 100, 2) if s.budget else None,
    }
