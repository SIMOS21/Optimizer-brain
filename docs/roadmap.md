# État implémenté

| Phase | État et preuve locale |
|---|---|
| 0 — Audit/conservation | Livrée : audit, démonstrateur historique, 14 tests conservés, outils de qualité configurés |
| 1 — Universal Model Kernel | Livrée : schémas, unités, références, indices explicites, IR, interpréteur, CLI, exemples et golden exhaustif |
| 2 — Generic Solver & Verification Engine | Livrée : adaptateur HiGHS sparse, orchestrateur, vérification indépendante, résultats traçables, CLI et routes locales ; voir validation-phase-2.md |
| 3 — Multi-department Model Builder | Livrée : graphe typé, fragments, partage explicite, composition globale, rapports mesurés, snapshots SQLite locaux ; deux secteurs synthétiques validés |
| 4A — Persistence, Identity & Governance Foundations | Livrée : PostgreSQL/Alembic, identités, sessions révocables, RBAC, RLS, publications et historiques immuables, API v1 distincte ; voir validation-phase-4a.md |
| 4B — Visual Organization Studio | Livrée : React/TypeScript, canvas fidèle aux snapshots, import/édition versionnée, publication, inspecteurs et historique ; parcours API réelle usine/université validés, voir validation-phase-4b.md |
| 4C et 5 à 8 | Non implémentées ; jobs web, workers et phases suivantes hors périmètre |

La phase 2 livre IR → matrices → résultat brut → vérification indépendante →
résultat traçable, avec maintien des routes legacy. Les contraintes numériques et
la portée des attestations sont définies dans l'ADR 0002 et solver-contract.md.
La phase 3 conserve ce pipeline : aucun changement dans le kernel, l'adaptateur
HiGHS ou le vérificateur. Son état observé est décrit dans validation-phase-3.md ;
ses choix et limites dans l'ADR 0003. Les snapshots locaux ne constituent pas une
isolation multi-tenant ni une approbation authentifiée.
La phase 4A ajoute une application sécurisée indépendante et ne modifie pas ces
interfaces locales. Ses contrats et limites figurent dans platform-phase-4a.md et
l'ADR 0004. Le booléen approved des sources n'est pas une publication authentifiée.
La phase 4B conserve cette gouvernance : aucun endpoint de calcul ajouté, aucun
changement du Brain. Le Studio consomme les documents réellement persistés et ne
présente aucun objectif sans run enregistré. Le guide studio-phase-4b.md décrit
ses commandes, les contrats typés et ses limites de navigateur.
Prochaine action : revue du Studio 4B et des contrats de jobs avant de cadrer 4C.

Les contrôles Linux/Windows Python 3.11 sont configurés dans le workflow CI,
mais ne sont pas réputés exécutés avant une exécution réelle du workflow.
