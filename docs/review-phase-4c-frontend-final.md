# Revue finale — Phase 4C Frontend Optimization Execution Center

Date : 22 novembre 2026. Branche examinée :
`feature/phase-4c-frontend-execution-center`. Code fonctionnel :
`27e0ea56657fa90547b0e77175c680f5161e8451`. Base main :
`c3b41a1fc0778ff0ce3582c6f3714700b5c23daa`.

Les deux références ont aussi été vérifiées sur origin. Le seul fichier non
suivi était `tatus`, conservé. Aucun merge, changement de modèle mathématique ou
travail de Phase 5 dans cette revue. Cet ajout est documentaire ; le code revu
reste celui du commit indiqué ci-dessus.

Lecture : AGENTS.md, spécification intégrale, ADR 0007, validation 4C, diff depuis
main, modules d'exécution/client/navigation/historique et tests correspondants.
Contrôles backend de permissions/idempotence/annulation et configuration CI
consultés pour vérifier les frontières de confiance.

## Bloquants

**Aucun problème bloquant confirmé dans le périmètre examiné.** Aucun correctif
fonctionnel ni test de non-régression supplémentaire nécessaire pour cette revue.

| Axe | Constats vérifiés dans le code et les tests |
|---|---|
| Multi-tenant | Le client contrôle organization_id et l'identité sur les détails, organization_id sur les listes et organization_id/model_version_id sur les soumissions ; les segments de route sont encodés. Workspace et JobMonitor sont identifiés par tenant/ressource. Le backend recontrôle appartenance active, rôle et contexte RLS. Aucun endpoint legacy utilisé. |
| Réponses tardives | Abort vérifié avant traitement HTTP et après lecture du corps ; un 401 d'une requête annulée ne peut pas expirer une nouvelle session. Les hooks invalident les callbacks et masquent immédiatement l'ancien état à chaque changement d'identité. Tests dédiés pour transport ignorant abort, destruction et changement de tenant. |
| Idempotence | Référence synchrone contre clics concurrents, verrou après acceptation, corps et clé capturés avant POST. Réponse incertaine : répétition explicite à corps/clé constants. Le test réseau crée réellement côté serveur puis coupe la réponse ; la répétition retrouve le même job. Concurrence et conflits de clé testés sur PostgreSQL. |
| Annulation | UI limitée à ADMIN ou créateur encore autorisé ; permission serveur définitive. Le POST ne fabrique pas CANCELLED : une nouvelle lecture décide de l'état, y compris une réussite concurrente. Cas QUEUED, RUNNING et absence de run après annulation couverts. |
| Résultats | SUCCEEDED est séparé du statut solveur. Le run chargé doit correspondre au modèle du job. Affichage du plan soumis aux indicateurs de vérification concordants ; inconnus/échec de validation n'acquièrent pas d'optimalité. Décisions, unités, objectifs, marges et bornes sont affichés depuis le run, sans calcul métier dans React. |
| Numérique | Données métier décimales/fractions préservées textuellement ; seuls les paramètres flottants de configuration sont normalisés. Adaptation scientifique limitée au pattern de sortie des tolérances, sans modification des valeurs, de l'OpenAPI original ou du vérificateur. Absence de borne/gap affichée comme absence. |
| Worker | Seul changement Python : flush de l'annulation QUEUED avant changement de contexte RLS. Le test multi-organisations cible précisément ce défaut ; aucune politique RLS ou autorisation élargie. |
| Conservation | Aucun diff du kernel, des solveurs, du compositeur, des migrations, des dépendances ni de l'API legacy ; les tests historiques sont toujours découverts par les commandes CI. |

## Risques résiduels

Limites acceptées et documentées dans les ADR 0006/0007, non reclassées en
défauts de cette branche :

- Le jeton et la demande incertaine du panneau ne survivent pas au rechargement
  ou à sa destruction. Après reconnexion, consulter les jobs avant un nouveau
  lancement ; l'idempotence navigateur n'est pas un journal durable des intentions.
- Le suivi s'arrête après 300 lectures jusqu'à reprise explicite ; la liste est
  un instantané paginé. Le nombre de lectures ne borne pas le temps d'une requête
  réseau bloquée. Une actualisation explicite annule la lecture et reprend le suivi.
- Concurrence par worker et limites Linux par processus, sans quota global de
  flotte. Ces limites backend préexistent au frontend et restent exposées.
- Les parcours navigateur de la CI sont exécutés sous Chromium/Linux ; la
  matrice Python Linux/Windows sans PostgreSQL ne remplace pas le job PostgreSQL
  ni une matrice complète de navigateurs/OS.

## Tests

Le checkout du [run GitHub 45057088891](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45057088891)
vise bien le SHA complet `27e0ea56657fa90547b0e77175c680f5161e8451`.
Étapes et journaux des trois jobs consultés, pas seulement la conclusion globale.

| Contrôle CI vérifié | Résultat |
|---|---|
| PostgreSQL réel, Python 3.11 | **337 passed, 8 skipped, 1 warning**, 51,35 s |
| Vitest | **89 passed**, 7 fichiers |
| Playwright, bundle compilé + API/PostgreSQL/workers réels | **27 passed**, 1,1 min, aucun skip |
| Matrice Python Linux sans PostgreSQL | **298 passed, 47 skipped**, Ruff et mypy réussis |
| Matrice Python Windows sans PostgreSQL | **298 passed, 47 skipped**, Ruff et mypy réussis |
| Autres étapes | npm ci, génération OpenAPI/types et absence de dérive, build TypeScript strict, lint, migrations et démonstrateurs réussis |

Les huit skips du job PostgreSQL sont les variantes SQLite des tests nécessitant
le worker/PostgreSQL/RLS. Dans les deux autres jobs, les 47 skips comprennent aussi
les variantes PostgreSQL non configurées. Aucun skip compté comme réussite.

La configuration déclenche la CI sur push et pull_request ; pytest découvre tests/,
Vitest les fichiers *.test.ts/tsx et Playwright les deux suites sous tests/e2e.
Le build inclut src/ et tests/ en TypeScript strict. Les erreurs des commandes
font échouer leur étape ; aucun continue-on-error ajouté. Les workers des parcours
sont lancés dans les tests avec la configuration runtime uniquement.

Portée : références usine **4100 EUR** et université **17**, annulations, échec
technique, INFEASIBLE et TIME_LIMIT réels ; erreurs HTTP injectées explicitement
pour la présentation et cas TIME_LIMIT avec plan vérifié couvert en composant.
Ces derniers ne sont pas présentés comme des preuves de résolution supplémentaires.

Complément local pendant la revue : **89 tests Vitest réussis** (7,06 s),
TypeScript, ESLint, Ruff et mypy réussis. Les suites Python/Playwright de référence
sont vérifiées dans la CI ci-dessus ; elles ne sont pas annoncées comme rejouées
localement pendant cette revue.

## Recommandation de fusion

**Je recommande explicitement la fusion de la branche dans main**, sur la base du
code fonctionnel `27e0ea5` et de la CI vérifiée. Ce rapport n'ajoute aucun code
fonctionnel. Conserver les contrôles requis sur la tête de branche lors de la
pull request. Aucune fusion automatique effectuée.
