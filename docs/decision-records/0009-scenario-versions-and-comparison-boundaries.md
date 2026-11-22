# ADR 0009 — Versions de scénarios et frontière de comparaison

Statut : adopté pour la première tranche de 5B ; extensions identifiées ci-dessous.

## Audit et choix de périmètre

La PR #4 est fusionnée dans `main` (`b25ca8d`). Sa CI réelle est réussie sur
Ubuntu, Windows et PostgreSQL. Les ADR 0001 à 0008, la spécification et la roadmap
ont été lus. Le socle possède modèles/graphes immuables, publication explicite,
snapshots identifiés, worker sécurisé et diagnostics en lecture seule. Il ne
possède ni registre de scénarios, ni politique de modifications ciblées, ni
moteur de comparaison des runs. Un champ `scenario_id` ne remplace pas ce registre.

La demande porte sur une première tranche minimale complète. Livrer d'abord
**copie identique → publication explicite → worker existant → run vérifié**.
Tous les changements de paramètres, capacités, contraintes, objectifs, unités ou
domaines sont refusés dans ce contrat. Aucune autorisation de modification n'est
déduite du rôle, du département propriétaire ou du libellé d'une ressource.

## Modèle persistant et versions

Migration additive `0005_5b` : table `scenario_versions`, sans transformation des
payloads existants. Chaque ligne lie une organisation, une clé/version déclarée,
une référence publiée, un modèle dérivé distinct, un GraphSnapshot et l'identité
du snapshot de données existant. Elle porte auteur, date, hash de requête et
document canonique avec nom, justification et empreintes de toutes les références.
Pas de nouveau catalogue de données dans cette tranche : le graphe publié et la
composition embarquée demeurent les snapshots immuables du socle.

L'identifiant technique aléatoire du scénario fournit un `scenario_id` et une
`model_version` dérivés distincts. Seuls ces deux champs d'identité sont changés
dans la copie de source ; le modèle mathématique et son hash restent identiques.
Le manifeste et les empreintes des artefacts dérivés sont distincts. Le snapshot
de données est conservé parce qu'aucune hypothèse numérique n'est changée.

Le modèle dérivé utilise `service.create_model`, en DRAFT. Il nécessite ensuite
la publication ADMIN/APPROVER existante. Les jobs continuent de référencer une
ModelVersion ; les runs retrouvent donc sans nouvelle FK leur version de scénario
via cette liaison unique. Aucun second chemin de résolution, solveur ou
vérificateur n'est créé. La seule adaptation du worker est la vérification du
nouveau numéro de migration, partagé avec l'API dans `SCHEMA_REVISION`.

Une clé/version appartient à une référence fixe. Nouvelle hypothèse ou correction
de métadonnée : nouvelle version, jamais PATCH/DELETE. Les FK composées imposent
le tenant sur modèles, graphe et auteur ; une contrainte interdit qu'un scénario
réutilise la référence comme modèle dérivé. RLS est activée/forcée et le rôle
runtime n'a que SELECT/INSERT sur les scénarios. Des triggers interdisent UPDATE
et DELETE, même pour les DML ordinaires du rôle de migration.

## Transactions, idempotence et provenance

ADMIN/BUILDER créent ; tout membre actif lit. Un non-membre reçoit 404, un rôle
sans droit de création 403. La transaction verrouille l'organisation avant
relecture des droits, puis crée modèle, scénario et audit ensemble. Aucun verrou
n'est conservé pendant une résolution.

La clé/version explicite est l'identité de création réessayable. Un hash canonique
de la demande validée et de l'auteur protège sa répétition : même demande, même
auteur et même référence retournent la même version ; un autre contenu/auteur
renvoie 409. Le verrou d'organisation sérialise les créations concurrentes,
renforcé par l'unicité SQL. Il n'y a ni incrément de version implicite ni écrasement.
Les jobs conservent séparément l'Idempotency-Key et les garanties de l'ADR 0006.

Les lectures contrôlent checksums, reconstruction canonique complète, snapshot,
provenance et égalité du clone après remplacement des seuls champs d'identité.
L'état du modèle dans la réponse est une projection actuelle de sa publication,
pas une mutation du document canonique du scénario. Les hashes détectent une
corruption, pas une réécriture privilégiée de toutes les protections SQL.

## Architecture des incréments suivants de 5B — non implémentés ici

Les politiques de changement devront être des documents versionnés publiés par
un rôle approbateur : chemins/identifiants autorisés, opérations et plages admises,
unités, justification et approbation nécessaire. Aucun patch JSON libre ni
expression exécutable. Toute référence à une règle HARD reste explicite ; aucun
assouplissement automatique ni passage implicite à SOFT.

Modifier un paramètre partagé ou une capacité exigera un nouveau graphe/snapshot
et la mise à jour cohérente des versions de références. Le service actuel exige
déjà un graphe publié identique aux paramètres du modèle : ne pas contourner ce
contrat pour gagner une étape d'interface. Les nouvelles hypothèses conserveront
leurs parents et empreintes, sans modifier la référence ou ses scénarios passés.

La comparaison sera un service Python en lecture seule sur des runs explicites :

- Authentifier les accès aux deux scénarios/runs dans le même tenant ; vérifier
  intégrité, correspondance run/version/snapshot et filiation déclarée.
- Revérifier les deux plans avec l'IR de chaque modèle et leurs tolérances
  enregistrées ; un SUCCEEDED technique ne prouve pas une faisabilité.
- Vérifier identifiants/domaines/unités des décisions et sémantique de l'objectif
  (formule, sens, unité, horizon/dimensions). Une ressemblance de libellé ou de
  valeur ne prouve jamais la compatibilité.
- Afficher les statuts, bornes et gaps réels séparément. INFEASIBLE, UNBOUNDED,
  CANCELLED, échec et TIME_LIMIT sans plan n'ont pas de différences de décisions,
  de marges ou de gains inventés. Deux plans vérifiés interrompus permettent au
  mieux un écart observé entre plans, sans gain optimal affirmé.
- Calculer en rationnels les différences de décisions, contraintes actives et
  ressources restantes. Gain orienté : candidat − baseline pour MAX, baseline −
  candidat pour MIN, uniquement avec une baseline valide et un cadre comparable.
  Sans baseline ou si incompatible : gain null avec raisons. Baseline nulle :
  aucun pourcentage. Les futurs deltas entre snapshots différents seront qualifiés
  comme variations d'hypothèses, pas comme gains opérationnels prouvés.
- Revérifier la baseline dans le modèle candidat avant toute revendication de gain
  dans ce même cadre ; les coûts de transition ne sont inclus que s'ils font partie
  du modèle. Ne pas confondre deux optima multiples avec des résultats invalides.

Ces contrats feront l'objet d'un nouvel incrément et de tests ; aucun endpoint
de comparaison, gain, sensibilité ou batch n'est livré aujourd'hui. Pas de 5C/6.

## Studio et conséquences

Un composant React chargé à la demande fournit création, détail et historique
paginé. Les types/OpenAPI sont générés et les réponses validées. Le transport
contrôle tenant et provenance. Une réponse perdue conserve la même requête et
verrouille les champs ; les doubles clics et callbacks après destruction sont
gardés. Aucun jeton persistant ni calcul de marge dans React.

La page lie le modèle dérivé et le centre d'exécution existants. La publication
est une action distincte confirmée. Aucun tableau de comparaison fictif ni
chiffre de gain. Les lectures recomposent les sources : simplicité et vérification
avant optimisation de performance ; aucun benchmark de grande volumétrie annoncé.
