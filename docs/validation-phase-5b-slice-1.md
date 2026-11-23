# Validation — Phase 5B, première tranche

## Prérequis réellement vérifiés

La [PR #4](https://github.com/SIMOS21/Optimizer-brain/pull/4) est fusionnée dans
`main`, commit `b25ca8d6ebfcf3dbd29e11d18b44ae7384785980`. La
[CI de ce main](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45082342182)
est réussie sur Ubuntu, Windows et PostgreSQL avant la livraison.
`main` a été synchronisé en fast-forward ; branche créée depuis ce commit :
`feature/phase-5b-scenario-lab`. Le fichier non suivi `tatus` est préservé.
AGENTS.md, la spécification complète, la roadmap et les huit ADR précédents ont
été lus ; l'architecture retenue est consignée dans l'ADR 0009.

## Tranche vérifiée

Création d'une version de scénario identique depuis un modèle publié, avec
nouvelle ModelVersion DRAFT, provenance et empreintes canoniques, publication
explicite et résolution via le worker existant. API v1, table sous RLS/append-only,
Studio et historique paginé livrés. La migration `0005_5b` est additive.

Le kernel, le compositeur, HiGHS, le vérificateur et les diagnostics 5A ne sont
pas modifiés. Le worker ne change que son contrôle de révision de schéma.
Les modèles et runs historiques ne sont pas convertis ni recalculés.

## Résultats locaux observés

Windows/PowerShell, Python 3.14.3, Node 24.13.0, PostgreSQL 17 :

| Contrôle | Résultat |
|---|---|
| pytest complet avec PostgreSQL | **408 passed, 8 skipped**, 114,30 s |
| Ruff check | Réussi sur brain/tests/migrations/scripts |
| Ruff format | **59 fichiers** conformes sur les chemins de la CI |
| mypy strict | Réussi, **41 fichiers sources** |
| Vitest | **118 passed**, 9 fichiers |
| Playwright complet | **32 passed**, 1,6 min, API/PostgreSQL/worker réels |
| TypeScript, build et ESLint | Réussis |
| OpenAPI exporté | Test d'égalité au contrat de l'application réussi |

Les huit skips restent les variantes SQLite des scénarios de file/RLS qui
exigent PostgreSQL ; les variantes PostgreSQL sont exécutées dans la même suite.
Deux avertissements pytest proviennent des dépendances anyio et Starlette/httpx ;
le build signale une directive du runtime React, sans erreur de compilation.

Les **17 nouveaux cas Python** couvrent clone et conservation exacte de source,
snapshot et hash mathématique ; publication obligatoire ; idempotence du job ;
demande d'annulation ; rôles et tenants ; révocation ; schéma fermé ; empreinte
attendue ; collisions/version/auteur ; famille à référence fixe ; RLS et pool ;
privilèges runtime ; triggers et FK ; création concurrente identique et
conflictuelle ; rollback de modèle/audit/scénario ; upgrade sans réécriture des
payloads ; corruption refusée ; goldens usine et université.

Les **14 nouveaux cas Vitest** couvrent le contrat de changement vide, le rejet
de provenance étrangère, le lien à l'empreinte de référence, les rôles en lecture,
les doubles soumissions, la réponse incertaine/répétition identique, le conflit
explicite, le callback après destruction, la pagination et l'absence de résultat
ou gain fictif. Les protections asynchrones communes restent testées par les
régressions du Studio.

Les **deux nouveaux parcours Playwright** créent le scénario dans React, ouvrent
son modèle, confirment la publication, soumettent un job au worker réel puis
retrouvent le scénario publié dans l'historique. Les résultats restent
**4100 EUR** pour l'usine et **17** pour l'université, indépendamment vérifiés.
Les 30 parcours antérieurs couvrent encore isolation, annulation, échec,
INFEASIBLE, TIME_LIMIT, idempotence et les deux secteurs.

Les tests de migrations destructifs restent confinés à `optimizer_brain_test`.
Sur la base de développement du Studio, seule l'upgrade additive a été appliquée ;
aucune remise à zéro, downgrade ou suppression de données. Les parcours y créent
des versions synthétiques supplémentaires au lieu d'écraser les références.

## CI et limites

Le workflow inclut automatiquement les nouveaux tests et parcours et contrôle
explicitement le format de `test_scenarios.py`. OpenAPI et TypeScript restent
protégés contre la dérive après régénération. La CI du commit poussé est vérifiée
avant le rapport de livraison, avec résultat consultable dans les
[Actions de branche](https://github.com/SIMOS21/Optimizer-brain/actions?query=branch%3Afeature%2Fphase-5b-scenario-lab).

Ce n'est pas la clôture de toute la Phase 5B. Les modifications ciblées,
politiques d'autorisation fine et comparaisons de résultats ne sont pas livrées.
Aucun gain, sensibilité, batch ni relaxation HARD. Les lectures reconstruisent
les artefacts et ne sont pas benchmarkées sur de gros historiques. La prochaine
tranche de 5B doit traiter les politiques publiées avant toute variation de valeur.
Les Phases 5C et 6 ne sont pas commencées ; aucune PR n'est fusionnée automatiquement.

## Revue finale après la livraison de référence

Un défaut de comparaison frontend a été reproduit puis corrigé : la version
` 1 `, normalisée en `1` par l'API, était rejetée par le client après création.
Le [rapport de revue](review-phase-5b-slice-1-final.md) détaille la reproduction,
la correction minimale, les dix invariants examinés et les risques résiduels.
Après correction : **410 tests Python réussis, 8 skips**, **122 Vitest** et
**32 Playwright** réussis, avec PostgreSQL et worker réels ; Ruff, mypy,
TypeScript, build et lint réussis. Les chiffres précédents décrivent toujours
la livraison `8d8ade1`, avant les non-régressions ajoutées pendant cette revue.
