# Validation UX-F5 — Scenario Lab, History & Final UX Validation

26 novembre 2026. Branche `feature/ux-v2-scenario-history`.

## Prérequis et périmètre

La PR #10 UX-F4 est fusionnée depuis le 26 novembre à 20:39 UTC. La branche
part de `dece484418881a15777ee4b9c14e0ef49df517a9`, synchronisé par fast-forward.
La CI main [45892631065](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45892631065)
avait ses trois jobs Ubuntu, Windows et PostgreSQL verts avant la création de
branche. Le fichier non suivi `tatus` est conservé, avec SHA256 inchangé
`29AE5A2C4ACCB7DC1AADC718EF108CAAECDFEFDDBDE17DE2913C4213183185F8`.

Aucune modification du Brain, des migrations, des contrats API, des exemples,
des fixtures statiques, de RBAC/RLS ni des historiques. Les nouveaux artefacts
synthétiques des parcours sont ajoutés uniquement dans la base E2E isolée.
`.local/`, la base de démonstration et les anciens résultats ne sont pas purgés.
Cette livraison n’inclut ni 5B-3, ni 5C, ni LLM.

## Architecture avant / après

Avant : `ScenarioLab` proposait clone et détail ; `ControlledScenarios` possédait
déjà création de politique, accords, publication, preview et commit contrôlé.
Le formulaire d’utilisation suivait le catalogue complet des politiques. History
se limitait au sélecteur de résultats et au cockpit. L’objectif mobile occupait
une colonne étroite et une phrase annonçait encore le calcul pour la Phase 4C.

Après : mêmes mutations sécurisées, présentées dans un assistant lisible, avec
référence et formulaire principal avant la gestion des politiques. Le clone
identique reste accessible dans un panneau secondaire. History ajoute filtres,
résumés qualifiés et pagination sans supprimer le sélecteur direct ni les URL.

| Composant | Responsabilité |
|---|---|
| `ScenarioLab` | Repère de sept étapes, clone conservé, liste métier/expert et détail avec publications séparées |
| `ScenarioReference` | Lecture sécurisée du modèle publié, version, snapshot, date et vérification de l’empreinte attendue |
| `ControlledScenarios` / `ChangeForm` | Politique réellement publiée, accords, délégations, SET textuel, preview serveur et corps figé après réponse incertaine |
| `PolicyEditor` | Création existante montée au premier dépliage ; accord et publication restent distincts |
| `History` / `HistoryCard` | Cinq résumés par page, filtres de métadonnées, lecture des runs complets, rapprochement borné des jobs |
| `assessTrust` | Qualification commune réutilisée ; compatibilité explicite avec les statuts natifs du rapport |
| `scenario-history.css` / `execution-center.css` | Design system existant, responsive, focus visible, mouvement réduit et KPI objectif mobile |

Décisions et limites détaillées dans l’[ADR 0013](decision-records/0013-scenario-assistant-and-bounded-history.md).

## Parcours et invariants conservés

1. Choisir une référence publiée et consulter son modèle, sa version et son snapshot.
2. Choisir une politique publiée utilisable. DRAFT et politiques révoquées restent
   visibles dans le catalogue mais ne sont pas utilisables dans ce sélecteur.
3. Distinguer auteur, responsable nommé, accords OWNER_ACK, publieur et délégataires.
   Une politique utilisable ne donne aucun droit à tous les membres. Un VIEWER
   nommé responsable ne dispose pas du bouton d’accord. La publication attend les
   accords enregistrés de tous les responsables ; le serveur reste l’autorité.
4. Saisir uniquement les règles explicitement déléguées. Opération SET, unité,
   domaine et bornes viennent du contrat publié. Les nombres restent des chaînes.
   Pour un parent, la valeur héritée n’est confirmée qu’avec la preview serveur.
5. Lire original/précédent/proposé, provenance, contraintes concernées et éventuel
   objectif concerné depuis la réponse serveur. Aucun calcul d’optimisation ici.
6. Confirmer la création DRAFT. Une réponse perdue conserve corps et empreinte ;
   la répétition est identique, sans changement de référence ou politique.
7. Publier explicitement le nouveau graphe, puis le modèle dérivé. Ouvrir
   Optimization Center UX-F4 et confirmer un lancement distinct via son worker.

Les sessions restent en mémoire. `ApiClient`, `useLoad`, le remontage du Workspace
par tenant et l’annulation existante protègent contre les réponses tardives.
Le mode expert conserve exactement les mêmes permissions. Aucun déplacement
visuel, filtre ou changement de mode ne modifie les artefacts.

L’historique distingue statut mathématique et état technique. Seule une page
explicite de 50 jobs est rapprochée par organisation, run et modèle. Un job absent
reste « Non fourni », jamais SUCCEEDED par déduction. Les objectifs des résumés
exigent l’artefact complet et `assessTrust` ; les métadonnées seules ne suffisent pas.

## Défaut démontré corrigé

Un scénario réel SET `45.00000000000000001` a conservé sa valeur exacte en
preview, scénario et snapshot. Le calcul a retourné un plan vérifié avec objectif
enregistré **3500**, statut natif `FEASIBLE` et statut public
`FEASIBLE_NOT_PROVEN_OPTIMAL`, avec avertissement de conversion rationnel/binary64
non exacte. Cette valeur est constatée dans le résultat, sans gain calculé.

`OrganizationReport` conserve le statut natif. Le frontend exigeait auparavant
son égalité textuelle avec le statut public et masquait ce plan. La correction
accepte uniquement les correspondances fermées `FEASIBLE`/`TIME_LIMIT` vers
`FEASIBLE_NOT_PROVEN_OPTIMAL`, en conservant tous les contrôles de vérification.
Un statut natif seulement FEASIBLE ne peut toujours pas devenir OPTIMAL. Les
rapports inconnus/incohérents et les vérifications refusées restent masqués.

## Tests réellement exécutés localement

Windows, Python **3.14.3**, Node **24.13.0**, Chromium **159.0.8154.6**, PostgreSQL
**17** sur le port 55432. Tests Python sur `optimizer_brain_test` et parcours sur
`optimizer_brain_e2e`, API 8002 et Studio compilé 5181. Aucun usage de la base démo.

| Contrôle | Résultat |
|---|---|
| TypeScript + build de production | Réussis |
| ESLint | Réussi |
| Vitest complet | **244 réussis**, 17 fichiers ; base 213 conservée, 31 ajouts |
| pytest complet avec PostgreSQL runtime réel | **478 réussis, 8 ignorés**, 186,75 s |
| Ruff check | Réussi sur `brain tests migrations scripts` |
| Ruff format, périmètre CI | Réussi, 67 fichiers |
| mypy, configuration du dépôt | Réussi, 46 fichiers |
| Playwright complet, API/PostgreSQL/worker réels | **57 réussis**, 2,8 min ; les **50 historiques** conservés |
| Nouveaux parcours rejoués après correction du statut | **7 réussis**, puis inclus dans les 57 |
| Mesures de parcours | **24 avant + 24 après**, références/empreintes identiques, zéro mutation métier |

Les huit skips PostgreSQL correspondent aux variantes SQLite remplacées par
leurs validations PostgreSQL. Deux avertissements Python de dépréciation externes
(`CallSpec2`, Starlette/httpx) subsistent ; le build signale aussi une directive
de module `use no memo` provenant des dépendances. Aucun contrôle n’a été désactivé,
aucun délai n’a été augmenté et aucun retry Playwright n’a été ajouté.

Couverture nouvelle : qualification de huit états en métier/expert, rapports
natifs FEASIBLE/TIME_LIMIT, refus de statuts incohérents, métadonnées favorables
sans vérification, association erronée de job, pagination et accès direct,
réponse tardive d’un ancien tenant, fraction `1/3` inchangée, droits de responsable
révoqués, accords manquants, chargement paresseux et héritage décimal exact.

Le parcours décimal crée réellement une politique, donne OWNER_ACK, publie,
prévisualise, crée puis perd volontairement la première réponse HTTP. Le serveur
rend le même scénario au retry avec le même corps. Graphe et modèle sont ensuite
publiés séparément, puis résolus par le worker avec vérification indépendante.
L’injection de vérification refusée est un test de présentation via réponse HTTP
interceptée, sans corruption persistée en base ; ce n’est pas une nouvelle preuve
du vérificateur. Les parcours historiques couvrent les refus serveur, clones,
révocations, annulations, erreurs, INFEASIBLE et TIME_LIMIT réels.

Les références restent **usine A=40, B=15, objectif=4100 EUR** et **université=17**.
Les scénarios contrôlés historiques ont réellement donné 3500 et 10 ; aucune
amélioration relative ou comparaison mathématique n’est annoncée.

## Mesures avant / après

Script reproductible `scripts/measure_scenario_history.mjs`, appelé par le
launcher isolé. Avant : build main UX-F4 ; après : build UX-F5. Même machine,
API locale, navigateur, modèles, runs et politiques épinglés par ID/empreinte.
Trois contextes Chromium neufs par secteur et largeur, hauteur 1040, mouvement
réduit. Chaque cellule ci-dessous est la médiane de six observations, en ms
(usine + université). Valeurs arrondies seulement pour ce tableau de mesure UI.

| Largeur | Ouverture scénarios avant → après | Titre formulaire avant → après | Ouverture historique avant → après | Objectif enregistré visible avant → après |
|---|---|---|---|---|
| 1440 | 1197 → 1456 | 18 → 20 | 138 → 137 | 41 → 45 |
| 1280 | 1209 → 1461 | 15 → 20 | 131 → 129 | 32 → 48 |
| 768 | 1167 → 1405 | 15 → 18 | 170 → 183 | 31 → 41 |
| 390 | 1161 → 1417 | 16 → 18 | 188 → 191 | 34 → 43 |

L’ouverture des scénarios attend le catalogue de politiques ; le titre du
formulaire mesure son montage après sélection, pas l’achèvement de toutes ses
lectures. L’ouverture d’historique attend le sélecteur. Les captures de son nouvel
aperçu attendent ensuite un résumé, hors de ce temps. Ces mesures incluent
automatisation et réseau local ; elles ne mesurent ni INP ni durée solveur.
L’historique E2E a grandi pendant les tests sans purge et sa cardinalité initiale
n’a pas été relevée. Les chiffres ne permettent donc pas d’attribuer causalement
un écart au rendu React ou au backend. **Aucun gain global n’est revendiqué.**

Aux frontières observées, l’ouverture historique déclenche maintenant sept GET
(métadonnées, cinq résumés, une page de jobs), contre un à trois avant selon les
lectures asynchrones encore en cours. Le détail choisi demande un GET dans les
deux versions. Pas de polling ajouté, cinq résumés maximum par page, éditeur de
politique chargé seulement au premier dépliage. Aucun débordement horizontal
observé dans les 48 mesures. Données brutes :
[avant](metrics/ux-f5-before.json), [après](metrics/ux-f5-after.json).

## Captures réelles et accessibilité

Les [captures](screenshots/ux-f5/) sont des vues de navigateur 1040 px de haut,
parfois défilées jusqu’au formulaire ou au KPI ; elles ne représentent pas toute
la longueur du catalogue. Vérification visuelle aux largeurs 1440, 1280, 768 et
390, plus tests de clavier/focus, réduction de mouvement, absence de débordement
et largeur effective du KPI à 390. Cela ne constitue pas une certification WCAG.

| Vue | Avant | Après |
|---|---|---|
| Scénario usine 1440 | [capture](screenshots/ux-f5/before-factory-scenario-1440.png) | [capture](screenshots/ux-f5/after-factory-scenario-1440.png) |
| Scénario usine 390 | [capture](screenshots/ux-f5/before-factory-scenario-390.png) | [capture](screenshots/ux-f5/after-factory-scenario-390.png) |
| Objectif usine 390 | [capture](screenshots/ux-f5/before-factory-history-390.png) | [capture](screenshots/ux-f5/after-factory-history-390.png) |
| Nouvel historique | — | [1440](screenshots/ux-f5/after-factory-history-overview-1440.png), [390](screenshots/ux-f5/after-factory-history-overview-390.png) |
| Université 390 | — | [scénario](screenshots/ux-f5/after-university-scenario-390.png), [objectif 17](screenshots/ux-f5/after-university-history-390.png) |
| Preview décimale serveur | — | [capture](screenshots/ux-f5/exact-preview-1440.png) |

Les captures intermédiaires 1280/768 et les autres vues avant/après figurent dans
le même dossier. Les parcours des quatre rôles vérifient les deux modes de
présentation sans écriture métier pendant leur consultation.

## Reproduction et limites

Configuration privée dédiée selon [le guide E2E](ux-f1-e2e-isolation.md), puis :

```powershell
cd frontend
npm.cmd run build
npm.cmd run lint
npm.cmd test
cd ..
python -m pytest -q
python -m ruff check brain tests migrations scripts
python -m mypy
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build --scenario-measure before
# Après avoir construit l’autre version, sur la même base E2E préservée :
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build --scenario-measure after
```

Pour pytest PostgreSQL, fournir `BRAIN_TEST_DATABASE_URL` runtime non propriétaire
et `BRAIN_TEST_MIGRATION_DATABASE_URL` sur la base **optimizer_brain_test**, selon
le workflow CI ; ne jamais réutiliser une base de démonstration. Les résultats
des contrôles GitHub push et pull_request du SHA final sont consignés dans la PR.
Les jobs Python Ubuntu/Windows utilisent Python 3.11 ; le job PostgreSQL exécute
aussi TypeScript/build/lint/Vitest et les parcours réels de Studio compilé.

Limites : pagination des métadonnées encore locale, une page de jobs à la fois,
catalogue de 50 politiques potentiellement long, identités UUID conservées quand
le contrat ne fournit pas de nom, reprise incertaine en mémoire uniquement.
Le créateur de politique reste limité à une règle par formulaire, conformément
à l’interface existante. Les capacités métier réelles ne sont pas inventées.

Prochaine action : revue humaine de cette PR et de ses CI, sans fusion automatique.
Les comparaisons de runs et gains devront faire l’objet d’une tranche 5B-3 séparée.
