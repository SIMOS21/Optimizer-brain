# AGENTS.md — Instructions permanentes pour Codex

## Source de vérité

Lire `OPTIMIZATION_BRAIN_SPEC.md` avant de concevoir ou modifier une fonctionnalité majeure. C'est le cahier des charges cible ; **ne pas supposer que les fonctionnalités décrites sont implémentées**.

## Mission

Construire progressivement une plateforme universelle d'optimisation décisionnelle multi-départements, fondée sur des modèles mathématiques et des solveurs, pas sur la génération d'une réponse par un LLM.

## Principes non négociables

1. Le **Brain** (DSL, IR, compilateur, solveurs, vérification, diagnostics) doit fonctionner sans LLM ni connexion réseau externe.
2. Le LLM est optionnel et ne propose que des brouillons de paramètres/contraintes et des reformulations ; il ne peut pas certifier un optimum, modifier une règle approuvée ou déclencher une action métier.
3. Ne jamais déclarer une solution `OPTIMAL` si le solveur ne fournit pas le niveau de preuve correspondant ; exposer tolérances, bornes et gap lorsqu'ils existent.
4. Vérifier indépendamment toute solution avant de la présenter comme réalisable. Un solveur qui rend un statut favorable ne remplace pas le vérificateur.
5. Rejeter contraintes ambiguës, unités incompatibles, coefficients invalides, références inconnues et champs non attendus.
6. Les contraintes obligatoires ne peuvent pas être assouplies sans politique et approbation explicites.
7. Le cœur reste **agnostique au secteur**. Les spécialisations passent par des templates/compilateurs de domaine, pas par des `if industry == ...` dispersés dans le solveur.
8. Chaque modèle/run est versionné ; les valeurs utilisées proviennent d'un snapshot identifié ; ne pas inventer de données réelles.
9. Aucun `eval`, `exec`, shell, SQL libre ou désérialisation dangereuse de contenu utilisateur/LLM.
10. Pas d'opérations réelles sans gouvernance et validation humaine ; contrôle d'accès sur toutes les ressources.

## Règles de développement

- Commencer par auditer le dépôt : la base contient le package Python `brain/`, `examples/`, `tests/` et une API FastAPI ; ne pas réécrire le MVP d'emblée.
- Préserver les routes et exemples existants jusqu'à migration délibérée ; maintenir les tests historiques.
- Livrer **une phase de la roadmap à la fois**, en privilégiant la plus petite tranche end-to-end testable.
- Avant les changements significatifs : écrire un plan concis, les fichiers ciblés et les tests attendus.
- Écrire du code typé, modulaire, lisible ; séparer modèles métier, compilation, backend solveur et validation.
- Ajouter les tests lors de chaque fonctionnalité, incluant erreur/infeasible/timeout quand pertinent.
- Exécuter les tests et communiquer leurs résultats réels ; ne pas affirmer une réussite non testée.
- Mettre à jour documentation, commandes de lancement et statut implémenté/non implémenté.
- Ne jamais multiplier les dépendances/services sans gain concret prouvé.
- Noter les choix majeurs dans `docs/decision-records/` lorsque ce dossier existe.

## Environnement de référence

- Python 3.11+, VS Code et PowerShell Windows ; CI Linux en complément.
- MVP existant : `python -m brain.demo`, `python -m pytest -q`, `python -m uvicorn brain.api:app --reload`.
- Version finale cible : backend FastAPI / Pydantic, core Python, HiGHS puis OR-Tools, PostgreSQL, frontend React + TypeScript, worker asynchrone. Construire progressivement.

## Workflow demandé à chaque tâche

1. Lire la phase demandée et vérifier que les prérequis sont présents.
2. Examiner le code existant et expliquer les écarts.
3. Planifier une petite implémentation cohérente.
4. Écrire code + tests + documentation.
5. Exécuter les tests et signaler les limites réellement observées.
6. Terminer par : **livré**, **tests**, **limites**, **prochaine action**.

## Phase à réaliser en premier

- **Phase 0 (audit/conservation du MVP), puis Phase 1 (Universal Model Kernel).**
- Construire des schémas stricts pour variables/paramètres/contraintes/objectifs, une IR typée, un validateur d'unités et des tests goldens.
- Golden instance : quantités `A=40`, `B=15`, objectif `4100 EUR`, contraintes `2A+B<=100`, `100A+200B<=8000`, `A+B<=55`, `0<=A<=40`, `0<=B<=35`, entiers, objectif `max 80A+60B`.
- Ne pas créer l'interface complète, les connecteurs, la couche LLM ou les optimisations avancées avant que les fondations soient validées.
