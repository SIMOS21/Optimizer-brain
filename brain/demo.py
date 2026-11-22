"""CLI demonstration: baseline vs optimized plan, then what-if experiments."""
import json
from pathlib import Path
from dataclasses import replace

from .models import Plan, Scenario, evaluate
from .optimizer import solve
from .diagnostics import resource_report


EXAMPLE = Path(__file__).resolve().parents[1] / 'examples' / 'factory.json'


def main() -> None:
    raw = json.loads(EXAMPLE.read_text(encoding='utf-8'))
    s = Scenario.from_dict(raw['scenario'])
    baseline = Plan.from_dict(raw['baseline_plan'])
    baseline_metrics = evaluate(s, baseline)
    if not baseline_metrics['feasible']:
        raise RuntimeError(f"Le baseline n'est pas realisable: {baseline_metrics['issues']}")
    print(f'OPTIMIZATION BRAIN — {s.name}')
    print('Baseline valide: profit', baseline_metrics['profit'], ' | livraisons', baseline_metrics['delivered_units'])

    best = solve(s)
    if not best.plan:
        print('Aucun plan obtenu:', best.status, best.solver_message)
        return
    print('Plan optimise:', best.status, ' | profit', best.metrics['profit'], ' | livraisons', best.metrics['delivered_units'])
    print('Gain net sur baseline:', round(best.metrics['profit'] - baseline_metrics['profit'], 2))
    print('Affectation par produit:')
    for a in best.plan.allocations:
        print(f'  {a.product_id}: fabriquer={a.make}, sous-traiter={a.outsource}, livrer={a.ship}')
    print('Heures supplementaires:', best.plan.overtime_hours)
    print('Ressources / contraintes:')
    for r in resource_report(s, best):
        state = 'SATURÉE' if r['saturated'] else 'marge disponible'
        print(f"  {r['department']:<22} {r['used']:>7g}/{r['capacity']:<7g} {r['unit']:<17} {state}")
    print('\nANALYSES WHAT-IF (chaque scenario re-optimise):')
    changes = [
        ('Actuel', s),
        ('+15 heures machine', replace(s, machine_capacity=s.machine_capacity + 15)),
        ('+1500 budget', replace(s, budget=s.budget + 1500)),
        ('+10 charge logistique', replace(s, logistics_capacity=s.logistics_capacity + 10)),
        ('Service >= 82 unites', replace(s, min_total_deliver=82)),
    ]
    output = {'scenario': s.to_dict(), 'baseline': {'plan': baseline.to_dict(), 'metrics': baseline_metrics}, 'what_if': []}
    for name, other in changes:
        solution = solve(other)
        entry = {'name': name, **solution.to_dict()}
        output['what_if'].append(entry)
        if solution.metrics and solution.metrics['feasible']:
            print(f"  {name:<23} {solution.status:<29} profit={solution.metrics['profit']:<8} livraisons={solution.metrics['delivered_units']}")
        else:
            print(f'  {name:<23} {solution.status}')
    out_dir = Path(__file__).resolve().parents[1] / 'results'
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / 'sample_results.json'
    out_file.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nResultats:', out_file)


if __name__ == '__main__':
    main()
