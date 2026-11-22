# Reprise Phase 4C — revue backend et préparation du frontend

Date : 22 novembre 2026. Périmètre de cet incrément : revue et sécurisation de la
tranche backend existante, puis préparation de l'Optimization Center. Aucune
modification du kernel, du compositeur, de HiGHS, du vérificateur ou de l'API legacy.

## Dépôt et prérequis observés avant modification

- Branche locale : `feature/phase-4c-execution-center`, commit `b82a65a`.
- `main` local et base de la PR : `c322f88`, intégration de la Phase 4B par PR #1.
- [PR #2](https://github.com/SIMOS21/Optimizer-brain/pull/2) ouverte, non fusionnée,
  non draft, déclarée fusionnable par GitHub lors de la consultation.
- Arbre suivi propre, `git diff --check` sans erreur. Le fichier non suivi `tatus`
  a été conservé et exclu des commits.
- Lecture intégrale d'AGENTS.md, de la spécification cible, de la roadmap, du guide
  4C et de l'ADR 0006. Inspection de l'API, des services, du worker, des processus,
  de la migration 0004, des tests et du Studio/OpenAPI réellement présents.
- Correctifs `b82a65a` présents : budget CPU transmis au lancement et
  `PerJobUserTimeLimit` / drapeau Windows `JOB_OBJECT_LIMIT_JOB_TIME` configurés.
- [CI du commit initial](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45049336231)
  consultée : trois jobs réussis (Linux, Windows et PostgreSQL, incluant le Studio).
  Ce résultat ne remplace pas la validation du correctif de cette revue.

## Constats démontrés et corrections

**Révocation de compte non relue à la publication.** Le child contrôlait le
compte avant le calcul, puis réutilisait l'objet détaché dans une nouvelle
transaction. Désactiver le créateur entre ces transactions n'empêchait pas
l'enregistrement du run. Le test a échoué pour cette raison sur SQLite **et**
PostgreSQL avant correction ; la révocation d'adhésion était déjà prise en compte.

`job_child.execute_job` relit maintenant le créateur avec `SELECT … FOR UPDATE`
dans la transaction finale, après le verrou d'organisation. Un compte inactif
provoque le rollback et aucun run n'est publié. Le verrou sérialise la publication
avec une désactivation concurrente. L'ordre organisation → utilisateur → job
évite de conserver un verrou pendant le solve. Le superviseur traite la sortie
sans résultat comme un échec ; aucun résultat mathématique n'est inventé.

**Succès HTTP antérieur au commit.** Le scope par défaut des dépendances yield
FastAPI fermait la transaction après l'envoi du corps de réponse. Un test
instrumentant `Session.commit` et le début de `Response.__call__` a reproduit
l'ordre incorrect `accepted → committed` sur SQLite et PostgreSQL. La dépendance
`DB` utilise désormais `Depends(db, scope="function")`. Quatre tests sur les
créations de jobs et de graphes imposent `committed → accepted` ; aucun changement
de route, payload ou contrat OpenAPI. Une lecture immédiatement suivante et le
worker ne doivent pas manquer une écriture déjà annoncée comme réussie.

La première CI de revue a rencontré un import graphe sans écran DRAFT dans le
dernier parcours navigateur. Douze parcours passaient ; le même cas passait aussi
10 fois localement. La course transactionnelle ci-dessus est démontrée et
compatible avec ce symptôme, sans prétendre identifier rétrospectivement toute
la cause de l'échec distant. Aucun sleep, retry automatique ou délai artificiel
n'a été ajouté au parcours pour le masquer.

## Invariants examinés

| Point | Code et preuve exercée |
|---|---|
| Organisations/RLS | Contrôle d'adhésion dans chaque route, contexte tenant transaction-local, FORCE RLS sur les jobs ; tests API outsider et lecture SQL sans contexte |
| Idempotence | Clé hachée, portée organisation/créateur, empreinte modèle/settings, verrou d'organisation et unicité SQL ; répétition, conflit 409 et deux soumissions concurrentes testés |
| Concurrence de file | `FOR UPDATE SKIP LOCKED` ; deux claims concurrents ont des identifiants distincts |
| Baux/fencing | Horloge PostgreSQL, heartbeat conditionné à tentative/worker/bail ; expiration explicite sans retry, ancienne tentative refusée |
| Arrêt effectif | Groupe Linux/subreaper et Job Object Windows ; tests d'arrêt de descendants et de crash du superviseur |
| CPU/mémoire | Budget CPU Windows et RLIMIT_CPU/AS Linux ; fixture contrôlée utilisant le bootstrap de production, plafond 128 MiB et budget 2 s, allocation totale de secours limitée à 256 MiB |
| Atomicité | `record_run` revérifie indépendamment puis run/SUCCEEDED partagent la transaction ; expiration simulée après création du run entraîne son rollback |
| Accusé HTTP durable | Commit de la dépendance SQLAlchemy avant envoi de la réponse ; ordre instrumenté sur créations graphes/jobs sous SQLite et PostgreSQL |
| Annulation/réussite | Verrous organisation/job et garde SQL des états terminaux ; demande séparée de la confirmation, course avec worker testée, succès conservé |
| Intégrité du résultat | Une solution volontairement corrompue est rejetée par la revérification à la persistance ; aucun run créé |
| Crash/résultat obsolète | Échec après expiration, aucune reprise automatique ; tentative périmée sans run, historique terminal protégé par trigger |

Ce tableau décrit des contrôles et des tests ciblés, pas une preuve formelle de
tous les ordonnancements possibles. Les limites connues restent : concurrence
par processus worker, absence de retry automatique et de supervision de flotte.
Sous Windows, les plafonds concernent le Job Object ; sous Linux, RLIMIT_AS et
RLIMIT_CPU sont des limites par processus, héritées par les descendants, et non
un budget mémoire/CPU agrégé de type cgroup pour tout l'arbre. Les tests de petits
processus ne constituent pas un benchmark de charge ni un quota global de flotte.

## Architecture frontend proposée, après intégration approuvée du backend

Réutiliser React/TypeScript strict, React Router, AJV, le client authentifié et les
contrats OpenAPI déjà générés. Aucun service ni dépendance supplémentaire prévu.

| Module ciblé | Responsabilité |
|---|---|
| `frontend/src/api/types.ts`, `client.ts` | Alias Job/SolveSettings générés ; soumission avec en-tête Idempotency-Key, liste, détail et annulation tenant-scoped ; contrôle des identifiants de réponse |
| `features/execution/OptimizationCenter.tsx` | Sélection de modèles publiés, provenance, versions et liste des jobs accessibles |
| `features/execution/ExecutionPanel.tsx` | Formulaire des seuls SolveSettings autorisés, validation du schéma, verrou contre double clic ; même clé pour une répétition de la même demande incertaine, nouvelle clé pour une nouvelle exécution |
| `features/execution/useJobMonitor.ts` | Polling borné sans requêtes qui se chevauchent ; arrêt terminal, pause hors vue, reprise au retour, erreurs explicites |
| `features/execution/JobMonitor.tsx` | État technique distinct du statut solveur ; annulation demandée puis état confirmé du serveur, aucun pourcentage de progression |
| `features/execution/DecisionCockpit.tsx` | Lecture du run immuable : objectif/unité, décisions, contraintes/slacks, ressources, vérification, tolérances, borne/gaps réellement fournis |
| `features/history/History.tsx` | Détail partagé et route durable vers un run ; conserver les historiques existants |
| `app/App.tsx`, `features/organizations/Workspace.tsx` | Route `/organizations/:org/execution/:job?`, navigation, transmission de l'identité publique pour les commandes autorisées |

Le jeton reste uniquement en mémoire. Une reconnexion relit les jobs du tenant
autorisé ; l'URL ne conserve qu'un identifiant, aucun secret. Un changement de
tenant/déconnexion annule les requêtes et invalide les callbacks tardifs, même si
le transport ignore AbortController. La reprise après rechargement exige une
authentification nouvelle avec le fonctionnement actuel du Studio.

Les modèles DRAFT sont exclus du lancement ; le serveur reste l'autorité. Lancement
visible pour ADMIN/BUILDER ; annulation affichée seulement pour ADMIN ou créateur
encore autorisé par le backend. La révocation d'un rôle pendant la navigation
reste traitée par les réponses HTTP et ne doit pas être contournée côté client.

`SUCCEEDED` signifie que le traitement a produit un run, y compris si le modèle
est INFEASIBLE ou sans solution au TIME_LIMIT. Les valeurs proviennent du document
conservé : aucune conversion rationnelle approximative ni déduction de marges ou
de progression côté navigateur. Les champs absents restent indisponibles et les
statuts inconnus restent explicitement non reconnus.

## Plan de tests frontend à exécuter dans cet incrément ultérieur

1. Client : Idempotency-Key, conflit 409, périmètre des réponses, annulation,
   erreurs 401/403/404/422 et nettoyage des requêtes.
2. Composants : modèle publié/DRAFT, RBAC, double soumission, transitions réelles,
   annulation demandée/confirmée et réussite concurrente.
3. Moniteur : polling contrôlé, navigation, reconnexion, réponse tardive après
   changement d'organisation, absence de progression artificielle.
4. Cockpit : OPTIMAL à tolérance près, INFEASIBLE, TIME_LIMIT avec/sans plan
   vérifié, autres statuts, borne/gaps null, marges et unités non recalculées.
5. Playwright sur PostgreSQL et worker réels : usine et université, lancement →
   job → run indépendant vérifié → historique ; parcours annulation et refus.
6. Régressions Python, Ruff/mypy, npm ci, types stricts/build/lint, Vitest,
   Playwright et CI Linux/Windows/PostgreSQL.

## Risques à traiter dans le frontend

- Une réponse POST perdue ne prouve pas que le job n'existe pas : conserver la
  même clé lors d'une répétition explicite, sans relance silencieuse du solveur.
- Une demande d'annulation peut croiser une réussite ; seule la réponse serveur
  autorise l'affichage de CANCELLED ou SUCCEEDED.
- Un état technique favorable ne certifie ni faisabilité ni optimalité ; utiliser
  les champs de vérification et le statut mathématique enregistrés séparément.
- Les détails `RunDocument` restent des dictionnaires JSON dans OpenAPI : écrire
  une projection d'affichage défensive, sans assertions aveugles ni calcul métier.
- Polling et réponses tardives peuvent réintroduire des données du précédent
  tenant ; tests d'invalidation indispensables, sans cache partagé inter-tenant.

## Validation de cet incrément

Windows / PowerShell, Python 3.14.3, PostgreSQL 17, Node 24.13.0, npm 11.6.2.

| Contrôle exécuté | Résultat réel |
|---|---|
| Baseline Python avec PostgreSQL | **320 passed, 6 skipped, 2 warnings**, 62,22 s |
| Reproduction avant correction | **2 failed, 2 passed** : révocation du compte acceptée à tort sur SQLite et PostgreSQL ; adhésion déjà refusée |
| Révocation après correction | **4 passed**, 5,38 s |
| Commit avant confirmation HTTP, après correction | **4 passed**, 4,58 s ; test d'ordre auparavant en échec sur SQLite et PostgreSQL |
| Suite Python finale avec PostgreSQL | **336 passed, 7 skipped, 2 warnings**, 77,88 s |
| Limites CPU/mémoire et arbres de processus Windows, test ciblé | **4 passed**, 10,04 s |
| Ruff check / format | Réussis ; **50 fichiers** conformes au périmètre de formatage étendu |
| mypy strict | Réussi, **36 fichiers** |
| `npm ci --no-audit --no-fund` | Réussi, **290 packages** |
| TypeScript strict / build / lint | Réussis ; `npm run typecheck`, `npm run build`, `npm run lint` |
| Contrats | Export OpenAPI testé par pytest ; `openapi-typescript --check` réussi, types inchangés |
| Vitest | **37 passed**, 4 fichiers, 5,12 s |
| Playwright, bundle compilé + API sécurisée + PostgreSQL réel | **13 passed**, 19,0 s après correction transactionnelle ; régressions usine/université et permissions |

Les **sept skips** finaux correspondent exclusivement aux variantes SQLite des
tests de worker/file/concurrence PostgreSQL. Leurs variantes PostgreSQL sont
exécutées : aucun skip compté comme réussite. Les deux warnings Python viennent
d'anyio/pytest et de Starlette/httpx. Le build conserve les avertissements Vite
sur le chunk initial de 506,56 kB et la directive externe `use no memo`.

La première tentative de npm ci était bloquée par une DLL Rolldown chargée par
les serveurs Vite précédemment démarrés pour nos tests. Ces deux sessions ont été
arrêtées, puis npm ci a réussi ; aucun processus utilisateur arbitraire arrêté.
La migration additive 0004 a été appliquée à la base de développement sans reset.
Les tests destructifs de migration et d'isolation utilisent uniquement la base
explicitement nommée `optimizer_brain_test`. Les parcours navigateur ajoutent des
versions synthétiques, sans altérer les versions/historiques existants ; leurs
captures sont dans `frontend/test-results/review-4c-screenshots`, ignoré par Git.

La [première CI de revue](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45051501208)
au commit `dcc3f0b` a validé Linux/Windows (296 passed, 43 skipped chacun),
PostgreSQL (332 passed, 7 skipped), Vitest (37) et 12/13 parcours navigateur.
L'échec du treizième parcours est conservé dans ce compte rendu.

Après correction transactionnelle, la [CI du commit `e356c25`](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45052380054)
est **verte sur les trois jobs Linux, Windows et PostgreSQL**. Le job PostgreSQL
confirme **336 passed, 7 skipped, 1 warning en 37,27 s**, **37 tests Vitest** et
**13 parcours Playwright réussis en 14,6 s**. Les deux jobs sans configuration
PostgreSQL ont leurs skips d'intégration attendus ; leurs résultats ne sont pas
utilisés comme preuve d'exécution des tests PostgreSQL. Les limites CPU et mémoire
sont également exercées sur Linux par cette CI.

Les parcours Playwright restent ceux du Studio 4B : ils ne sont pas présentés
comme une interface de lancement 4C. Le présent ajout documentaire ne change pas
le code validé au commit `e356c25`.

L'intégration de la PR #2 reste une étape humaine explicite. Aucune fusion dans
main ni branche frontend créée avant cette intégration approuvée, conformément
à la demande de reprise. Aucune Phase 5, logique LLM ou nouveau solveur.
