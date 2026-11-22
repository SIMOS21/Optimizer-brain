# État implémenté

| Phase | État et preuve locale |
|---|---|
| 0 — Audit/conservation | Livrée : audit, démonstrateur historique, 14 tests conservés, outils de qualité configurés |
| 1 — Universal Model Kernel | Livrée : schémas, unités, références, indices explicites, IR, interpréteur, CLI, exemples et golden exhaustif |
| 2 — Generic Solver & Verification Engine | Non implémentée : prochain jalon |
| 3 à 8 | Non implémentées ; périmètre cible dans la spécification |

Le prochain incrément est l'adaptateur HiGHS réutilisant le backend actuel :
IR → matrices → résultat brut → vérification indépendante → résultat traçable.
Il devra couvrir optimal, infaisable, limite de temps, modèle invalide et refus
du vérificateur ; les routes legacy resteront compatibles.

Les contrôles Linux/Windows Python 3.11 sont configurés dans le workflow CI,
mais ne sont pas réputés exécutés avant une exécution réelle du workflow.
