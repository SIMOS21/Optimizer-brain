# Phase 0 — Audit du 22 novembre 2026

AGENTS.md et les 1 128 lignes de OPTIMIZATION_BRAIN_SPEC.md ont été lus.
Ces deux fichiers étaient déjà présents ; ils sont conservés sans modification.
Le dossier fourni ne contenait pas de dépôt Git lors de l'audit : aucun commit
antérieur n'était disponible.

## État initial observé

- `brain/models.py` : dataclasses Product, Scenario, Allocation, Plan ; validation
  des dictionnaires et vérification indépendante `evaluate`, spécifiques à la production.
- `brain/optimizer.py` : MILP SciPy/HiGHS ; quatre variables par produit et une
  variable d'heures supplémentaires. Toutes sont entières, dont les activations 0/1.
- Règles codées en dur : demande, engagements, stock, flux sans production inutilisée,
  activation, sous-traitance, capacités machine/RH/logistique, budget, heures supplémentaires.
- `brain/diagnostics.py` : marges et saturation ; aucun prix d'ombre ni IIS.
- `brain/api.py` : `/health`, `POST /optimize`, sans authentification ; démonstration locale.
- `brain/demo.py` : comparaison à une baseline et cinq scénarios ; écrit
  `results/sample_results.json`. `examples/factory.json` contient des données synthétiques.
- `tests/test_solver.py` : 11 tests ; `tests/test_api.py` : 3 tests.

## Exécutions avant modification du code

L'hôte propose seulement Python 3.14.3 (la compatibilité 3.11 n'est pas mesurée ici).
Le premier `python -m pytest -q` échoue car pytest n'est pas installé.
Un `.venv --system-site-packages` local réutilise les bibliothèques présentes ;
pytest, Ruff et mypy sont installés dans ce venv après autorisation réseau.

` .\.venv\Scripts\python.exe -m pytest -q ` : **14 passed, 2 warnings in 2.26s**.
Les avertissements viennent d'anyio/pytest et de Starlette/httpx.

`python -m brain.demo` : succès ; baseline 4620 EUR / 50 livraisons,
optimum déclaré par le backend 6840 EUR / 81 livraisons ; autres scénarios :
6924 EUR (+machine), 6840 EUR (+budget), 7225 EUR (+logistique),
`infeasible` pour l'engagement de 82 unités. Le fichier de résultats est régénéré.

Versions présentes : NumPy 2.4.2, SciPy 1.17.0, Pydantic 2.12.5,
FastAPI 0.143.2, httpx 0.28.1, uvicorn 0.49.0.

## Écarts et risques à conserver visibles

Le MVP ne possède ni DSL, ni IR, ni validation dimensionnelle, ni historique
immuable/snapshots, ni gouvernance/RBAC. Le statut legacy reste en minuscules.
Le solveur arrondit les valeurs puis revérifie le plan métier ; il n'expose pas
les résidus du vecteur brut, les bornes, la version HiGHS ou un run traçable.
Les constructeurs directs de dataclasses peuvent contourner `from_dict`.
Les tolérances sont codées en dur (`1e-6`, gap demandé `1e-7`).
Ne pas assimiler ce contrat legacy au contrat cible de résultats certifiés.

## Stabilisation et suite

`requirements-dev.txt` fixe les outils testés. Ruff vérifie le code et les tests ;
le formatage automatique et mypy strict ciblent le nouveau kernel, pour ne pas
réécrire mécaniquement le MVP. Les équations legacy restent inchangées.
La phase 1 extrait les concepts mathématiques dans une bibliothèque parallèle,
sans brancher prématurément la DSL sur le solveur ou l'API.
L'adaptateur HiGHS, les statuts normalisés et la vérification des sorties brutes
sont le travail de phase 2 ; la migration du template industriel vient en phase 3.

## Rattachement Git après livraison des phases 0 et 1

Le 22 novembre 2026, le dépôt fourni `https://github.com/SIMOS21/Optimizer-brain`
est vérifié via le connecteur GitHub : dépôt public, vide, sans branche ni contenu.
Le suivi local est initialisé sur `main`, avec cette URL comme remote `origin`,
pour conserver le travail des phases 0 et 1 avant la phase 2. Le venv et les caches
sont exclus par `.gitignore`. Cette initialisation ne publie aucun fichier distant.
