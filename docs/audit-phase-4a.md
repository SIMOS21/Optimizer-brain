# Audit préalable — Phase 4A

Date : 22 novembre 2026. Branche : `phase-4a-persistence-identity-governance`.

AGENTS.md, les 1128 lignes de OPTIMIZATION_BRAIN_SPEC.md, roadmap.md,
validation-phase-3.md et l'ADR 0003 ont été lus intégralement avant les changements.

Le dépôt partait de `53143d1` sur `main`, aligné avec `origin/main`. Aucun changement
suivi ; le fichier non suivi `tatus`, déjà présent, est conservé et exclu du commit.
Baseline réellement exécutée : **263 passed, 2 warnings in 5.39s**, Ruff sans erreur,
mypy sans erreur dans 21 fichiers. Le total annoncé par la Phase 3 est confirmé.

Le kernel possède des schémas fermés, une IR immuable et des unités rationnelles.
SolverAdapter/HiGHS traduisent l'IR en matrices creuses ; l'orchestrateur qualifie
les statuts et appelle le vérificateur indépendant. Le compositeur assemble les
fragments et produit source, DSL, IR, traces et hashes. SnapshotStore conserve
localement les historiques SQLite et les rapports sont revérifiés avant exposition.
Ces couches et leurs tests n'ont pas besoin d'être réécrits pour cette sous-phase.

Les écarts sont dans la couche applicative : aucune identité authentifiée,
aucune appartenance d'organisation, aucun rôle, aucun stockage PostgreSQL ni
migration. Les identifiants descriptifs des propriétaires du graphe ne constituent
pas des comptes utilisateurs. Les routes existantes sont des démonstrations locales
sans authentification et ne doivent pas être montées dans l'application sécurisée.

Plan retenu avant codage : ajouter `brain/platform/`, des migrations Alembic,
une configuration Docker locale et une API versionnée indépendante ; conserver
SnapshotStore et les points d'entrée legacy. Ajouter des tests de contrats SQLite
et PostgreSQL réel pour les permissions, la publication, les migrations,
l'intégrité et les courses concurrentes. Consigner les choix dans l'ADR 0004.

Risques identifiés : confiance dans les approbations déclaratives de la Phase 3,
liaisons entre tenants, oubli du filtre organisationnel, fuite de contexte dans
le pool SQL, écrasement d'une version, double publication et perte du dernier
administrateur. La publication authentifiée, les clés étrangères composites,
RLS transactionnel, les triggers et les verrous d'organisation traitent ces risques.
Les choix numériques et les limites de preuve de l'ADR 0002 restent inchangés.
