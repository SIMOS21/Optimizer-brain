# Validation Phase 4A — 22 novembre 2026

Périmètre : Persistence, Identity & Governance Foundations uniquement.
L'[audit préalable](audit-phase-4a.md) confirme la baseline des Phases 0 à 3.
Les choix et les limites sont consignés dans l'[ADR 0004](decision-records/0004-persistence-identity-governance.md).

## Résultats réellement obtenus

Windows/PowerShell, Python **3.14.3** du venv, PostgreSQL **17.12** réel dans Docker,
SQLAlchemy **2.0.58**, Alembic **1.20.1**, psycopg **3.3.9**, argon2-cffi **25.1.0**.
Les tests SQL utilisent un rôle runtime limité et un rôle de migration distinct.

| Contrôle exécuté | Résultat |
|---|---|
| Baseline avant changements | **263 passed, 2 warnings in 5.39s** |
| Suite complète, SQLite + PostgreSQL réels, après migration finale | **304 passed, 2 warnings in 51.41s**, aucun skip |
| Tests ajoutés | **41** : 18 contrats SQLite, 18 mêmes contrats PostgreSQL, 3 spécifiques PostgreSQL, 2 configuration/migrations |
| Ruff `check brain tests migrations` | **All checks passed** |
| Ruff format sur kernel/solvers/organization/platform, migrations et tests associés | **38 files already formatted** |
| mypy strict kernel/solvers/organization/platform | **Success: no issues found in 29 source files** |
| Migration de la base de développement | Upgrade vers **0003_4a**, démarrage avec brain_app réussi |
| Migrations de la base de test jetable | Upgrade / downgrade base / upgrade réussi ; aucune dérive ORM/migrations sur PostgreSQL et SQLite |
| Golden persisté et revérifié | **qty_A=40, qty_B=15, objectif=4100 EUR**, rapport has_verified_plan=true |
| Secrets locaux | `.local/phase4a.env` effectivement ignoré par Git |

Commandes : `python -m pytest -q`, `python -m ruff check brain tests migrations`,
`python -m ruff format --check ...`, `python -m mypy`, avec les deux variables
BRAIN_TEST_* configurées comme dans [le guide](platform-phase-4a.md).
Dans cette session, un lanceur local ignoré charge ces variables sans les afficher,
redirige TEMP/TMP vers `%LOCALAPPDATA%/OptimizerBrain/temp`, choisit un basetemp
neuf par exécution et utilise `-p no:cacheprovider`. Aucun nettoyage du projet.
Les cycles de destruction du schéma et TRUNCATE ne ciblent que **optimizer_brain_test**,
nom imposé par le harnais. La base de développement ne subit aucun downgrade.

## Couverture

- Identité obligatoire ; hash Argon2id, empreinte de session sans jeton brut en
  base, expiration, logout, désactivation et throttling des identifiants erronés.
  Réponses génériques et absence de recopie des secrets dans les erreurs.
- Permissions ADMIN/BUILDER/APPROVER/VIEWER ; refus d'auto-promotion, relecture
  des rôles et révocation d'appartenance applicable à une session déjà ouverte.
- 404 pour un tenant non autorisé et pour un identifiant étranger de graphe,
  modèle ou run ; listes limitées au tenant et propriétaire de département membre.
- RLS sans contexte → zéro artefact, refus d'une insertion sans contexte, remise
  à zéro du contexte transactionnel dans le pool, clé étrangère composite invalide,
  refus de TRUNCATE/écriture du numéro de migration et de démarrage en superuser.
- Publication explicite et idempotente, création de modèle liée au graphe publié,
  rejet d'un contenu différent sous la même version. Rejet direct par SQL des
  updates/deletes sur contenus DRAFT et PUBLISHED, résultats et audit.
- Deux publications concurrentes → un événement ; deux contenus concurrents de
  même version → un succès, un conflit et un seul événement ; deux administrateurs
  se rétrogradant simultanément → un seul succès, dernier administrateur conservé.
- Historique relisible après création d'un graphe suivant. Persistance d'un run
  réel HiGHS vérifié ; corruption volontaire des décisions rejetée avant stockage.
  Aucun endpoint public de dépôt de résultat ni de lancement de job.
- OpenAPI avec modèles de réponse, pagination bornée, champs supplémentaires et
  JSON ambigu/non fini refusés. Application sécurisée sans routes legacy anonymes.
- Les **263 tests antérieurs**, dont les **14 historiques**, restent présents et
  inchangés. Ils couvrent aussi les deux secteurs synthétiques et le Brain sans réseau/LLM.

## Limites observées et état de livraison

Deux avertissements externes préexistants persistent : dépréciations anyio/pytest
CallSpec2 et Starlette/httpx. Aucun échec Ruff ou mypy. La CI Python 3.11 Linux/Windows
et un job PostgreSQL 17 Linux sont configurés ; leur exécution distante n'est pas
présumée réussie par ce rapport local. Sans variables PostgreSQL, les 21 tests qui
en dépendent sont skipped, sans assimiler SQLite à une preuve d'isolation RLS.

Le script d'initialisation crée les rôles sur volume neuf. La rotation des secrets
et les sauvegardes/restaurations d'un déploiement existant restent administrées.
Les tests ne simulent ni coupure électrique, ni reprise après crash du serveur,
ni charge prolongée. Les verrous sérialisent les écritures d'une organisation.
L'audit est append-only pour les actions organisationnelles implémentées, pas une
preuve cryptographique contre un opérateur de base privilégié.

Fondation locale : HTTPS/proxy, limites réseau, exploitation et récupération de
compte sont à compléter avant exposition publique. Aucun MFA/SSO, frontend React,
worker, import automatique de SnapshotStore, approbation à quatre yeux imposée,
Phase 4B/4C ou Phase 5. Le kernel, le compositeur, HiGHS, le vérificateur et le
stockage SQLite de Phase 3 n'ont pas été modifiés. L'API mathématique legacy reste
une démonstration locale distincte. Les garanties numériques de l'ADR 0002 sont conservées.

Prochaine action : revue des contrats et du déploiement 4A avant de cadrer 4B.
