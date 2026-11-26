# Validation UX-F4 — Optimization Center & Decision Cockpit

26 novembre 2026. Branche `feature/ux-v2-optimization-center`, base `f6eb151` (main après UX-F3).

## Audit et architecture

Avant UX-F4 :
- Lancement immédiat au clic sans récapitulatif ni confirmation explicite.
- Risque d'erreur ou d'ambiguïté en cas de latence réseau lors de la soumission (sélection de modèle non verrouillée).
- Présentation brute des résultats sous forme de dump technique dense, sans cartes métier synthétiques distinctes.
- Qualification mathématique s'appuyant uniquement sur le statut serveur (`SUCCEEDED`) plutôt que sur une évaluation indépendante stricte (`SolutionVerifier` / `assessTrust`).
- Risque de chevauchement entre un polling de job et une actualisation manuelle concurrente.
- Éléments techniques exposés indistinctement à tous les rôles sans mode expert unifié.

Après UX-F4 :
- **Parcours en 5 étapes guidées** :
  1. Modèle publié (sélection filtrée sur les modèles publiés de l'organisation, verrouillée pendant la soumission).
  2. Paramètres d'exécution (configuration solver, timeout, horizon).
  3. **Confirmation explicite** (`ExecutionPanel`) : dialogue modal présentant les paramètres figés (nom, identifiant, horizon, timeout, solver) avant envoi effectif, avec protection contre le double-clic et clé d'idempotence stricte.
  4. **Suivi d'exécution** (`JobMonitor`) : statut clair (EN ATTENTE, EN COURS, TERMINÉ, ÉCHEC, ANNULÉ), distinction de l'annulation demandée vs confirmée, pas de chevauchement entre polling automatique et actualisation manuelle (`useJobMonitor`).
  5. **Cockpit de décision** (`DecisionCockpit`) : intégration d'un audit de confiance strict (`assessTrust`) ; distinction formelle entre job réussi (`SUCCEEDED`) et qualification mathématique réelle (`OPTIMAL`, `FEASIBLE`, `INFEASIBLE`, `UNVERIFIED`) ; cartes synthétiques de résultats métier par défaut ; détails techniques, matrices, logs et métadonnées réservés au mode expert.
- **Préservation des politiques de gouvernance et de sécurité** :
  - Rôles RBAC respectés : les rôles sans droit de build (ex. VIEWER) ne voient pas le bouton de lancement.
  - Aucune élévation de privilège via le mode expert.
  - Aucune modification du Brain mathématique, du solveur HiGHS, du vérificateur indépendant ou des schémas backend.

## Données et interactions livrées

- **Confirmation de lancement** : Dialogue accessible (`role="dialog"`) détaillant le modèle cible et les paramètres figés, avec boutons d'annulation et de validation explicite.
- **Garantie d'idempotence** : Réutilisation du corps et de la clé en cas de soumission incertaine ; sélecteur de modèle verrouillé.
- **Qualification mathématique stricte** :
  - Jamais un statut `SUCCEEDED` ne déclare une solution `OPTIMAL` si la preuve mathématique n'est pas certifiée par le vérificateur.
  - Les solutions non vérifiées ou infaisables affichent clairement l'alerte d'audit correspondante.
- **Résultats de référence réels** :
  - Usine : Objectif vérifié **4100 EUR** (A=40, B=15).
  - Université : Objectif vérifié **17**.
- **Mode Métier vs Expert** :
  - Mode Métier (défaut) : Cartes d'indicateurs clés, variables de décision principales, ressources saturées, statut de confiance certifié.
  - Mode Expert : Onglets détaillés, dump JSON du plan et de la solution, métadonnées du solveur, temps d'exécution et diagnostics.

## Tests réellement exécutés

Environnement local : Windows 11, Python 3.14.3, Node.js v24.13.0, PostgreSQL 17 (conteneur Docker `optimizerbrain4a-postgres-1` sur port 55432), Chromium Playwright 159.0.

| Contrôle | Résultat local | Détails |
|---|---|---|
| TypeScript (`tsc -b`) | Réussi | 0 erreur |
| Build Vite (`vite build`) | Réussi | Bundle généré en 491 ms |
| ESLint (`eslint .`) | Réussi | 0 avertissement, 0 erreur |
| Vitest complet | **213 réussites (16 fichiers)** | Tous les tests unitaires et composants verts |
| Ruff check & format | Réussi | `All checks passed!`, 67 fichiers vérifiés |
| mypy | Réussi | `Success: no issues found in 46 source files` |
| Pytest complet (PostgreSQL réel) | **394 réussites (92 ignorés)** | 105 secondes, 0 échec |
| Playwright E2E Studio isolé | **50 réussites / 50 parcours** | 2,4 minutes, base de données E2E isolée |
| Mesures de performance UX-F4 | **24 échantillons (8 configurations)** | 1440, 1280, 768, 390 px — usine et université |

### Nouveaux tests et adaptations

- `frontend/tests/execution-ux.test.tsx` : Tests dédiés à la confirmation modale et au refus de qualifier `SUCCEEDED` comme optimal sans vérification.
- `frontend/tests/execution-components.test.tsx` : Vérification du parcours de confirmation et du masquage pour le rôle VIEWER.
- `frontend/tests/execution-monitor.test.tsx` : Vérification de l'anti-chevauchement entre rafraîchissement manuel et polling de job.
- `frontend/tests/e2e/execution.spec.ts` : Parcours end-to-end complets adaptés avec confirmation modale et vérification des rôles.

## Mesures de performance (Before vs After)

Mesures recueillies sur 3 contextes frais par couple secteur/largeur d'écran (latence UI incluant Playwright et réseau) :

| Secteur | Largeur | Center (Avant -> Après) | Settings (Avant -> Après) | Cockpit (Avant -> Après) | Débordement horizontal |
|---|---|---|---|---|---|
| Factory | 1440 px | 962.8 ms -> 956.9 ms | 124.0 ms -> 136.0 ms | 34.9 ms -> 50.8 ms | Aucun (false) |
| Factory | 1280 px | 953.9 ms -> 958.3 ms | 123.1 ms -> 123.9 ms | 46.8 ms -> 34.6 ms | Aucun (false) |
| Factory | 768 px | 908.1 ms -> 949.4 ms | 122.6 ms -> 125.3 ms | 31.4 ms -> 44.9 ms | Aucun (false) |
| Factory | 390 px | 910.9 ms -> 910.5 ms | 108.4 ms -> 123.3 ms | 31.1 ms -> 40.9 ms | Aucun (false) |
| University | 1440 px | 958.8 ms -> 959.5 ms | 123.9 ms -> 125.5 ms | 31.4 ms -> 43.9 ms | Aucun (false) |
| University | 1280 px | 949.4 ms -> 950.8 ms | 123.0 ms -> 123.0 ms | 32.3 ms -> 45.0 ms | Aucun (false) |
| University | 768 px | 908.2 ms -> 916.7 ms | 121.4 ms -> 141.2 ms | 30.9 ms -> 44.6 ms | Aucun (false) |
| University | 390 px | 921.3 ms -> 904.4 ms | 108.2 ms -> 124.6 ms | 31.6 ms -> 35.0 ms | Aucun (false) |

Aucun débordement horizontal constaté sur aucun des 24 échantillons. Les temps d'affichage restent largement inférieurs aux seuils cibles de réactivité.

## Captures d'écran produites

Stockées dans `docs/screenshots/ux-f4/` :
- `factory-center-{1440,1280,768,390}.png`
- `factory-cockpit-{1440,1280,768,390}.png`
- `university-center-{1440,1280,768,390}.png`
- `university-cockpit-{1440,1280,768,390}.png`

## Limites connues

- La reprise de session après rechargement complet de la page du navigateur repose sur l'ID du job conservé ou sélectionné dans l'historique de l'organisation ; aucun stockage local non sécurisé n'est utilisé.
- Les annulations de jobs sont coopératives côté backend : l'état passe immédiatement à « Annulation demandée » côté UI puis attend la confirmation effective de terminaison par le worker serveur.
