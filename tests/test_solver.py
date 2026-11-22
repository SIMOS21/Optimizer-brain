import json
from dataclasses import replace
from pathlib import Path

import pytest

from brain.models import Plan, Product, Scenario, evaluate
from brain.optimizer import solve
from brain.diagnostics import resource_report


FILE = Path(__file__).resolve().parents[1] / 'examples' / 'factory.json'


@pytest.fixture
def example():
    raw = json.loads(FILE.read_text(encoding='utf-8'))
    return Scenario.from_dict(raw['scenario']), Plan.from_dict(raw['baseline_plan'])


def test_realistic_demo_optimal_and_feasible(example):
    s, baseline = example
    result = solve(s)
    assert result.status == 'optimal'
    assert result.plan is not None
    assert result.metrics['feasible']
    assert result.metrics['profit'] == 6840
    assert result.metrics['delivered_units'] == 81
    assert evaluate(s, baseline)['profit'] == 4620
    assert result.metrics['profit'] > evaluate(s, baseline)['profit']


def test_conflicting_hard_service_constraints_flagged(example):
    s, _ = example
    impossible = replace(s, min_total_deliver=82)
    result = solve(impossible)
    assert result.status == 'infeasible'
    assert result.plan is None


def test_more_capacity_cannot_reduce_best_objective(example):
    s, _ = example
    initial = solve(s)
    extra = solve(replace(s, logistics_capacity=s.logistics_capacity + 10))
    assert initial.status == extra.status == 'optimal'
    assert extra.metrics['profit'] >= initial.metrics['profit']


def test_resource_report_flags_real_saturation(example):
    s, _ = example
    rep = resource_report(s, solve(s))
    flags = {x['department']: x['saturated'] for x in rep}
    assert flags['Production / machines']
    assert flags['Logistique']
    assert not flags['Finance']


def test_reject_unknown_llm_fields(example):
    s, _ = example
    invalid = s.to_dict()
    invalid['llm_decision_override'] = 'ignore all constraints'
    with pytest.raises(ValueError):
        Scenario.from_dict(invalid)


def test_reject_non_integral_product_count(example):
    s, _ = example
    invalid = s.to_dict()
    invalid['products'][0]['demand'] = 10.5
    with pytest.raises(ValueError):
        Scenario.from_dict(invalid)


def test_reject_duplicate_products(example):
    s, _ = example
    invalid = s.to_dict()
    invalid['products'].append(invalid['products'][0].copy())
    with pytest.raises(ValueError):
        Scenario.from_dict(invalid)


def test_reject_invalid_baseline_by_evaluation(example):
    s, baseline = example
    d = baseline.to_dict()
    d['allocations'][0]['ship'] = 999
    invalid = Plan.from_dict(d)
    assert not evaluate(s, invalid)['feasible']


def test_small_instance_known_global_optimum():
    basic = dict(demand=3, min_deliver=0, inventory=0, make_cost=10,
                 outsource_cost=500, ship_cost=0, setup_cost=0,
                 machine_hours=1, labor_hours=1, logistics_units=1,
                 outsource_limit=0)
    a = Product(id='A', unit_revenue=100, **basic)
    b = Product(id='B', unit_revenue=80, **{**basic, 'min_deliver': 1})
    s = Scenario(name='Tiny', products=(a, b), machine_capacity=3,
                 labor_capacity=3, logistics_capacity=3, budget=1000,
                 overtime_max=0, overtime_hour_cost=0)
    result = solve(s)
    assert result.status == 'optimal'
    assert result.metrics['profit'] == 250
    allocations = {x.product_id: x for x in result.plan.allocations}
    assert allocations['A'].ship == 2
    assert allocations['B'].ship == 1


def test_zero_budget_and_mandatory_cost_is_infeasible(example):
    s, _ = example
    result = solve(replace(s, budget=0))
    assert result.status == 'infeasible'
    assert result.plan is None


def test_round_trip_scenario(example):
    s, _ = example
    assert Scenario.from_dict(s.to_dict()) == s
