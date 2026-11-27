# Phase 5B-3 — Comparer des résultats vérifiés

La comparaison est calculée à la demande depuis deux runs immuables. Elle ne
lance aucune optimisation et ne modifie ni modèle, scénario, snapshot, job ou
résultat. Voir l’[ADR 0014](decision-records/0014-verified-scenario-comparison.md)
pour les règles de confiance et de comparabilité.

## Parcours Studio

Dans **Décisions & historique**, ouvrir **Comparer deux résultats enregistrés**.
Le même accès est proposé dans Scenario Lab. Tous les membres actifs autorisés,
y compris VIEWER, disposent de cette consultation en lecture seule.

1. Choisir explicitement le run de référence et le candidat, par date/statut/ID.
2. Cliquer **Vérifier la comparaison**. Un scénario doit déjà posséder un run ;
   aucune publication ou résolution automatique n’est effectuée ici.
3. Lire la qualification et les motifs, puis les objectifs côte à côte.
4. Consulter décisions, capacités, consommations, marges, saturation et hypothèses
   enregistrées. Chaque côté conserve ses propres unités et tolérances.
5. Ouvrir les résultats, modèles et filiations de scénarios pour les détails.
6. En mode expert, consulter hashes, snapshots, statut natif, bornes/gaps, paramètres
   et vérification reproduite. Ce mode ne donne aucun droit supplémentaire.

Une nouvelle sélection efface immédiatement l’ancien résultat. Une erreur permet
une répétition explicite de la lecture ; aucune mutation idempotente n’est requise
pour un GET. Session et sélection restent en mémoire, avec les protections
existantes contre les réponses tardives et changements de tenant.

## API sécurisée

```http
GET /api/v1/organizations/{org}/scenario-comparisons?baseline_run_id={baseline}&candidate_run_id={candidate}
Authorization: Bearer <session en mémoire>
```

Les deux identifiants doivent désigner des OptimizationRun réellement enregistrés
dans cette même organisation. Un utilisateur membre de deux organisations ne peut
pas mélanger leurs runs dans une requête. Aucun corps JSON, paramètre de gain,
formule ou patch de modèle n’est accepté dans le contrat de comparaison.

| Réponse | Signification |
|---|---|
| 200 COMPARABLE | Plans revérifiés, métrique/filiation communes, même modèle mathématique et snapshot |
| 200 QUALIFIED | Plans et métrique comparables, mais modèle ou snapshot modifié ; écarts d’hypothèses seulement |
| 200 NOT_COMPARABLE | Absence de plan vérifié ou preuve de comparabilité insuffisante ; motifs explicites |
| 200 INCOMPLETE | Une sélection manque ; aucun zéro ni baseline implicite |
| 401 | Session absente/expirée |
| 404 | Organisation ou l’un des runs absent/inaccessible ; même réponse pour un UUID étranger |
| 409 | Intégrité, publication ou reconstruction historique incompatible |
| 422 | Paramètre inconnu, identifiant vide ou trop long |

Les erreurs mathématiques d’un run (INFEASIBLE, TIME_LIMIT sans solution, etc.)
ne deviennent pas des erreurs HTTP 500. Le rapport expose le statut réel et
refuse les écarts qui exigeraient un plan absent. Les réponses restent sans cache.

## Contrat de résultat

`ComparisonReport` est exporté dans OpenAPI et les types TypeScript générés.
Sa version est `5B.3`, son algorithme `verified-comparison-1`. Il comprend :

- Les deux identités de runs, auteurs/dates, modèles/versions, graphes/snapshots,
  référence commune éventuelle, scénarios et empreintes.
- Le statut public et natif de chaque résultat, la vérification reproduite et
  les informations natives disponibles, sans borne/gap de remplacement.
- La comparabilité et ses motifs structurés par côté ou par paire.
- Les valeurs exactes, deltas observés/orientés, tableaux de décisions, ressources
  et contraintes, ainsi que les changements enregistrés des scénarios.
- Une amélioration de l’objectif et un ratio éventuels, distincts d’un gain réel.
- Un hash canonique déterministe, sans horodatage de génération variable.

Les quantités calculées sont des chaînes : entiers ou fractions rationnelles,
par exemple `1/3`. Une valeur absente est null. Aucun Decimal monétaire n’est
converti en float pour comparer. Les décisions natives binary64 sont revérifiées
avec leurs valeurs exactes et les coefficients originaux. React n’effectue ni
arrondi, ni conversion d’unité, ni calcul de delta ou de pourcentage.

## Écart, amélioration de l’objectif et gain économique

La différence observée est candidat − référence. La différence orientée est
l’opposé pour MIN. Ces différences ne sont disponibles qu’avec deux plans
revérifiés et une métrique de signification identique, reliée à une même
référence immuable. Deux modèles indépendants d’un même tenant ne suffisent pas.

Pour `objective_improvement`, le hash mathématique et le snapshot doivent aussi
être identiques ; la baseline est revérifiée avec les tolérances du candidat et
l’amélioration doit dépasser la somme des tolérances d’objectif des deux runs.
Le ratio éventuel est `100 * amélioration / abs(objectif de référence)`, en
rationnels exacts. Baseline nulle, cadre modifié ou amélioration non établie : null.
Ce ratio ne mesure pas une évolution de l’optimum ni une performance réelle.

Les coûts présents dans la formule de l’objectif sont inclus dans son évaluation.
Aucun coût de transition omis n’est estimé. `economic_gain` reste null avec statut
`NOT_DEMONSTRATED` : la plateforme ne certifie pas un bénéfice opérationnel.

Les cas usine **4100 EUR → 3500 EUR** et université **17 → 10** sont des écarts
observés **−600 EUR** et **−7 unités**, dans des snapshots modifiés. Ils affichent :
**« Écart observé entre scénarios — gain non démontré. »** Aucun pourcentage de
gain n’est annoncé. Une ressource moins consommée ou une contrainte saturée ne
constitue pas une preuve de bénéfice.

## Exécution et limites

Déploiement et worker restent ceux des guides [4C](execution-center-phase-4c.md)
et [5B-2](controlled-scenarios-phase-5b2.md). Aucune migration supplémentaire.
Actualiser API et build Studio ensemble ; OpenAPI/types sont régénérables :

```powershell
python -m scripts.export_studio_contract
cd frontend
npm.cmd run generate:types
npm.cmd run build
```

La sélection repose sur le catalogue de runs autorisés existant, paginé côté
réseau puis chargé localement. Les tableaux sont consultables au clavier et
défilent horizontalement sur petit écran. La comparaison n’est pas sauvegardée
comme nouvel artefact ; ses IDs et hash permettent de la reproduire.

La règle conservatrice peut refuser des modèles équivalents sans filiation
reconnue. Un changement de compilateur/vérificateur incompatible avec l’historique
échoue fermé. Pas de garantie à grande volumétrie, de sensibilité, batch,
multiobjectif, nouveau solveur, Phase 5C/6 ou LLM.
