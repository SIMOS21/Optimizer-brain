# Audit préalable de phase 3 — 22 novembre 2026

Les trois documents demandés ont été lus intégralement : AGENTS.md,
OPTIMIZATION_BRAIN_SPEC.md (1128 lignes) et PHASE_3_CODEX_BRIEF.md.
Le README, les deux ADR et les modules locaux de kernel/solveur/vérification
ont été examinés. La source de travail est le dossier local, pas origin/main.

## Baseline réellement exécutée avant implémentation

- Python du venv : **3.14.3**, et non 3.11.
- pytest : **188 passed, 2 warnings in 2.92s**, avec TEMP/TMP sous
  `%LOCALAPPDATA%\OptimizerBrain\temp`, basetemp `pytest-phase3-baseline`, sans cacheprovider.
- Ruff : All checks passed.
- mypy : Success, 13 fichiers sources.
- CLI golden : OPTIMAL à tolérance près, 40/15, objectif 4100 EUR, vérification valide.
  Le résultat est conservé dans `results/phase3_baseline_solve.json`.

`git status` montrait déjà les modifications/non-suivis de phase 2, le brief de
phase 3 et un fichier `tatus` non suivi. Ils sont conservés ; aucun reset, écrasement
des travaux antérieurs ou synchronisation de branche distante n'est effectué.

## Contrats réutilisables et écarts

| Couche existante | Ce qui est présent | Ce qui manquait pour la phase 3 |
|---|---|---|
| `kernel/schema.py` | DSL 1.0 fermée, départements, paramètres référencés, variables indexées, un objectif et HARD uniquement | Identité d'organisation, graphe, modules indépendants et règles de composition |
| `kernel/compiler.py` / `ir.py` | Contrôles de références/unités/domaines, rationnels, IR immuable, hashes mathématique/manifeste | Registres de partage, ownership structurel, chaîne de provenance entre fragments et IR |
| `solvers/contracts.py` | SolverAdapter, supports/solve/capabilities, résultats qualifiés et traçables | Aucun changement nécessaire |
| `solvers/highs.py` | Matrices CSC, MAX/MIN, domaines, limites numériques et rapport de conversion | Aucun changement nécessaire |
| `solvers/orchestrator.py` | Compilation, compatibilité, un solve et qualification honnête des statuts | Entrée composée à produire en amont |
| `kernel/verification.py` | Vérification indépendante des valeurs binaires brutes et objectif sur IR originale | Vues de ressources/départements dérivées d'un témoin revérifié |
| CLI/API locales | Interfaces de phase 2 et MVP disponibles | CLI dédiée de composition et snapshots locaux |
| Historique | JSON de démonstration, identifiants et hashes | Conservation locale atomique et refus des versions contradictoires |

Les tolérances et les décisions numériques de l'ADR 0002 sont conservées.
L'approbation est déclarative ; aucune authentification/RBAC n'est prétendue.
Les bornes/gaps manquants ne sont pas reconstruits par la nouvelle couche.

## Plan suivi

Nouveaux modules `brain/organization/` : schémas, composition déterministe, chargement
de fichiers indépendants, rapports, runtime réutilisant la phase 2, stockage SQLite
embarqué et CLI. Deux projets JSON synthétiques, tests de composition/versions/
utilisation/rollback et documentation. Aucun module du kernel, adaptateur HiGHS,
vérificateur, modèle métier legacy ou route existante n'est modifié par la phase 3.

Risque principal de modélisation : générer plusieurs plafonds indépendants pour
une même ressource et permettre une surconsommation globale. La liaison typée
ResourceUse additionne les contributions dans **une** ligne de capacité.
Risque numérique : rapport établi sur des valeurs arrondies ou un autre snapshot.
La couche de rapport compare les identités/hashes et revérifie les valeurs brutes.
