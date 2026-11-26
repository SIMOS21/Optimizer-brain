# ADR 0014 — Comparaison vérifiée et portée des améliorations

Date : 26 novembre 2026. Statut : adopté pour 5B-3.

## Contexte et audit

Base main `6b5fbe1e4db5d44565a402021aa92dc11fce1c3d`, après fusion UX-F5/PR #11.
La CI main 45899227727 est verte sur Ubuntu, Windows et PostgreSQL avant création
de `feature/phase-5b3-scenario-comparison`. Aucun changement local suivi ; `tatus`
est préservé. Spécification intégrale, section 10.2, ADR 0002/0004/0006/0007/0009/
0010/0013 et contrats existants examinés.

Les modèles conservent leur composition complète et leur graphe. Les runs
conservent le résultat, les décisions binary64, les valeurs rationnelles
recalculées et les tolérances. Les scénarios ont une liaison unique vers le modèle
dérivé, avec référence et changements immuables. `scenario_id` seul ne prouve pas
cette filiation. Le socle ne possède ni moteur de comparaison ni contrat de coût
de transition opérationnelle indépendant de l’objectif.

## Architecture

`brain/scenario_comparison` est une bibliothèque pure sans SQL, réseau, LLM ou
appel solveur. Elle réutilise `SolutionVerifier` et les IR originales ; elle ne
modifie pas le kernel, HiGHS ou le vérificateur. Contrats Pydantic stricts séparés
des calculs. Toutes les nouvelles quantités sont des chaînes rationnelles exactes.

`brain/platform/comparisons.py` vérifie d’abord le membre courant et l’accès aux
deux runs sous RLS. UUID étranger et UUID absent donnent la même erreur 404,
même pour un utilisateur membre des deux tenants. Ensuite seulement : checksum,
reconstruction canonique du modèle, publication, graphe, snapshot et métadonnées
IR. Les vérifications de filiation existantes de `scenarios` sont réutilisées.
Le parcours des références est borné à 16 modèles, sans migration ni nouvelle table.

Une politique révoquée bloque toujours les usages futurs prévus par 5B-2, mais
n’efface pas l’accès historique d’un membre courant autorisé. Aucune nouvelle
autorité de création, de publication ou d’exécution n’est accordée par une comparaison.

L’API GET `/api/v1/organizations/{org}/scenario-comparisons` reçoit deux paramètres
`baseline_run_id` et `candidate_run_id`. L’absence d’un paramètre donne un rapport
INCOMPLETE ; un scénario dépourvu de run ne peut pas être utilisé comme run.
Les contrôles historiques échouent en 409, jamais en résultat favorable inventé.
Le contrat existant de réponse sans cache est conservé.

Chaque lecture réussie journalise acteur, tenant, deux identités, hash et
qualification, sans valeurs de décision ni secret. Ce journal applicatif n’est
pas une nouvelle ligne d’audit persistée. Le rapport est calculé à la demande ;
son hash canonique couvre les entrées et qualifications. Aucune date de génération
ou durée variable ne perturbe son déterminisme. Les dates exposées sont celles
des artefacts réels.

## Comparabilité et arithmétique

Une référence immuable commune, reconstruite depuis le registre, est nécessaire.
Deux modèles publiés indépendamment, même avec les mêmes formules et unités,
ne fournissent pas à eux seuls une preuve de signification commune.

L’empreinte de métrique couvre identifiant, sens, formule rationnelle, unité et
échelle, priorité, propriétaire/source de l’objectif, identifiants/domaines/unités/
départements/indices des variables, dimensions et devise. Les changements de
bounds et de contraintes sont qualifiés séparément par le hash mathématique.
Une simple ressemblance de nom, un tenant commun ou deux montants en EUR ne
suffisent pas. Aucun taux de change ni conversion d’unité implicite.

Chaque plan doit repasser le vérificateur avec ses tolérances enregistrées.
Le rapport de vérification historique doit être reproduit, son objectif doit
correspondre à l’évaluation sur l’IR originale et les statuts/indicateurs doivent
être cohérents. Un OPTIMAL favorable exige l’attestation native déjà enregistrée
(code 0, portée solver_tolerances, conversion d’entrée exacte). Il ne constitue
jamais une nouvelle preuve symbolique d’optimalité.

Les valeurs natives de décision restent les binary64 d’origine ; le vérificateur
les évalue en rationnels exacts. Les montants décimaux de l’IR ne sont jamais
convertis en float pour comparer. Objectifs, décisions, capacités, consommations,
marges et différences sont calculés avec `Fraction`, sans contexte Decimal à
précision limitée. Une fraction non décimale reste une fraction dans l’API et React.

## Qualifications et gains

- **COMPARABLE** : deux plans vérifiés, métrique/filiation communes, même hash
  mathématique et même snapshot de données. Les versions et manifestes d’audit
  peuvent différer pour un clone identique ; les identités restent visibles.
- **QUALIFIED** : plans et métrique comparables, modèle ou snapshot modifié. Les
  différences sont des observations entre hypothèses ; aucune amélioration
  démontrée dans le même cadre ni pourcentage de gain n’est annoncé.
- **NOT_COMPARABLE** : filiation/sémantique incompatibles, plan absent ou refusé.
  Les valeurs propres à un plan vérifié restent consultables, mais aucun delta
  croisé n’est calculé. Les unités sont conservées séparément par côté.
- **INCOMPLETE** : une sélection manque ; aucun zéro de remplacement.

Différence observée = candidat − baseline. Différence orientée = cette différence
pour MAX, son opposé pour MIN. Ni l’une ni l’autre ne constitue un gain économique.

`objective_improvement` est disponible seulement dans le même modèle/snapshot,
avec deux plans vérifiés et amélioration positive dépassant la somme des deux
tolérances d’objectif enregistrées (absolues + relatives à l’échelle des valeurs).
La baseline est en plus revérifiée dans le cadre et les tolérances du candidat.
Le libellé limite cette amélioration aux valeurs de deux plans : aucune preuve
nouvelle sur l’écart entre optima. Des plans interrompus gardent leur statut.

Un pourcentage, lorsqu’il est défini, est le ratio rationnel exact
`100 * objective_improvement / abs(baseline_objective)`. Baseline nulle : null
et motif explicite. Modèle/snapshot différent : null. Aucun arrondi ni pourcentage
recalculé dans React.

`economic_gain` reste null et `economic_gain_status=NOT_DEMONSTRATED`. Les coûts
présents dans la formule sont naturellement inclus dans son évaluation ; le
contrat ne certifie ni coûts omis, ni mise en œuvre réelle. L’interface ne peut
donc pas transformer cette amélioration mathématique en bénéfice réel.

Les écarts d’hypothèses affichent obligatoirement : « Écart observé entre
scénarios — gain non démontré. » Contraintes saturées et tolérances sont des
mesures de plan, sans prix d’ombre, causalité ou bénéfice supposé.

## Limites

Cette règle conservatrice peut refuser des modèles mathématiquement équivalents
qui n’ont pas de filiation reconnue. Une future extension de comparabilité devra
être versionnée et prouvée, sans réécriture des artefacts. Un changement de
compilateur ou de vérificateur qui ne reproduit plus l’historique échoue fermé.
Les hashes détectent une corruption, pas une réécriture privilégiée de toutes
les protections et preuves en base. Aucun stockage permanent de comparaison,
batch, sensibilité, multiobjectif, Phase 5C/6 ou LLM.
