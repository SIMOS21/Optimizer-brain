# OPTIMIZATION BRAIN — Phase 3 : Multi-department Model Builder

> **Statut** : brief de développement pour Codex — spécification de travail, pas une fonctionnalité livrée.  
> **Source de vérité** : `AGENTS.md`, `OPTIMIZATION_BRAIN_SPEC.md` (§4, §7–9, §17 et §18 / Phase 3), le code actuel du dépôt et les ADR existantes.  
> **Objectif** : transformer plusieurs descriptions de départements, reliées par des ressources et décisions communes, en **un seul modèle d'optimisation MILP** validé, résolu et vérifié via le pipeline existant, sans ajouter de logique propre à chaque entreprise dans le kernel.

## 0. Préconditions et audit obligatoires

1. Lire intégralement les deux documents de référence et auditer la branche locale (elle peut être plus récente que `origin/main`).
2. Vérifier que la Phase 2 est présente **dans le code local** : `SolverAdapter`, backend HiGHS, orchestrateur, `SolutionVerifier`, routes et CLI. Si elle manque, ne pas annoncer que la Phase 3 est prête ; signaler le blocage.
3. Exécuter et consigner la baseline réelle : `python -m pytest -q`, `python -m ruff check brain tests`, `python -m mypy`, une résolution CLI du golden, et `git status`.
4. Comparer avec le contrat existant : DSL `schema_version=1.0`, `departments`, variables indexées, paramètres référencés, unités contrôlées, **un seul objectif**, contraintes **HARD** uniquement, IR canonique immuable, modèle et manifeste hashés, vérificateur indépendant. Ne pas casser ces garanties.
5. Présenter un plan d'implémentation avec fichiers ciblés, invariants, risques et critères de tests avant de coder.

## 1. Architecture à réaliser

```text
OrganizationGraph (structure et relations)
          +
DepartmentFragment(s) (déclarations locales de règles)
          +
Shared Resource / Variable Registry (identités et unités communes)
          |
          v
Graph & Composition Validator (références, ownership, provenance, conflit)
          |
          v
Deterministic Composition Compiler
          |
          v
Existing canonical ModelDSL v1 -> OptimizationIR
          |
          v
Existing Solver Orchestrator -> HiGHS
          |
          v
Existing Independent Verification
          |
          v
Global decision + per-department trace + resource utilization
```

Séparer **graphe d'organisation**, **fragments d'équations** et **IR mathématique**. Les arêtes visuelles ne doivent jamais générer implicitement des contraintes : seul un objet de liaison explicitement typé et validé a un effet mathématique. Ne pas permettre d'exécuter du texte ou du code comme règle.

### 1.1 OrganizationGraph — représentation universelle et versionnée

Créer des schémas stricts (noms exacts à ajuster à la convention du code existant) :
- `Organization` : `id`, `name`, `version`, provenance/snapshot.
- `DepartmentNode` : identifiant stable, nom d'affichage, identifiant de propriétaire descriptif (aucune autorisation authentifiée à cette phase), métadonnées de source.
- `ResourceNode` : identifiant stable, unité, capacité/référence de paramètre, département propriétaire ou ressource partagée, provenance validée.
- `ActivityNode` **facultatif** : activité dénommée, consommatrice/productrice ; ne pas imposer de processus métier arbitraire.
- `DependencyEdge` : `id`, `source_id`, `target_id`, type explicite et sens; valider les extrémités et les types. Une relation graphique informative n'implique pas automatiquement une équation.

Le modèle doit accepter une usine, un hôpital ou une université avec la **même grammaire** ; les valeurs et exemples restent synthétiques.

### 1.2 DepartmentFragment — modules métier composables

Un fragment est la déclaration de **l'un des départements**, non un problème optimisé indépendamment :
- un identifiant stable du département, une version et une provenance ;
- des paramètres locaux approuvés et/ou des références à des paramètres partagés approuvés ;
- les variables **déclarées** par un propriétaire et les variables **référencées** par d'autres ;
- des contraintes HARD possédant un propriétaire (`owner_department`) ;
- les contributions à un objectif global **seulement si elles sont compatibles avec le contrat mono-objectif existant** ; sinon fournir un objectif global unique défini séparément et rejeter des demandes contradictoires.

Interdire les dédoublements silencieux : identifiants de variables/ressources/paramètres uniques dans leur espace de nom ; collisions à contenu différent refusées ; deux fragments peuvent référencer **la même variable** mais ne peuvent pas la redéfinir indépendamment. Les appartenances doivent être explicites, jamais déduites d'un même nom d'affichage.

### 1.3 Composition et validation

Implémenter un `compose_organization_model(...)` déterministe :
1. Vérifier schémas et version des entrées, statut déclaré d'approbation, références et identités.
2. Résoudre ressources, paramètres et variables partagés par identifiants canoniques ; détecter les collisions, unités incompatibles et propriétaires inconnus.
3. Compiler **toutes** les contraintes locales et transversales dans **un unique `ModelDSL`**, puis dans l'IR existante. Aucune résolution séparée département par département ne doit remplacer ce modèle global.
4. Garantir ordre canonique, sérialisation stable, traçabilité `fragment -> constraint -> IR`, `resource -> parameter -> constraint` et deux hashes distincts : mathématique (si les équations changent) / manifeste d'audit (si seules les métadonnées changent).
5. Émettre des erreurs localisées (département, fragment, ressource, contrainte, champ) sans supprimer de contraintes, réconcilier de contradictions silencieusement ni convertir une règle HARD en SOFT.
6. Préserver `Decimal`/`Fraction` au niveau du kernel. La conversion numérique reste uniquement dans l'adaptateur solveur de Phase 2.

**Important :** le graphe lui-même ne peut pas déduire toutes les équations d'un métier. Une relation n'est calculable que si sa sémantique et son mapping vers la DSL sont formellement définis.

### 1.4 Traçabilité et visualisation initiale

Produire un rapport **sans frontend lourd** :
- noeuds et arêtes du graphe, labels, types et relations ; exporter JSON et, si utile, Mermaid/DOT sûr pour affichage dans la documentation ;
- ressources : capacité validée, consommation selon le plan vérifié, marge / slack, unité, propriétaires et contraintes associées ;
- vue par département : contraintes, décisions pertinentes, provenance et éventuels conflits ;
- pour chaque contrainte : statut satisfaite / violée / saturée dans les tolérances déclarées. **Ne pas inventer de diagnostic causal ou de prix d'ombre** ; afficher seulement les mesures démontrées.
- si solveur `INFEASIBLE`, aucun faux plan ; les diagnostics de conflit avancés / IIS restent à la Phase 5.

### 1.5 Versions et conservation locale

Mettre en place la **plus petite persistance locale fiable** autorisée par le cahier des charges (répertoire de snapshots JSON canoniques / manifeste de checksums ou SQLite si justifié) :
- snapshots du graphe, fragments, DSL composée, métadonnées de compilation, références de solve et rapports de vérification ;
- immutabilité par identifiant/version ou hash ; refus d'écraser une version publiée, historique reproductible ;
- chemins normalisés et validation sûre, écritures atomiques pour éviter les fichiers partiels ;
- pas de secrets, pas de données privées dans les exemples ; pas de prétention à une isolation multi-tenant ni à de vraies signatures d'approbation.

Ne pas introduire PostgreSQL, RBAC complet, React ou workers asynchrones : ils appartiennent à la Phase 4. Ne pas modifier les routes de Phase 2 sans nécessité de compatibilité documentée.

## 2. Démonstration exigée : Ventes / Production / Finance / Logistique

Construire un jeu de fragments indépendants et **un graphe partagé** qui reconstruisent `examples/demo_cross_department.json` sur le périmètre compatible de la DSL actuelle :
- Ventes : variables `qty_A`, `qty_B` et bornes de demande ;
- Production : contrainte machine utilisant ces mêmes variables et capacité en heures ;
- Finance : contrainte budget et unité monétaire ;
- Logistique : contrainte livraison avec ressource partagée ;
- Objectif unique global : `MAX 80*qty_A + 60*qty_B` EUR ;
- données approuvées de démonstration, versionnées, explicitement fictives.

**Oracle golden obligatoire :** `qty_A=40`, `qty_B=15`, objectif `4100 EUR`, machine `95/100 h`, budget `7000/8000 EUR`, logistique `55/55 unités` (selon le modèle golden). Les ressources sont référencées par paramètres partagés, pas recopiées en valeurs divergentes.

Faire tourner le pipeline `graphe + fragments -> DSL -> IR -> HiGHS -> vérification indépendante`, comparer objectif et faisabilité avec la résolution directe du modèle DSL. Comparer ensuite avec le moteur legacy **uniquement sur des scénarios effectivement équivalents** ; documenter clairement les cas non équivalents et ne pas fabriquer de correspondances.

Second cas synthétique, **non industriel** : par exemple affectation de salles / cours et budget ou allocation d'équipes / sites, avec le même code de composition et le même solveur. Objectif : démontrer la réutilisation réelle du noyau, sans `if industry == ...`.

## 3. Tests d'acceptation obligatoires

1. Tous les tests historiques et Phase 2 passent sans changement de leurs attentes, notamment le golden.
2. L'ordre des fragments et des noeuds n'affecte pas la DSL mathématique canonique ni le `model_hash` lorsque leur contenu mathématique est identique.
3. Deux départements référençant explicitement `qty_A` partagent une **seule variable de décision** ; aucun duplicata.
4. Rejeter : identifiant absent, collision contradictoire, mauvaise unité, référence de ressource inconnue, département inexistant, edge mal typé, double propriété non autorisée, paramètre non approuvé, conflit de versions.
5. Contradiction HARD inter-départements -> `INFEASIBLE` avec provenance des règles ; aucune relaxation automatique ni fausse solution.
6. Snapshot identique -> graphe/DSL/IR/hash identiques ; modification numérique pertinente -> hash mathématique différent ; modification purement descriptive -> manifeste d'audit différent, math hash inchangé.
7. Rapports d'utilisation des ressources recalculés depuis le **plan vérifié** et les contraintes, sans arrondir une décision brute.
8. Cas industriel et cas hors industrie composés et résolus avec le même kernel ; petits problèmes vérifiés aussi par énumération exhaustive lorsque possible.
9. Aucune dépendance LLM ni réseau requise pour modéliser, compiler, résoudre et vérifier.
10. CLI et API legacy conservées. Tous les tests lint/typecheck restent satisfaits.

## 4. Workflow de livraison pour Codex

1. Présenter un plan succinct et les compromis de schéma ; réutiliser les classes existantes au maximum.
2. Implémenter de manière incrémentale : contrats -> validations -> composition -> rapports -> persistence minimale -> exemples -> tests.
3. Exécuter :

```powershell
$env:TEMP = "$env:LOCALAPPDATA\OptimizerBrain\temp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
.\.venv\Scripts\python.exe -m pytest -q --basetemp="$env:TEMP\pytest-phase3" -p no:cacheprovider
.\.venv\Scripts\python.exe -m ruff check brain tests
.\.venv\Scripts\python.exe -m mypy
```

Sur Windows, si la baseline CI se fait en Python 3.11 via un environnement distinct, utiliser l'interpréteur de cet environnement plutôt que supposer que `.venv` est en 3.11. Ne pas changer les tolérances du solveur pour masquer une régression.

4. Ajouter ADR phase 3 et documents `docs/organization-graph.md`, `docs/model-composition.md`, mettre à jour `docs/roadmap.md`, `README.md` et les exemples. N'annoncer que les tests réellement exécutés.
5. Terminer le rapport sous quatre rubriques : **Livré / Tests / Limites / Prochaine action**. Ne pas coder les Phases 4–8.

## 5. Ce qui n'est pas demandé dans cette phase

- Interface React de production, drag-and-drop, RBAC, isolation multi-tenant, PostgreSQL et jobs asynchrones (Phase 4).
- Diagnostic IIS, négociation/relaxation de contraintes, analyses de sensibilité et comparaisons scénarios avancées (Phase 5).
- Objectifs multiples, CP-SAT et non-linéarité (Phase 6 et au-delà).
- LLM, génération automatique de contraintes par langage naturel (Phase 7).
- Promesses de performance, exactitude symbolique rationnelle de l'optimalité ou garantie de gains réels non démontrés.

## 6. Instructions finales prêtes pour Codex

**Mission :** implémente exactement la Phase 3 de `OPTIMIZATION_BRAIN_SPEC.md` en respectant ce brief. Commence par auditer le code local et vérifier les prérequis. Priorité absolue : obtenir la première composition **multi-départements vers un seul modèle global**, démontrer l'optimum golden avec vérification indépendante, et apporter un second cas d'usage non industriel. Ne remplace pas le kernel ni le backend HiGHS existants, n'introduis pas de frontend de Phase 4, ne confonds pas graphe visuel et équations exécutables. Préserve les tests. N'affirme pas une preuve rationnelle exacte à partir de HiGHS flottant.
