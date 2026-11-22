# État implémenté

| Phase | État et preuve locale |
|---|---|
| 0 — Audit/conservation | Livrée : audit, démonstrateur historique, 14 tests conservés, outils de qualité configurés |
| 1 — Universal Model Kernel | Livrée : schémas, unités, références, indices explicites, IR, interpréteur, CLI, exemples et golden exhaustif |
| 2 — Generic Solver & Verification Engine | Livrée : adaptateur HiGHS sparse, orchestrateur, vérification indépendante, résultats traçables, CLI et routes locales ; voir validation-phase-2.md |
| 3 — Multi-department Model Builder | Livrée : graphe typé, fragments, partage explicite, composition globale, rapports mesurés, snapshots SQLite locaux ; deux secteurs synthétiques validés |
| 4 à 8 | Non implémentées ; périmètre cible dans la spécification |

La phase 2 livre IR → matrices → résultat brut → vérification indépendante →
résultat traçable, avec maintien des routes legacy. Les contraintes numériques et
la portée des attestations sont définies dans l'ADR 0002 et solver-contract.md.
La phase 3 conserve ce pipeline : aucun changement dans le kernel, l'adaptateur
HiGHS ou le vérificateur. Son état observé est décrit dans validation-phase-3.md ;
ses choix et limites dans l'ADR 0003. Les snapshots locaux ne constituent pas une
isolation multi-tenant ni une approbation authentifiée.
Prochain incrément à cadrer : phase 4, sans la commencer dans cette livraison.

Les contrôles Linux/Windows Python 3.11 sont configurés dans le workflow CI,
mais ne sont pas réputés exécutés avant une exécution réelle du workflow.
