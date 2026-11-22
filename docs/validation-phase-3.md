# Validation de phase 3 — 22 novembre 2026

Périmètre : Multi-department Model Builder, conformément à PHASE_3_CODEX_BRIEF.md.
AGENTS.md et les 1128 lignes de la spécification ont été lus intégralement.
L'audit et la baseline sont consignés dans [audit-phase-3.md](audit-phase-3.md).

## Environnement et commandes réellement exécutées

Windows / PowerShell, Python **3.14.3** du venv, SciPy 1.17.0 / HiGHS embarqué 1.8.0,
SQLite 3.50.4. Aucune nouvelle dépendance n'est installée : SQLite utilise le module standard.
Toutes les commandes Python emploient `.\.venv\Scripts\python.exe`.

| Contrôle | Résultat observé |
|---|---|
| Baseline pytest, avant implémentation | **188 passed, 2 warnings in 2.92s** |
| Nouveaux tests de phase 3 | **75 passed, 1 warning in 2.48s** |
| Suite complète finale | **263 passed, 2 warnings in 4.13s** |
| `-m ruff check brain tests` | All checks passed |
| `-m ruff format --check brain/kernel brain/solvers brain/organization tests/test_kernel.py tests/test_generic_solver.py tests/test_organization.py` | 24 files already formatted |
| `-m mypy` | Success: no issues found in 21 source files |
| CLI golden de phase 2, en baseline | OPTIMAL à tolérance près, 40/15, objectif 4100 EUR, vérification valide |
| CLI phase 3 usine avec publication locale | OPTIMAL à tolérance près, 40/15, 4100 EUR ; utilisations 95/100 h, 7000/8000 EUR, 55/55 unités |
| CLI phase 3 université avec publication locale | OPTIMAL à tolérance près, mathématiques/sciences sélectionnées, score 17 ; budget 9/9 EUR et salles 2/2 |
| CLI replay usine | Source/graphe/fragments, DSL, IR, hashes et traces identiques à une composition directe |

La suite complète a été exécutée suivant le brief : TEMP/TMP sous
`%LOCALAPPDATA%\OptimizerBrain\temp`, `--basetemp=...\pytest-phase3`,
`-p no:cacheprovider`. La baseline utilisait un sous-dossier séparé
`pytest-phase3-baseline`. Aucun nettoyage récursif du projet n'est réalisé.

Les 188 tests antérieurs restent présents et leurs attentes ne sont pas modifiées,
y compris les 14 historiques. La phase 3 ne change ni kernel, adaptateur HiGHS,
vérificateur, tolérances, modèles legacy ou routes existantes. L'état Git contenait
déjà les changements non commités de phase 2 ; ils sont préservés.

## Couverture des critères du brief

1. Schémas fermés de graphe, fragments, imports et liaisons ; refus de champs exécutables
   ou d'objectifs locaux et revalidation des objets Pydantic mutés.
2. Ordre des fragments/nœuds/imports/termes sans effet sur source et DSL canoniques,
   IR, hashes et traces, vérifié sur les deux organisations.
3. Une seule colonne qty_A, explicitement importée par plusieurs départements ;
   un adaptateur comptant les appels confirme **une seule résolution globale**.
4. Refus localisés de collisions, références inconnues, unités incohérentes,
   propriétés et périmètres invalides, approbations manquantes et versions incompatibles.
5. Deux règles HARD de départements distincts imposent qty_A>=30 et qty_A<=20 :
   résultat INFEASIBLE, provenance conservée, aucun plan/utilisation inventé.
6. Métadonnées descriptives → manifeste changé, hash mathématique conservé ;
   changement numérique → hash mathématique changé. Copies détachées et immutabilité
   empêchent une mutation externe de réécrire la composition.
7. Capacités/utilisations/marges recalculées à partir des valeurs brutes ; une valeur
   entière proche reste non arrondie. Résultat d'un autre modèle ou résultat corrompu
   refusé. Une corruption backend produit SOLUTION_FAILED_VALIDATION sans utilisation.
8. Usine : comparaison au golden DSL direct et au legacy sur une réduction explicitement
   équivalente. Université : comparaison aux huit combinaisons binaires d'un oracle
   indépendant. Réduire le pool partagé à un créneau interdit de sélectionner plusieurs cours.
9. Résolution avec sockets interdits, clé LLM absente et solveur legacy interdit :
   le moteur générique reste disponible. Aucune API réseau ou LLM n'est appelée.
10. Publication idempotente et concurrente, conflit de version, interruption simulée
    avec rollback de tous les composants, checksum altéré et dérivation falsifiée détectés.
11. Nouvelle capacité 45, versions/snapshot correspondants : objectif 3500 EUR,
    ancien snapshot relu/résolu à 4100 EUR sans modification.
12. CLI compose/solve/replay, exports JSON/Mermaid, chemins confinés au projet,
    refus de liens de stockage redirigés, références SQL traitées comme clés paramétrées.

## Artefacts de démonstration

- `results/phase3_baseline_solve.json` : résultat de baseline de phase 2.
- `results/organization_factory.json` et `.mmd` : composition, solve, rapport et graphe usine.
- `results/organization_university.json` et `.mmd` : même pipeline sur le cas universitaire.
- `results/organization_factory_composed.json` et `_replay.json` : égalité contrôlée
  par chargement JSON après publication/relecture.
- Base locale de démonstration dans `local_store/phase3/snapshots.sqlite3`, ignorée par Git.

Les données sont fictives. Les premiers essais de la phase 3 ont utilisé un autre
répertoire local ; la publication finale ci-dessus conserve ses propres snapshots.
Aucun historique publié n'est réécrit pour modifier un libellé.

## Limites réellement observées

Les deux avertissements externes préexistants persistent : anyio/pytest CallSpec2
et Starlette/httpx. Ruff et mypy ne rapportent aucune erreur.
La CI Python 3.11 Windows/Linux est étendue mais **non exécutée dans cette session**.
Les tests de rollback simulent une erreur applicative, sans simuler une coupure
électrique ou garantir les propriétés du matériel/système de fichiers.

Un fragment par département, objectif global unique et contraintes HARD uniquement.
Pas d'ActivityNode, de frontend lourd, d'authentification/RBAC, d'isolation multi-tenant,
de signatures, de PostgreSQL, de worker, d'IIS ou de négociation de contraintes.
Les statuts et limites numériques de l'ADR 0002 sont conservés ; un OPTIMAL HiGHS
reste qualifié par ses tolérances, jamais présenté comme certificat rationnel strict.
Les phases 4 à 8 ne sont pas implémentées.
