# ADR 0003 — Graphe, composition globale et snapshots locaux

Date : 22 novembre 2026. Statut : adopté pour la phase 3 uniquement.

## Décisions architecturales

1. **Une couche en amont du kernel existant.** `brain/organization/` transforme
   le graphe et les fragments en ModelDSL 1.0, puis appelle le compilateur et
   l'orchestrateur existants. Ni solveur ni kernel ne connaissent un secteur.
   Aucun changement de tolérance ou reformulation métier n'est ajouté au backend.
2. **Graphe distinct des équations.** Départements et ressources ont des identités
   explicites ; les relations DEPENDS_ON et USES_RESOURCE sont informatives.
   Elles sont orientées et typées, sans topologie imposée ni résolution indépendante
   des sous-graphes. Les dépendances réciproques restent possibles. ActivityNode,
   facultatif dans le brief, n'est pas introduit dans cette première grammaire.
3. **Une déclaration et des imports explicites.** Une variable appartient à un
   fragment propriétaire ; les autres fragments importent son identité, unité,
   propriétaire et version de déclaration. Les paramètres locaux ou partagés
   suivent le même principe. Les identifiants sont canoniques et uniques par
   registre ; aucun rapprochement par libellé, renommage implicite ou merge de
   déclarations identiques. Cette première grammaire accepte un fragment par
   département dans un modèle ; les futurs modules multiples ne sont pas anticipés.
4. **Capacité unique et agrégation explicite.** Une ResourceNode référence un
   paramètre partagé approuvé, sa version et son unité. Elle conserve un propriétaire
   responsable unique et une liste `shared_with` ; ce périmètre est structurel,
   sans autorisation authentifiée. Chaque ResourceUse déclare une contribution
   linéaire additionnelle à cette ressource. Toutes les contributions sont réunies
   dans une seule contrainte HARD `sum(contributions) <= capacity`. Deux fragments
   ne reçoivent donc pas chacun toute la capacité. La somme de contributions
   portant sur la même variable est intentionnelle : il appartient à l'auteur
   de déclarer chaque consommation une seule fois. Une ressource sans ResourceUse
   reste UNMODELED et ne génère aucune équation ni consommation fictive égale à zéro.
5. **Objectif global séparé.** Un seul Objective, réutilisant le contrat de phase 1/2.
   Les objectifs locaux ou poids implicites sont rejetés. Une contrainte locale
   peut porter sur des variables de plusieurs départements après imports explicites.
   Les contraintes contradictoires sont toutes conservées et transmises au solveur.
6. **Canonicalisation et deux niveaux de manifeste.** Les registres, fragments,
   nœuds, relations, imports et termes sont triés. ModelDSL/IR produisent le hash
   mathématique existant. Le manifeste de composition couvre graphe, fragments,
   DSL, IR et provenance ; les métadonnées descriptives y participent. Le hash du
   manifeste DSL existant reste distinct. Aucune propriété d'équivalence algébrique
   générale ou signature d'approbation n'est attribuée à ces hashes.
7. **Sorties détachées et immuables.** Une Composition conserve la source et la DSL
   sous forme de chaînes JSON canoniques, l'IR gelée et des tuples de traces.
   Ses propriétés Pydantic retournent des copies détachées. Les entrées Pydantic
   sont revalidées ; leurs listes mutables ne peuvent réécrire un snapshot publié.
8. **Mesures indépendantes.** Les rapports vérifient modèle, manifeste, version,
   scénario et snapshot, puis réutilisent SolutionVerifier sur les valeurs binaires
   brutes. Aucune décision n'est arrondie. Capacité, consommation, marge signée,
   tolérance, état et provenance sont exposés. Sans témoin accepté, consommation
   et marge restent null, et non zéro. Aucun prix d'ombre, IIS ou diagnostic causal.
9. **SQLite embarqué plutôt qu'un ensemble de fichiers partiellement publiés.**
   Le module standard `sqlite3` évite une nouvelle dépendance/service et apporte
   une transaction unique pour graphe, fragments, paramètres, DSL/IR, run et rapport.
   `BEGIN IMMEDIATE`, contraintes d'identité/version et checksums permettent les
   publications concurrentes idempotentes et le rollback intégral en cas d'erreur.
   La publication est locale au sens de l'application ; elle n'envoie rien à GitHub
   ou à un service métier. Toutes les requêtes SQL sont fixes et paramétrées.
10. **Replay vérifié.** La lecture contrôle les checksums, recompose la source embarquée
    et compare DSL/IR/traces et composants stockés. Elle ne dépend plus des fichiers
    de fragments d'origine. Les paramètres/options/résultats de chaque run sont
    conservés ; un nouveau calcul conserve son propre UUID et peut différer entre
    optima multiples, comme en phase 2.

## Choix algorithmiques et limites

La composition fait des résolutions de références par dictionnaires et des sommes
symboliques de termes déclarés, pas une recherche d'optimum. Elle est linéaire en
nombre de déclarations/termes, avec des tris de canonicalisation en O(n log n),
hors taille des rationnels et des sérialisations. Le kernel se charge ensuite
des unités, agrégations numériques et vérifications habituelles ; HiGHS résout
un seul modèle global. Aucune nouvelle méthode de recherche opérationnelle n'est ajoutée.

Les snapshots publiés ne sont jamais remplacés : toute modification d'un objet
versionné exige une nouvelle version ; une modification du contenu du snapshot
de paramètres exige un nouvel id de snapshot. Un checksum détecte une corruption,
pas une modification malveillante de la base et de ses checksums par un administrateur
local. Le stockage est prévu pour un disque local et ne garantit ni synchronisation
multi-poste ni isolation multi-tenant. Les identifiants d'organisation sont des clés,
pas des autorisations. Pas de PostgreSQL, ORM, migrations de production ou RBAC.

La décision d'utiliser une transaction s'appuie sur les mécanismes décrits par
[SQLite — atomic commit](https://www.sqlite.org/atomiccommit.html) et sur l'API
[sqlite3 de Python](https://docs.python.org/3/library/sqlite3.html).
Les tests locaux couvrent interruption simulée, concurrence et corruption ; ils
ne certifient pas les propriétés du matériel ou du système de fichiers.

## Compatibilité et démonstrations

Le cas usine reconstruit mathématiquement demo_cross_department.json (4100 EUR).
La comparaison legacy utilise une réduction explicitement équivalente du modèle
à deux produits. Le fichier factory.json historique inclut stocks, sous-traitance,
activations et heures supplémentaires ; son objectif 6840 EUR ne correspond pas
au golden et aucune égalité artificielle n'est annoncée.
Le cas université utilise des binaires, une capacité de salles et un budget partagés,
plus une règle transversale et un objectif synthétique en unités de couverture.
Les mêmes schémas et algorithmes résolvent les deux organisations.
