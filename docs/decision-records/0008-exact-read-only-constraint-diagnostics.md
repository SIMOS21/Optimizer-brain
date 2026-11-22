# ADR 0008 — Diagnostics exacts, incomplets et en lecture seule

Statut : accepté pour la Phase 5A.

## Contexte

Le compilateur signale déjà `INFEASIBLE_BY_BOUNDS`, et les rapports de la
Phase 3 mesurent les marges après vérification indépendante. Ils n'expliquent
pas les conflits entre fragments. L'adaptateur SciPy/HiGHS ne fournit ni IIS
ni prix d'ombre dans son contrat. Le diagnostic legacy reste inchangé.

## Décision

Ajouter `brain.constraint_diagnostics`, sans changement au kernel, au compositeur,
au solveur ou au vérificateur. L'entrée `diagnose_model` passe d'abord par le DSL
strict et le compilateur : bornes inversées, références inconnues et erreurs
d'unités restent des erreurs de modèle, distinctes d'une infaisabilité mathématique.
Le compilateur s'arrêtant à la première erreur sémantique, ce rapport n'est pas
un inventaire exhaustif des erreurs d'entrée.

Deux preuves suffisantes sont calculées sur l'IR originale avec `Fraction` :

1. L'intervalle d'une expression linéaire est la somme des intervalles de ses
   termes, avec inversion des bornes pour un coefficient négatif. Une extrémité
   non bornée reste infinie. Une ligne dont le RHS ne peut satisfaire l'opérateur
   est contradictoire. Une expression constante, y compris après annulation de
   termes, est traitée de la même façon.
2. Pour chaque ligne non constante, diviser les coefficients et le RHS par le
   premier coefficient non nul ; inverser les inégalités s'il est négatif.
   Grouper par dimensions d'unité et vecteur normalisé dans les coordonnées
   numériques des variables. Comparer la plus grande borne inférieure à la
   plus petite borne supérieure. Si elles se croisent strictement, citer les
   deux lignes et l'intervalle impossible. Cette normalisation élimine également
   les facteurs de conversion d'unités déjà appliqués par le compilateur.

Ne pas énumérer toutes les paires : un conflit suffisant par famille parallèle,
départagé par identifiant. Le coût dépend de la taille creuse du modèle, avec
tri déterministe et opérations rationnelles ; il n'y a ni propagation itérative,
ni recherche combinatoire, ni calcul d'IIS. La taille des entiers intermédiaires
influe sur le coût de l'arithmétique exacte.

`NO_CONCLUSION` ne signifie jamais réalisable. L'analyse est volontairement
incomplète : conflits non parallèles, contradictions purement intégrales et
combinaisons générales de lignes peuvent lui échapper. `SOLVER_REPORTED` signifie
uniquement qu'un statut `INFEASIBLE` a été enregistré ; aucune cause n'en est
déduite. Les statuts inconnus et limites de temps restent distincts.

Les décisions historiques sont contrôlées à nouveau par `SolutionVerifier`, avec
les tolérances enregistrées et les valeurs binary64 exactes. Les lignes sont
`VIOLATED` au-delà de la tolérance, `SATURATED` si la marge absolue est dans la
tolérance, sinon `SATISFIED`. Sans valeur exploitable : `UNAVAILABLE`.
Une violation du domaine ou une incohérence d'objectif invalide le plan même
si ses lignes sont satisfaites. La saturation ne mesure pas le coût marginal :
`cost_status=NOT_EVALUATED` pour toutes les lignes, y compris les LP continus,
car notre interface ne fournit pas de données de sensibilité.

Les preuves statiques n'appliquent aucune tolérance. Un conflit exact inférieur
aux tolérances peut donc coexister avec un plan accepté numériquement. Exposer
les deux résultats et leur portée, sans transformer le statut historique du
solveur ni déclarer une optimalité rationnelle exacte. Toutes les valeurs
mathématiques du rapport sont des chaînes rationnelles, jamais arrondies pour
l'affichage. Aucun seuil binary64 du solveur n'est réutilisé comme seuil de preuve.

## Intégration et conséquences

Les routes GET existant dans l'application sécurisée sont complétées par des
sous-ressources `/diagnostics` sur les modèles et runs. Elles réutilisent
authentification, membership actif, RLS et requêtes limitées au tenant. Les quatre
rôles lisant les artefacts peuvent lire les diagnostics ; aucun endpoint de
relâchement ou de modification n'est ajouté.

Chaque rapport est une vue dérivée versionnée `5A.1`, rattachée aux empreintes
du modèle, du snapshot, de la composition et de l'artefact. Ni migration ni
écriture de rapport dans les documents historiques. Vérifier les checksums,
recomposer la source et comparer l'intégralité du document canonique : une
reconstruction différente échoue avec HTTP 409 plutôt que de réinterpréter
silencieusement l'IR historique. Les évolutions futures du compilateur devront
préserver cette reproductibilité ou prévoir explicitement la lecture des versions
antérieures. Les rapports dérivés sont déterministes pour les mêmes entrées et
la même version du moteur, pas des attestations persistées.

Le Studio charge à la demande une vue en lecture seule avec schéma OpenAPI
généré, contrôle org/artefact/type/empreinte et garde contre les réponses tardives.
Il ne calcule aucune marge, ne change aucune règle HARD et n'ajoute aucun scénario.
Les lectures sont synchrones : pour des modèles très volumineux, mesurer le coût
avant d'introduire une file ou un cache ; aucune performance à cette échelle
n'est revendiquée ici.
