# ADR 0004 — Persistance, identité et gouvernance

Date : 22 novembre 2026. Statut : adopté pour la Phase 4A.

## Architecture et contrats

`brain/platform/` est un module applicatif au-dessus de `brain/organization/`.
SQLAlchemy 2 et psycopg accèdent à PostgreSQL 17 ; Alembic décrit explicitement
le schéma versionné. Aucune création automatique de tables au démarrage, aucune
migration implicite du stockage SQLite de Phase 3. SQLite est un backend de tests
des contrats, sans prétendre reproduire RLS ou les verrous PostgreSQL.

L'application `brain.platform.api:create_app` est distincte de `brain.api:app`.
Leurs chemins `/api/v1` existent dans des applications ASGI séparées : les anciens
endpoints anonymes ne sont pas un accès de contournement aux tables multi-tenant.
L'application legacy reste destinée à une démonstration locale indépendante.

Organization et User utilisent des UUID ; Membership porte rôle et activation.
Department appartient à une organisation, et son propriétaire optionnel doit être
un membre actif. Les identifiants de département du DSL sont les clés métier du
registre, distinctes des UUID SQL. Les `owner_id` descriptifs du graphe de Phase 3
restent des provenances, sans leur donner implicitement des permissions.

GraphSnapshot conserve graphe et paramètres partagés. ModelVersion référence un
graphe publié et conserve la composition complète : source, DSL, IR, traces,
hashes et identifiant du snapshot de données. OptimizationRun référence cette
version et conserve le résultat natif normalisé avec le rapport revérifié.
Les liens organisation/membre, modèle/graphe et run/modèle sont composites dans
la base ; un UUID d'une autre organisation ne suffit pas à créer une liaison.

Les contrats Pydantic stricts et les réponses paginées sont publiés dans OpenAPI.
Les UUID SQL sont des identités opaques ; `key` est une identité métier, `version`
une version déclarée et `content_hash` le SHA-256 du contenu canonique stocké.
Les timestamps sont des secondes Unix UTC. Les quantités rationnelles restent
dans leur représentation canonique existante ; aucun passage par JSONB/float
ne transforme silencieusement un coefficient. Le parseur HTTP conserve les
décimaux JSON via Decimal et refuse clés dupliquées, NaN et champs supplémentaires.
L'ADR 0002 reste la référence pour les conversions HiGHS et les tolérances.

## Identité et permissions

Les comptes sont provisionnés par une CLI locale privilégiée, sans inscription
publique ni mot de passe dans les arguments. Argon2id utilise 19 MiB, deux passes,
un fil ; mots de passe de 12 à 1024 caractères. Les sessions sont des jetons opaques
aléatoires de 256 bits, dont seul le SHA-256 est conservé, avec expiration à huit
heures par défaut et révocation au logout/désactivation. Aucun JWT contenant un
rôle périmé : l'état du compte et l'appartenance sont relus à chaque requête.
Les erreurs de connexion sont génériques ; cinq échecs bloquent le compte normalisé
pendant la fenêtre de quinze minutes, sous verrou SQL. Une empreinte factice couvre
le calcul Argon2 d'un utilisateur inconnu. Le throttling ne remplace pas une limite
par IP/périmètre et peut lui-même faire l'objet d'un déni de service par compte.

Tous les membres actifs lisent les artefacts de leur organisation. ADMIN gère
départements et appartenances ; ADMIN/BUILDER créent des versions ; ADMIN/APPROVER
publient et lisent l'audit. Le créateur d'une organisation devient ADMIN. Ni un
BUILDER ni un VIEWER ne peuvent publier ou s'octroyer un rôle. ADMIN peut publier
son propre travail : une politique de séparation à quatre yeux n'est pas livrée.
Les appartenances sont désactivées, pas effacées, afin de préserver les références
historiques. La CLI conserve elle aussi au moins un administrateur actif.

Chaque route d'organisation vérifie l'acteur et le tenant avant tout accès aux
artefacts ; un non-membre reçoit 404, un membre sans permission 403. RLS est forcé
sur departments, graph_snapshots, model_versions, optimization_runs et audit_events.
`set_config(..., true)` ne porte que sur la transaction, sans fuite dans le pool.
Les tables d'identité, d'organisation, d'appartenance et de session sont contrôlées
par les services applicatifs, pas par ces politiques RLS.

Le rôle `brain_app` n'est ni propriétaire des tables, ni superuser, ni BYPASSRLS.
Les migrations lui donnent seulement le DML nécessaire, sans TRUNCATE/DDL/écriture
du numéro de migration. UPDATE(id) sur organizations autorise SELECT FOR UPDATE ;
aucune route ne modifie cet identifiant. Le démarrage refuse superuser/BYPASSRLS,
TRUNCATE sur les graphes et une révision de migration différente de `0003_4a`.
Le rôle de migration est séparé. Ces protections visent les erreurs applicatives ;
le rôle SQL d'exécution est un composant de confiance et peut définir le contexte
RLS. Un opérateur de base privilégié peut désactiver les triggers ou les politiques.
Il ne s'agit pas d'une résistance cryptographique à cet opérateur.

Références : [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

## Publication, immutabilité et concurrence

Même les contenus DRAFT sont append-only : corriger implique une nouvelle version.
La seule transition autorisée est DRAFT → PUBLISHED avec acteur et date explicites.
Les triggers interdisent de changer le contenu ou de supprimer graphes et modèles,
et interdisent toute réécriture des runs et événements d'audit. Les contraintes
HARD ne sont jamais relâchées automatiquement. Le booléen `approved` d'une source
ne remplace pas la publication par un acteur authentifié.

Toutes les mutations d'une organisation verrouillent sa ligne avant relecture des
permissions. La sérialisation permet publication idempotente, refus atomique d'une
collision de version et maintien du dernier administrateur actif. C'est un choix
simple pour les fondations ; le débit d'écriture par organisation est limité par
ce verrou. Les tenants distincts ont des verrous distincts. Les historiques et
l'événement d'audit sont écrits dans la même transaction.

Le hook interne `record_run` recompose la source publiée et appelle `build_report`,
qui vérifie à nouveau les décisions sur l'IR originale. Le run natif et ses bornes,
gap, statuts et attestations restent ceux du pipeline existant. Aucun endpoint
public n'accepte un résultat prétendument optimal. Ni lancement de jobs, ni worker,
ni nouveau solveur ne sont introduits ici.

## Conséquences et limites

Déploiement initial local, PostgreSQL obligatoire pour l'API sécurisée. Une connexion
SQL est nécessaire à cette API ; le Brain mathématique et SnapshotStore continuent
de fonctionner hors ligne. TLS/proxy, secrets, sauvegardes/restauration, supervision
et limites réseau sont à configurer avant exposition externe. Aucun cookie ni CORS
permissif n'est ajouté. Le stockage du jeton dans un futur navigateur reste à
concevoir avec le frontend. MFA, SSO, reset de mot de passe, audit cryptographiquement
signé et politique de rétention ne sont pas livrés. Aucune Phase 4B, 4C ou 5.
