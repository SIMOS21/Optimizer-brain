# Composition multi-départements — phase 3

Le point d'entrée `compose_organization_model(...)` assemble **tous** les fragments
dans un seul ModelDSL, puis réutilise le compilateur canonique. `solve_organization`
appelle une fois l'orchestrateur existant et fournit les rapports mesurés.
Le kernel, HiGHS et le vérificateur n'ont pas été spécialisés pour les exemples.

## Source et fichiers indépendants

Un OrganizationModel embarqué contient model_id/name/version, scenario_id,
dimensions/currency facultatifs, graph, shared_parameters, fragments et un objectif
global unique. L'identifiant du snapshot vient de graph.organization.data_snapshot_id.
Un projet multi-fichiers remplace graph/fragments par graph_file/fragment_files ;
les autres champs restent identiques. Voir les deux projets livrés.

Les fichiers référencés sont JSON, relatifs au répertoire du projet ; chemins absolus,
remontées `..`, lecteurs/flux Windows, antislash et liens sortant du répertoire sont
refusés. Limite locale : 10 MiB par fichier. Le chargement rejette les clés dupliquées
et constantes non JSON et conserve les chiffres décimaux. Il ne charge aucune URL.

## Sémantique des liaisons et de l'objectif

Un ResourceUse appartient au fragment qui le déclare et contient un id, resource_id,
des termes linéaires et source/approved/version. Exemple de contribution :

```json
{
  "id": "machine_load",
  "resource_id": "production_resource",
  "source": "synthetic_demo",
  "approved": true,
  "version": "1",
  "terms": [{"variable": "qty_A", "coefficient": "2", "coefficient_unit": "hour/unit"}]
}
```

Pour chaque ressource utilisée, le compilateur concatène les contributions déclarées
et produit **une seule** contrainte HARD <=, dont le membre droit référence le
paramètre partagé de capacité. Le compilateur DSL existant agrège ensuite les termes
répétés et contrôle les dimensions. Les termes sont des contributions additionnelles,
éventuellement une charge nette signée ; le graphe ne peut pas deviner des erreurs
de double saisie de consommation. Le propriétaire de la ligne est celui de la ressource.

Les autres contraintes sont celles des fragments, avec un propriétaire identique
au département déclarant. Elles peuvent référencer plusieurs départements après
imports explicites. Tous les termes sont conservés ; un modèle contradictoire passe
au solveur sans relaxation. Les champs d'objectifs locaux sont refusés : l'auteur
déclare séparément exactement un objectif global, sans mélange de métriques ni
pondération implicite. Les limitations HARD/mono-objectif de la DSL sont conservées.

## Traçabilité et déterminisme

- `constraint_traces` : contrainte canonique, propriétaire, fragments/contributions,
  paramètres, ressource éventuelle et chemins sources localisés.
- `resource_traces` : ressource → paramètre de capacité → contrainte globale,
  plus les fragments et contributions qui l'alimentent.
- Les définitions et imports de variables restent dans la source embarquée et la DSL.
- Ordres des nœuds/fragments/imports/termes sans effet sur la composition canonique.
- `ir.model_hash` : contrat mathématique résolu existant.
- `model_manifest_hash` : manifeste DSL existant ; `composition_manifest_hash` :
  graphe, fragments, DSL, IR et traces complets. Les différences descriptives du graphe
  changent ce dernier même si le problème mathématique reste identique.

Une Composition conserve des JSON immuables et une IR gelée. `composition.source`
et `.model` renvoient des copies détachées, revalidées au chargement.

## Rapports sur témoins vérifiés

Le rapport refuse un résultat d'un autre manifeste, modèle, version, scénario ou
snapshot. Il revérifie les décisions binaires natives avec SolutionVerifier et compare
l'objectif recalculé. Aucune valeur entière proche n'est arrondie.

Chaque contrainte expose membre gauche, droit, marge signée, violation, unité,
tolérance et provenance. Sur un plan accepté, son état est SATISFIED, SATURATED
(écart/marge dans la tolérance) ou VIOLATED si hors tolérance ; un témoin violant
effectivement une règle est refusé avant publication des utilisations. Sans plan,
l'état est UNAVAILABLE. Les diagnostics d'un candidat rejeté restent disponibles
dans `solve.validation_report`, sans être présentés comme plan exploitable.

Les ressources exposent capacité, consommation nette, marge, unité, périmètre,
propriétaire et contrainte associée. Les nombres sont rationnels, exportés comme
chaînes exactes. Les vues par département incluent décisions possédées/importées,
contraintes locales ou partagées et provenance. Une saturation n'est ni un coût
marginal ni une cause démontrée. INFEASIBLE ne produit aucune consommation fictive ;
les règles sources restent consultables, sans IIS ou diagnostic causal de phase 5.

## Snapshots locaux et relecture

```powershell
python -m brain.organization solve examples/organizations/factory/project.json --store local_store/phase3 --output results/organization_factory.json --mermaid results/organization_factory.mmd
python -m brain.organization solve examples/organizations/university/project.json --store local_store/phase3 --output results/organization_university.json --mermaid results/organization_university.mmd
python -m brain.organization replay --store local_store/phase3 --organization synthetic_factory --model demo_cross_department --version 1.0.0 --output results/organization_factory_replay.json
```

Le stockage utilise `snapshots.sqlite3` dans le répertoire configuré ; aucune
identité métier n'est transformée en chemin. Il conserve les versions de graphe,
départements, ressources, fragments, paramètres et objectif, le snapshot de paramètres,
la composition complète et les références de run avec rapport et options.
Chaque enregistrement est checksummé ; une seule transaction publie l'ensemble.
La même publication est idempotente ; un contenu différent pour une identité/version
existante est refusé. L'échec d'une publication annule tous ses nouveaux composants.

Une modification numérique exige de nouvelles versions pour les objets modifiés,
un nouvel id de snapshot si ses paramètres changent et les versions attendues
correspondantes dans les imports/liaisons. Une nouvelle version de graphe implique
de mettre à jour les références et versions des fragments qui la ciblent. Rien n'est
incrémenté ou approuvé silencieusement. Les versions sont des labels opaques ; la
méthode `history` les trie lexicalement, pas par ordre chronologique sémantique.

`replay` contrôle checksums, source et artefacts dérivés sans résoudre ; il fonctionne
même si les fichiers d'origine ont disparu. En Python, `load_snapshot` fournit une
Composition dont `.model` peut être résolue par l'orchestrateur avec les réglages du
run enregistré (`load_run` donne cet artefact). Un nouveau calcul garde son propre
UUID/date ; on compare objectif et validité, sans supposer toujours le même vecteur.

Le stockage est local, sans signatures, autorisations authentifiées ou protection
contre un administrateur modifiant aussi les checksums. Pas de service de base de
données, PostgreSQL, interface React ou worker. Les bases locales sont ignorées par Git.
Codes CLI : 0 composition/replay réussi ou plan vérifié disponible ; 1 terminaison
mathématique/limite sans plan ; 2 entrée, lecture, stockage ou validation refusée.

## Deux organisations et comparaison legacy

Usine : golden 40/15, 4100 EUR, machine 95/100 h, budget 7000/8000 EUR,
logistique 55/55 unités. Le hash mathématique et la faisabilité sont comparés à
demo_cross_department.json. Le test legacy définit explicitement deux produits
sans stocks, sous-traitance, coût d'activation ou heures supplémentaires, revenus
180/260 et coûts 100/200 : contribution 80/60, mêmes capacités et demandes.
Cette réduction est équivalente ; le factory.json historique complet ne l'est pas.

Université : trois décisions binaires de cours, charges de salle 1/1/1, coûts 6/4/3,
capacités 2 créneaux et 9 EUR, objectif synthétique 10/8/7 points. Une règle de
Facilities impose au moins un cours. L'oracle sur les 8 combinaisons confirme le
choix mathématiques + sciences et le score 17, budget et salles saturés.
Ces exemples ne représentent aucune organisation réelle ni des gains démontrés.
