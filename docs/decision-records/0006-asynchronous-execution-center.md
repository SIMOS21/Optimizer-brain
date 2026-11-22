# ADR 0006 — Exécution asynchrone et fencing des jobs

Date : 22 novembre 2026. Portée : première tranche backend de la Phase 4C.

## Décision

Utiliser une file PostgreSQL durable avec `FOR UPDATE SKIP LOCKED`, une table de
jobs distincte des `OptimizationRun`, un worker séparé de FastAPI et un processus
enfant terminable pour le solveur. Aucun broker supplémentaire n'est requis.

L'état technique du job n'est pas le statut mathématique du solveur. Les états
terminaux sont immuables. Le run et `SUCCEEDED` sont enregistrés atomiquement,
après la vérification indépendante déjà utilisée par `service.record_run`.

## Invariants

1. Une organisation, un créateur et une clé d'idempotence déterminent une seule
   requête ; réutiliser cette clé avec un autre paramétrage renvoie 409.
2. Chaque tentative est protégée par un identifiant aléatoire et un bail.
   Heartbeats et publications sont conditionnés par l'état et la tentative
   courants ; un résultat ancien ne peut pas être publié.
3. Le verrou d'organisation puis celui du job sérialisent l'annulation et la
   finalisation. Une annulation concurrente ne remplace jamais un succès déjà
   persisté.
4. Le parent ne marque pas `CANCELLED` avant d'avoir confirmé l'arrêt de tous les
   processus descendants. Linux utilise un groupe de processus et le signal de
   mort du parent ; Windows utilise un Job Object avec `KILL_ON_JOB_CLOSE`.
5. Une expiration de bail devient un échec explicite, sans retry concurrent
   automatique. Cela privilégie l'absence de publication obsolète à la relance
   opaque d'une exécution encore active.
6. La table de jobs est protégée par RLS, sans privilège runtime de suppression
   ou de troncature. Le child utilise seulement le rôle runtime et les routes
   exigent un membre actif du tenant.

## Revue de reprise — révocation pendant le calcul

Le compte du créateur est relu et verrouillé à la finalisation, après le verrou
d'organisation et avant celui du job. Une désactivation déjà validée en base
interdit la publication ; une désactivation concurrente est sérialisée par le
verrou de ligne utilisateur. La transaction initiale ne suffit pas : son objet
`User` détaché peut encore porter `active=True` après une révocation.

Le rôle et l'adhésion restent revérifiés sous le verrou d'organisation. Aucun
verrou SQL n'est conservé pendant le calcul. Les tests reproduisent une révocation
du compte ou de l'adhésion après résolution et avant publication, puis vérifient
l'absence de run. Voir [la revue backend](../review-phase-4c-backend.md).

## Conséquences / limites

La concurrence configurable s'applique par processus worker, pas globalement à
toutes les réplicas. Un job interrompu nécessite une nouvelle soumission avec une
nouvelle clé. Aucun pourcentage de progression n'est inventé ; l'interface
d'exécution est hors de cette tranche.
