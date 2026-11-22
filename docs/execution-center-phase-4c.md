# Centre d'exécution asynchrone — Phase 4C

La tranche backend décrite ci-dessous est désormais complétée par
l'[Optimization Center React](frontend-execution-phase-4c.md). Le Studio utilise
exclusivement les quatre contrats de jobs ci-dessous et la consultation des runs.
Voir [validation frontend 4C](validation-phase-4c.md) et l'ADR 0007.

## Périmètre livré

L'API sécurisée crée, liste, consulte et accepte une demande d'annulation d'un job.
Le worker PostgreSQL est indépendant de FastAPI et démarre avec :

```powershell
python -m alembic upgrade head
python -m uvicorn brain.platform.api:create_app --factory --host 127.0.0.1 --port 8001
python -m brain.platform.worker
```

Le worker exige `BRAIN_DATABASE_URL` avec le rôle runtime `brain_app`, sans
identifiants de migration. La migration 0004 ajoute la table RLS
`optimization_jobs`; l'historique des `OptimizationRun` reste append-only.

## Contrats HTTP

| Méthode | Route | Règles |
|---|---|---|
| POST | `/api/v1/organizations/{org}/model-versions/{model}/optimization-jobs` | `Idempotency-Key` obligatoire (16–128 caractères), corps `{ "settings": SolveSettings }`, ADMIN/BUILDER, modèle publié, réponse 202 |
| GET | `/api/v1/organizations/{org}/optimization-jobs` | Membre actif du tenant ; pagination `limit`/`offset` |
| GET | `/api/v1/organizations/{org}/optimization-jobs/{job}` | Membre actif du tenant |
| POST | `/api/v1/organizations/{org}/optimization-jobs/{job}/cancel` | Créateur ou ADMIN ; réponse = état observé, pas une confirmation d'arrêt |

La répétition d'une clé avec la même organisation, le même utilisateur et le même
modèle/paramétrage renvoie le job existant. Réutiliser la clé pour un autre corps
renvoie 409. Les clés et empreintes d'idempotence ne sont jamais exposées.

La réponse sépare l'état technique `state` (`QUEUED`, `RUNNING`, `SUCCEEDED`,
`FAILED`, `CANCELLED`) de `solver_status`, qui décrit le résultat mathématique.
Un job `SUCCEEDED` possède un `run_id`; son résultat se consulte via la route
existante `/optimization-runs/{run_id}`. Une solution n'est persistée qu'après la
vérification indépendante dans `service.record_run`, dans la même transaction que
la transition vers `SUCCEEDED`.

## Concurrence et processus

- La file durable utilise `FOR UPDATE SKIP LOCKED`; les jobs sont isolés par RLS
  et un contexte tenant transaction-local.
- Chaque tentative possède un identifiant de fencing, un heartbeat et un bail.
  Un bail expiré termine le job en `FAILED/WORKER_LEASE_EXPIRED`; aucun retry
  automatique ne lance une seconde exécution tant que l'ancien processus n'est
  pas confirmé arrêté.
- Le worker termine l'arbre complet : groupe de processus et réaping des
  descendants sous Linux, Job Object Windows avec délai gracieux puis terminaison
  forcée. À la mort du superviseur, le processus enfant est également arrêté.
- `CANCELLED` est enregistré uniquement après confirmation de l'arrêt de l'arbre.
  La demande d'annulation ne modifie pas un état terminal et ne peut pas écraser
  un run vérifié.
- Les limites sont configurables : `BRAIN_JOB_MAX_CONCURRENCY` (1–32 par
  processus worker), `BRAIN_JOB_LEASE_SECONDS`, `BRAIN_JOB_HEARTBEAT_SECONDS`,
  `BRAIN_JOB_MEMORY_LIMIT_BYTES`, `BRAIN_JOB_TERMINATION_GRACE_SECONDS` et
  `BRAIN_JOB_HARD_TIMEOUT_GRACE_SECONDS`. La limite solveur par job reste bornée
  par `SolveSettings.time_limit_seconds` (300 s maximum). Un budget CPU de
  `ceil(time_limit_seconds + hard_timeout_grace_seconds)` est aussi imposé au
  Job Object Windows et via `RLIMIT_CPU` sous Linux.

La tranche backend n'ajoute pas d'endpoint de
retry, de limite de concurrence globale entre plusieurs instances worker, ni
des métriques de progression. Un crash/expiration est explicitement visible
comme échec et nécessite une nouvelle soumission avec une nouvelle clé.

## Validation

Les tests PostgreSQL opt-in couvrent l'idempotence, l'isolation tenant, les runs
vérifiés, les courses annulation/réussite, les expirations de bail et les timeouts.
Les tests de processus couvrent l'arrêt des descendants lors d'une annulation et
du crash du superviseur sous Windows/Linux. Ils ne réinitialisent que la base de
test explicitement nommée `optimizer_brain_test`.

La [revue de reprise](review-phase-4c-backend.md) consigne le correctif de
révocation du compte pendant le calcul, les validations réellement exécutées et
le découpage du futur Optimization Center React. Le compte, l'adhésion et le rôle
du créateur sont contrôlés à nouveau lors de la transaction finale. Les tests de
ressources exécutent aussi le bootstrap de production sous un plafond mémoire
de 128 MiB et un budget CPU de 2 secondes, sans base ni solveur.
