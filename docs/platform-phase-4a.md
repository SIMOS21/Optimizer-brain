# Phase 4A — Déploiement local et contrats API

Voir [l'audit](audit-phase-4a.md), [l'ADR 0004](decision-records/0004-persistence-identity-governance.md)
et [la validation](validation-phase-4a.md). Pré-requis : Python 3.11+, Docker Compose,
port local 55432 libre. Les exemples et comptes de test sont synthétiques.

## Installation et migrations

```powershell
python -m pip install -r requirements-dev.txt
New-Item -ItemType Directory -Force .local | Out-Null
Copy-Item infra/phase4a.env.example .local/phase4a.env
```

Remplacer les deux mots de passe par des secrets aléatoires indépendants et reporter
leurs formes URL-encodées dans les deux URL de ce fichier. `.local/` est ignoré par
Git. Le fichier n'est pas un script : charger les variables sans exécuter son contenu :

```powershell
Get-Content .local/phase4a.env | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
    $pair = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
}
docker compose --env-file .local/phase4a.env -f infra/compose.phase4a.yml up -d --wait
python -m alembic upgrade head
python -m alembic current
python -m brain.platform create-user --username admin --display-name Administrateur
Remove-Item Env:BRAIN_MIGRATION_DATABASE_URL, Env:BRAIN_MIGRATOR_PASSWORD, Env:BRAIN_APP_PASSWORD
python -m uvicorn brain.platform.api:create_app --factory --host 127.0.0.1 --port 8001
```

La CLI demande le mot de passe deux fois via getpass. Créer les autres comptes de
la même façon et utiliser les UUID affichés pour les appartenances. Pour révoquer
un compte : `python -m brain.platform disable-user --username nom` ; transférer
l'administration s'il est le dernier administrateur actif.

Le conteneur utilise un volume persistant. Le script d'initialisation crée le rôle
`brain_app` uniquement au premier démarrage d'un volume neuf. Modifier les variables
ne change pas les mots de passe d'un volume existant ; utiliser une rotation SQL
administrée. Ne pas supprimer le volume pour appliquer une migration. Docker lie
PostgreSQL à 127.0.0.1. L'API utilise uniquement BRAIN_DATABASE_URL/brain_app ;
Alembic et la CLI locale utilisent BRAIN_MIGRATION_DATABASE_URL/brain_migrator.
Le processus API ne doit recevoir que ses identifiants runtime ; le bloc ci-dessus
retire les variables administrateur avant de le lancer. Pour administrer ou tester,
recharger le fichier privé dans un autre terminal réservé à ces opérations.
Sur un serveur PostgreSQL existant, un DBA doit créer ces rôles séparés et donner
au migrateur la propriété de la base et du schéma ; les migrations attribuent les
droits au rôle nommé `brain_app` s'il existe.

Les migrations sont explicites : 0001_4a crée entités, références, triggers et RLS ;
0002_4a réduit les privilèges runtime ; 0003_4a permet le verrouillage des organisations
avec UPDATE(id) uniquement. Elles n'importent pas SnapshotStore et ne
modifient pas les fichiers locaux existants. Effectuer une sauvegarde et tester
sa restauration avant toute migration d'une base contenant des données importantes.
`alembic downgrade base` détruit le schéma et son historique ; ce n'est pas une
commande d'exploitation. Les tests de downgrade ciblent seulement une base jetable.
Les downgrades de 0002/0003 ne rétablissent volontairement pas des privilèges plus larges.
Pour préparer une évolution : `python -m alembic revision --autogenerate -m description`,
puis relire le fichier avant de l'appliquer. L'autogénération compare les tables et
ne gère pas automatiquement les triggers, les politiques RLS ou les privilèges :
les écrire et les tester explicitement. Les migrations déjà déployées restent figées.

L'ancien MVP reste lancé séparément par `python -m uvicorn brain.api:app --reload`.
Il ne fournit aucune authentification et reste une démonstration locale. Ne pas
monter cet objet ASGI dans l'application sécurisée ni l'exposer comme API multi-tenant.

## API v1

OpenAPI : `http://127.0.0.1:8001/openapi.json` ; Swagger : `/docs`.
`/health` est public. Tous les endpoints ci-dessous sauf login exigent
`Authorization: Bearer <access_token>`. Aucun secret ne doit figurer dans une URL.

| Méthode et chemin sous /api/v1 | Contrat et permission |
|---|---|
| POST /auth/login | username/password → jeton bearer et expires_at |
| POST /auth/logout | Révocation de la session, 204 |
| GET /auth/me | Identité du compte courant, aucun hash/mot de passe |
| POST, GET /organizations | Créer une organisation / lister ses appartenances actives |
| GET /organizations/{org} | Métadonnées et rôle du membre courant |
| PUT /organizations/{org}/memberships | ADMIN ; user_id, role, active ; upsert explicite |
| GET /organizations/{org}/memberships | Membres de cette organisation seulement |
| POST, GET /organizations/{org}/departments | Écriture ADMIN ; key/name/owner_user_id optionnel |
| POST, GET /organizations/{org}/graphs | Création ADMIN/BUILDER ; graph + shared_parameters |
| GET /organizations/{org}/graphs/{id} | Snapshot complet avec empreinte |
| POST /organizations/{org}/graphs/{id}/publish | ADMIN/APPROVER ; sans corps |
| POST, GET /organizations/{org}/model-versions | Création ADMIN/BUILDER ; graph_snapshot_id + model Phase 3 |
| GET /organizations/{org}/model-versions/{id} | Source, DSL, IR et traçabilité conservées |
| POST /organizations/{org}/model-versions/{id}/publish | ADMIN/APPROVER ; sans corps |
| GET /organizations/{org}/optimization-runs[/{id}] | Historique uniquement ; pas de POST de résolution |
| GET /organizations/{org}/audit-events | ADMIN/APPROVER ; audit paginé |

`org` est l'UUID SQL, pas le nom métier du graphe. Créer l'organisation avec la
clé `synthetic_factory` pour importer le graphe d'usine fourni. Enregistrer d'abord
les départements avec les clés du graphe ; leurs propriétaires doivent appartenir
à cette organisation. Le graphe se publie avant le modèle. Le modèle doit reprendre
exactement son graphe publié et les mêmes paramètres partagés. Les références de
provenance `owner_id` du graphe n'accordent aucune permission utilisateur.

Tous les GET de collection acceptent `limit` (1..100, défaut 50) et `offset`
(>=0, défaut 0) et renvoient `{items, limit, offset}`, sans total ni curseur.
Les modèles de réponse typés sont exposés dans OpenAPI ; `document` est présent
sur les détails et créations d'artefacts. Champs inapplicables d'ArtifactResponse :
null. Pas d'endpoint PATCH/DELETE du contenu : soumettre une nouvelle version.
La répétition du même contenu/version ou d'une publication est idempotente ;
un contenu différent sous une même version est refusé en 409.

Les erreurs ont la forme FastAPI `{detail: ...}` : 401 identité/session invalide,
403 rôle insuffisant, 404 absent ou non autorisé dans ce tenant, 409 conflit de
version/publication/intégrité, 422 document invalide, 413 JSON >10 MiB. Les entrées
invalides ne sont pas recopiées dans la réponse d'erreur. L'API ne prend pas un
user_id/organization_id du corps comme identité d'appelant.

`service.record_run` est un hook interne transactionnel réservé à un pipeline de
confiance : il prend un SolveResult existant, recompose la source publiée et
revérifie le rapport. L'API ne lance pas de résolution ni de job dans cette sous-phase.
La CLI de Phase 3 et SnapshotStore restent disponibles sans PostgreSQL ni réseau.

## Tests PostgreSQL

```powershell
$env:BRAIN_TEST_DATABASE_URL = $env:BRAIN_DATABASE_URL -replace '/optimizer_brain$', '/optimizer_brain_test'
$env:BRAIN_TEST_MIGRATION_DATABASE_URL = $env:BRAIN_MIGRATION_DATABASE_URL -replace '/optimizer_brain$', '/optimizer_brain_test'
python -m pytest -q
python -m ruff check brain tests migrations
python -m ruff format --check brain/kernel brain/solvers brain/organization brain/platform migrations tests/test_kernel.py tests/test_generic_solver.py tests/test_organization.py tests/test_platform.py tests/conftest_platform.py
python -m mypy
```

Les tests PostgreSQL exigent la base nommée exactement **optimizer_brain_test** et
refusent tout autre nom. Ils la créent si nécessaire puis réinitialisent son contenu,
y compris un cycle upgrade/downgrade/upgrade. Ne jamais y stocker de données à garder.
Ils ne se lancent pas en parallèle avec un autre processus utilisant cette même base.
Sans les deux variables de test, les cas PostgreSQL sont signalés skipped et les
contrats SQLite restent exécutables. La CI ajoute PostgreSQL 17 sur Linux ; les
régressions générales restent configurées sur Windows et Linux Python 3.11.

## Avant exposition externe

Ce livrable est une fondation locale. Configurer HTTPS, secrets protégés, sauvegardes,
rotation, supervision, limites de taille avant buffering et limites réseau en amont.
Les sessions transitent dans l'en-tête, pas dans un cookie ; aucun stockage navigateur
ni configuration CORS large n'est choisi ici. La limite de 10 MiB de l'application
est vérifiée après lecture du corps et ne remplace pas celle d'un reverse proxy.
Ni MFA/SSO/récupération, ni frontend, ni jobs asynchrones ne sont fournis.
