# Validation — Frontend Optimization Execution Center

22 novembre 2026. Base : main `c3b41a1`, après fusion confirmée de PR #2 au
commit backend `114d252`. Branche : `feature/phase-4c-frontend-execution-center`.
Voir [audit](audit-phase-4c-frontend.md), [guide](frontend-execution-phase-4c.md),
[ADR 0007](decision-records/0007-frontend-execution-and-result-trust.md).

## Livré

OptimizationCenter, ExecutionPanel, JobMonitor/useJobMonitor et DecisionCockpit
dans le Studio existant. Sélection de versions publiées, provenance, SolveSettings
validés, soumission idempotente, suivi technique borné, annulation demandée puis
confirmée par le serveur, résultat historique et routes durables de jobs/runs.
Le cockpit est partagé avec l'historique 4B et affiche les mesures enregistrées,
sans évaluer d'équation ni calculer un indicateur métier dans le navigateur.

L'API sécurisée, OpenAPI et les types générés restent inchangés. Aucune dépendance
ajoutée, aucune modification du kernel, de HiGHS, du compositeur ou du vérificateur.
Le seul changement Python est le flush tenant-scoped du worker décrit ci-dessous.
Aucune Phase 5, interface LLM ou action opérationnelle réelle.

## Défauts effectivement reproduits pendant l'intégration

1. **Tolérances réelles refusées par leur schéma généré.** Pydantic retourne
   `1E-7` / `1E-9` ; le pattern de sortie ne permettait pas l'exposant. La lecture
   AJV accepte cette notation textuelle uniquement dans VerificationSettings-Output,
   sans convertir les valeurs. Les fixtures incluent désormais toutes les
   tolérances réelles et rejettent NaN et les exposants/mantisses invalides.
2. **Annulation QUEUED suivie d'un changement de tenant.** Sans flush explicite,
   l'autoflush ORM se faisait sous le contexte RLS suivant et provoquait
   StaleDataError, arrêtant le worker. Le test PostgreSQL échouait avant correction
   et réussit après ; la variante SQLite est explicitement ignorée. Un seul
   `session.flush()` est ajouté avant de passer au tenant suivant. Les politiques
   RLS et les privilèges ne sont pas modifiés. Commit séparé : `a20f129`.

Le premier incrément client, déjà validé et poussé, est `ffafa18`. Les données de
développement, les versions publiées et le fichier non suivi `tatus` sont conservés.
Les tests ajoutent des artefacts synthétiques ; ils ne suppriment pas l'historique.

## Résultats réellement exécutés localement

Windows/PowerShell ; Python 3.14.3, PostgreSQL 17, Node 24.13.0, npm 11.6.2 ;
dépendances du lockfile existant, FastAPI/Pydantic et outils inchangés.

| Contrôle | Résultat observé |
|---|---|
| pytest, SQLite et PostgreSQL réel | **337 passed, 8 skipped, 2 warnings**, 80,20 s |
| Ruff check | Réussi sur brain/tests/migrations/scripts |
| Ruff format --check | **50 fichiers** conformes au périmètre CI |
| mypy strict | Réussi sur **36 fichiers** |
| pip check | Aucune dépendance incohérente |
| npm ci propre | **290 packages** installés, 10 s |
| TypeScript strict / build / lint | Réussis, sans erreur ESLint |
| Contrats | Génération OpenAPI testée par pytest ; régénération TS sans diff sémantique et `openapi-typescript --check` réussi |
| Vitest | **89 passed**, 7 fichiers, 7,51 s après npm ci ; 37 tests antérieurs conservés |
| Playwright, bundle final + API/PostgreSQL/workers réels | **27 passed**, 1,3 min ; 13 parcours antérieurs conservés |
| Dernier ajustement du test de course RUNNING/succès | **1 passed**, 8,2 s ; aucune modification de code produit |

Les **huit skips** sont exclusivement les variantes SQLite des tests de worker,
concurrence de file et RLS exigeant PostgreSQL. Les variantes PostgreSQL sont
exécutées ; aucun skip n'est annoncé comme un test réussi. Les warnings Python
proviennent d'anyio/pytest et de Starlette/httpx. Le build conserve les warnings
Vite connus : chunk initial **513,65 kB** (142,10 kB gzip) et directive externe
`use no memo`. Le centre d'exécution est chargé séparément (**12,44 kB**).

La génération de types a été rejouée sous Windows pour normaliser les fins de
ligne de la copie de travail avant `--check` ; `git diff` confirme l'absence de
changement sémantique de generated.d.ts ou du contrat OpenAPI.

## Couverture des parcours et portée des preuves

- Usine : lancement depuis le Studio, worker réel, SUCCEEDED, **4100 EUR** et
  vérification indépendante réussie ; lien du run immuable et reprise après F5
  et authentification nouvelle. Changement vers l'université sans conserver le
  job, les décisions ou l'objectif de l'usine à l'écran.
- Université : même pipeline générique, score synthétique **17**, plan vérifié
  et reprise depuis l'historique. Aucun résultat métier réel n'est inventé.
- Annulation en file : QUEUED et demande confirmée par API, puis démarrage du
  worker et passage réel à CANCELLED, sans run.
- Annulation RUNNING : modèle MILP synthétique publié, demande puis CANCELLED,
  ou conservation d'une réussite serveur concurrente. Le test ne transforme
  jamais SUCCEEDED en annulation et ne confond pas une demande avec l'arrêt.
- Échec technique : plafond de processus court, FAILED/EXECUTION_TIMEOUT, statut
  mathématique indisponible et absence de run.
- INFEASIBLE : nouvelle version synthétique avec une contrainte obligatoire
  contradictoire, publiée explicitement via API ; run conservé sans plan vérifié.
- TIME_LIMIT : MILP synthétique de 300 choix binaires sans dimension et 15
  capacités explicites, budget solveur très court ; SUCCEEDED technique avec
  TIME_LIMIT_NO_SOLUTION mathématique, sans objectif ni plan fabriqué. Ce test
  n'est pas un benchmark ni une garantie de comportement temporel universel.
- Réponse POST perdue : `route.fetch` effectue réellement la création, puis
  seule la réponse navigateur est coupée ; la répétition conserve clé et job_id
  côté PostgreSQL et ne crée pas de deuxième job. Lancement BUILDER testé.
- RBAC : VIEWER en lecture, absence de lancement/annulation ; refus serveur et
  isolation couverts également par la suite Python conservée.
- Les fautes réseau HTTP 401/403/404/409/422 sont injectées dans les parcours
  navigateur pour vérifier messages, nettoyage de session, absence de fuite et de
  retry automatique. Ce sont des tests de présentation d'erreur, distincts des
  tests d'autorisation réelle du backend.
- Vitest complète : TIME_LIMIT avec **et** sans plan vérifié, statuts inconnus,
  solution refusée, borne/gaps null, modèle du run incompatible, double clic
  immédiat, réponse de mutation après destruction, transport ignorant abort,
  401 tardif d'une ancienne session, polling borné/séquentiel et onglet masqué.
- Layout : desktop et mobile 390 × 844, absence de débordement horizontal.
  Captures inspectées sur le bundle compilé ; les parcours complets écrivent les
  PNG dans `frontend/test-results/screenshots`, ignoré par Git et exporté en CI.

La base `optimizer_brain_test` est la seule réinitialisée par pytest. Les parcours
du Studio utilisent des données de démonstration synthétiques et des workers
éphémères runtime sans identifiants de migration. Jetons jamais persistés côté
navigateur, traces/vidéos de connexion désactivées, aucune capture de mot de passe.

## Limites et prochaine action

Le polling ne fournit ni progression chiffrée ni reprise autonome après 300
lectures. La liste est paginée et rafraîchie à la demande. Le jeton et la demande
incertaine sont perdus lors d'un rechargement ; consulter les jobs après relogin
avant un nouveau lancement. La concurrence reste bornée par worker, pas globalement
entre réplicas ; les limites Linux sont par processus, comme documenté en ADR 0006.

Ces validations locales ne remplacent pas la CI du commit livré. Vérifier ses
trois jobs Linux/Windows/PostgreSQL après le push avant intégration dans main.
La prochaine action fonctionnelle reste la revue du frontend 4C ; aucun travail
de Phase 5 n'est engagé par cette livraison.
