# UX-F2 — Dashboard métier connecté aux résultats réels

## Récupération et audit initial

- Branche `feature/ux-v2-dashboard` basée sur `main` (`75734ef`, après fusion de la PR #7 UX-F1).
- Le worktree historique `Optimizer brain` et le fichier non suivi `tatus` sont préservés.
- Le répertoire `frontend/src/features/dashboard/` n'existait pas encore ; `Workspace.tsx` chargeait encore les quatre collections (`departments`, `graphs`, `model-versions`, `optimization-runs`) avant de rendre toute route.
- Aucun changement n'a été apporté au moteur mathématique (`brain/kernel`), à HiGHS, au vérificateur indépendant, aux règles RBAC/RLS, aux historiques immuables ni aux politiques de scénarios.

## Changements UX-F2

- **`frontend/src/features/dashboard/trust.ts`** : réutilisation exacte de la chaîne de confiance de `DecisionCockpit` (`validation_report.valid === true`, `plan.feasible === true`, `has_verified_plan === true`, concordance `record.status === solve.public_status === report.status`, distinction `OPTIMAL`, `FEASIBLE_NOT_PROVEN_OPTIMAL`, `INFEASIBLE`, `TIME_LIMIT_NO_SOLUTION`, `SOLUTION_FAILED_VALIDATION`, `UNVERIFIED`). `SUCCEEDED` n'est jamais traité comme synonyme de `OPTIMAL`.
- **`frontend/src/features/dashboard/Dashboard.tsx`** :
  - Valeur d'objectif et unité lues uniquement depuis les artefacts réels enregistrés (ex. `4100 EUR` pour l'usine, `17` pour l'université dans les fixtures/artefacts). Aucune constante codée en dur.
  - Distinction explicite entre le **dernier run disponible** et le **dernier plan vérifié** (avec lien vers le dernier plan vérifié antérieur lorsque le dernier run est `INFEASIBLE`, `TIME_LIMIT_NO_SOLUTION`, `SOLUTION_FAILED_VALIDATION` ou non vérifié).
  - Décisions optimisées, ressources consommées / capacités / marges (`ResourceMeter`), contraintes saturées (avec avertissement explicite qu'une saturation n'implique pas un gain économique), date et version du modèle.
  - Mode expert : provenance complète (IDs de run/modèle, snapshot, hashes, solveur/version, durée, portée du certificat, bornes, gap relatif, tableau complet des contraintes) sans accorder aucune permission supplémentaire.
  - Actions autorisées vers *Comprendre ce résultat*, *Optimisation* (`canBuild` uniquement) et *Scenario Lab*.
  - État vide pédagogique sans KPI fabriqué lorsqu'aucun run n'existe, retry local en cas d'erreur, tri déterministe (`created_at` décroissant puis `id`) et pagination des runs récents (5 par page).
- **`frontend/src/features/organizations/Workspace.tsx`** :
  - Suppression du chargement bloquant global des quatre collections.
  - Utilisation directe de `authorizedOrganization` lorsque fournie par `AuthenticatedApp`.
  - Chargement paresseux par route (`Dashboard`, `GraphsRoute`, `ModelsRoute`, `ScenariosRoute`, `ExecutionRoute`, `HistoryRoute`) avec `Skeleton` ciblés et boutons `Réessayer` locaux. `DepartmentRegistry` est conservé sur la route `Mon organisation` (`/organizations/:org/graphs`).
- **`frontend/src/features/history/History.tsx`** : tri déterministe des runs (`created_at` décroissant puis `id`).
- **`frontend/src/styles/foundation.css`** : styles V2 responsives (desktop 1440 px et mobile 390 px) pour le dashboard et les indicateurs de ressources.

## Validation exécutée

Environnement local Windows (Python 3.14.3, Node 24.13.0).

| Contrôle | Résultat |
|---|---|
| `npm run build` (`tsc -b && vite build`) | Réussi (`0` erreur TypeScript, bundle Vite 886 ms) |
| `npm run lint` (`eslint .`) | Réussi (`0` erreur) |
| `npx vitest run` | Réussi : **186 tests passés / 13 fichiers** (dont 14 nouveaux tests dans `tests/dashboard.test.tsx` et mise à jour de `tests/foundation.test.tsx`) |
| `ruff check brain tests migrations scripts` | Réussi (`All checks passed!`) |
| `ruff format --check` (67 fichiers CI) | Réussi (`67 files already formatted`) |
| `mypy` | Réussi (`Success: no issues found in 46 source files`) |
| `pytest -q -p no:cacheprovider --basetemp=.local/pytest-tmp tests/test_kernel.py tests/test_studio_e2e.py` | Réussi : **96 passés** |

## État PostgreSQL local et Playwright

- **Diagnostic PostgreSQL local** : le fichier `.local/e2e.env` existe, mais aucun service PostgreSQL local n'écoute sur `127.0.0.1:5432` (`Test-NetConnection -ComputerName 127.0.0.1 -Port 5432` retourne `False`, y compris hors sandbox).
- En conséquence, la suite Playwright (`scripts.studio_e2e` sur `optimizer_brain_e2e`), les captures d'écran locales desktop/mobile et les mesures de performance E2E avant/après n'ont pas pu être exécutées localement.
- Les parcours E2E existants (`tests/e2e/foundation.spec.ts`, `tests/e2e/studio.spec.ts`) ont été alignés sur la nouvelle route `Mon organisation` pour la liste de graphes et les départements, et `tests/e2e/dashboard.spec.ts` a été ajouté (desktop 1440 px, mobile 390 px, usine/université, mode expert, switch sans fuite, rôle `VIEWER`).
- Ces tests E2E et la génération des captures `studio-screenshots` sont confiés au job CI PostgreSQL GitHub (`ubuntu-latest`, `postgres:17`, `optimizer_brain_e2e`) après le push.

## Limites

- Pas de mesures de latence E2E avant/après locales tant que PostgreSQL local est arrêté.
- La suite `pytest` complète avec base PostgreSQL de test et les tests API `TestClient` en sandbox Windows n'ont pas été exécutés intégralement en local ; la CI GitHub exécute la matrice complète Linux/Windows + PostgreSQL 17.
- UX-F3 (graphe organisationnel), UX-F4, UX-F5 et Phase 5B-3 restent hors périmètre.
