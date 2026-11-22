# Validation locale — 22 novembre 2026

Environnement réellement utilisé : Windows / PowerShell, Python 3.14.3,
venv du projet avec bibliothèques système accessibles. Versions runtime dans
[l'audit](audit-phase-0.md) ; pytest 9.2.0, Ruff 0.17.6, mypy 1.20.2.
Toutes les commandes ci-dessous utilisent `.\.venv\Scripts\python.exe`.

| Commande | Résultat observé |
|---|---|
| `-m pytest -q` avant ajout du kernel | 14 passed, 2 warnings in 2.26s |
| `-m pytest -q` après implémentation | **102 passed, 2 warnings in 2.56s** |
| `-m ruff check brain tests` | All checks passed |
| `-m ruff format --check brain/kernel tests/test_kernel.py` | 9 files already formatted |
| `-m mypy` | Success: no issues found in 8 source files |
| `-m brain.demo` | Succès : 4620 EUR de baseline, 6840 EUR optimisés, engagement 82 infaisable |
| `-m brain.kernel validate examples/demo_cross_department.json --output results/demo_ir.json` | Succès, IR générée |
| `-m brain.kernel verify examples/demo_cross_department.json --plan examples/golden_plan.json --output results/golden_verification.json` | Succès, plan faisable, objectif 4100 EUR |
| `-m brain.kernel verify examples/generic_allocation.json --plan examples/golden_plan.json --output results/generic_verification.json` | Succès, plan faisable, objectif 4100 EUR |
| `-m pip check` | No broken requirements found |

Les 102 tests comprennent les **14 tests historiques inchangés** et 88 tests/cas
paramétrés du kernel. Le golden compare tous les 1476 plans entiers aux équations
indépendantes ; l'unique optimum est (40,15), valeur 4100 EUR.
Les tests couvrent schémas fermés, valeurs non finies, références et indices,
unités et conversions, bornes/domaines, approbations déclarées, hashes et
immutabilité, comparateurs, marges/résidus, tolérances, décimaux longs,
infaisabilité locale par bornes, erreurs CLI, schéma généré et absence de réseau/LLM.
Un processus neuf vérifie que l'import du kernel ne charge ni SciPy ni OpenAI.

Deux avertissements externes persistent : dépréciation anyio/pytest de CallSpec2
et dépréciation Starlette de son intégration httpx. Ils existaient déjà lors de
la mesure initiale et n'empêchent pas les tests API historiques de passer.

Le workflow CI Python 3.11 Linux/Windows est ajouté mais **non exécuté ici**.
Aucune mesure de performance industrielle, preuve solveur générique, sécurité
multi-tenant ou validation opérationnelle n'est revendiquée.
