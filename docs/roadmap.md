# État implémenté

| Phase | État et preuve locale |
|---|---|
| 0 — Audit/conservation | Livrée : audit, démonstrateur historique, 14 tests conservés, outils de qualité configurés |
| 1 — Universal Model Kernel | Livrée : schémas, unités, références, indices explicites, IR, interpréteur, CLI, exemples et golden exhaustif |
| 2 — Generic Solver & Verification Engine | Livrée : adaptateur HiGHS sparse, orchestrateur, vérification indépendante, résultats traçables, CLI et routes locales ; voir validation-phase-2.md |
| 3 — Multi-department Model Builder | Livrée : graphe typé, fragments, partage explicite, composition globale, rapports mesurés, snapshots SQLite locaux ; deux secteurs synthétiques validés |
| 4A — Persistence, Identity & Governance Foundations | Livrée : PostgreSQL/Alembic, identités, sessions révocables, RBAC, RLS, publications et historiques immuables, API v1 distincte ; voir validation-phase-4a.md |
| 4B — Visual Organization Studio | Livrée : React/TypeScript, canvas fidèle aux snapshots, import/édition versionnée, publication, inspecteurs et historique ; parcours API réelle usine/université validés, voir validation-phase-4b.md |
| 4C — Asynchronous Optimization Execution Center | Backend et frontend livrés : modèles publiés, lancement idempotent, suivi et annulation serveur, cockpit et historique immuables ; parcours réels usine/université, INFEASIBLE et TIME_LIMIT ; voir validation-phase-4c.md |
| 5A — Constraint Diagnostics | Livrée : preuves statiques exactes et incomplètes, mesures indépendantes, provenance, GET sécurisés et consultation Studio en lecture seule ; voir constraint-diagnostics-phase-5a.md |
| 5B — Scenario Lab | Tranches 1/2 : clones et changements numériques sous politiques publiées, accords, snapshots DRAFT et worker existant. Tranche 3 : comparaison en lecture seule de runs revérifiés, deltas rationnels, comparabilité explicite et amélioration de l’objectif limitée au même cadre ; gain économique non démontré. Voir controlled-scenarios-phase-5b2.md et scenario-comparison-phase-5b3.md. |
| UX V2 — UX-F1 | Shell responsive, navigation et catalogue paginé/recherchable, présentation métier/expert en mémoire, primitives accessibles et E2E PostgreSQL isolés ; voir validation-ux-f1.md. |
| UX V2 — UX-F2 | Dashboard métier connecté aux runs vérifiés, qualification mathématique stricte, distinction dernier run / dernier plan vérifié, chargement paresseux par route dans Workspace, skeletons et retry locaux ; voir validation-ux-f2.md. |
| UX V2 — UX-F3 | Carte interactive métier/expert depuis les snapshots autorisés, inspecteur, filtres, focus, reset par version/tenant, responsive et mesures 7/50/200 nœuds ; livré sur branche de revue, voir validation-ux-f3.md et ADR 0012. |
| UX V2 — UX-F4 | Optimization Center & Decision Cockpit : parcours guidé en 5 étapes, confirmation explicite avec paramètres figés, qualification mathématique indépendante, mode métier par défaut et expert unifié, E2E PostgreSQL isolés ; intégré dans main via PR #10, voir validation-ux-f4.md. |
| UX V2 — UX-F5 | Scenario Lab guidé en sept étapes, références sécurisées, politiques/accords/délégations explicites, SET textuel exact, preview serveur et répétition figée ; historique paginé avec qualification indépendante et jobs distincts, correction du KPI mobile ; intégré via PR #11, voir validation-ux-f5.md et ADR 0013. |
| 5B-3 — Verified Scenario Comparison | Moteur déterministe hors ligne, API GET sécurisée sans migration, Studio métier/expert et provenance, tests PostgreSQL et parcours réels usine/université ; livré sur branche de revue, voir validation-phase-5b3.md et ADR 0014. Aucun gain économique ni sensibilité automatique. |
| 7A — NVIDIA NIM Gateway | Première tranche : explications guidées, faits revérifiés, API sécurisée, consentement et autorisations d’export, quotas persistants, assistant Studio et fournisseur simulé CI. Inférence hébergée non testée sans clé ; voir validation-nvidia-nim-gateway.md et ADR 0015. |
| 5C, 6, reste de 7 et 8 | Non implémentés |

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
La tranche 4C ajoute des contrats API distincts pour les jobs et le statut du
solveur ; détails, configuration et limites figurent dans
execution-center-phase-4c.md et l'ADR 0006. L'interface React réutilise ces contrats
sans modifier le kernel, HiGHS ni la vérification ; voir frontend-execution-phase-4c.md
et l'ADR 0007 pour la confiance des résultats et les limites de reprise navigateur.

Les contrôles Linux/Windows Python 3.11 sont configurés dans le workflow CI,
mais ne sont pas réputés exécutés avant une exécution réelle du workflow.
