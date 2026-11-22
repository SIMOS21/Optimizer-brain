# Validation Phase 5A — Constraint Diagnostics

## Audit et périmètre

Base : `main` synchronisé sur `2f8ca7e`, dont la
[CI de fusion](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45071595977)
est effectivement réussie. Branche : `feature/phase-5a-constraint-diagnostics`.
Le fichier utilisateur non suivi `tatus` a été préservé et exclu de la livraison.
AGENTS.md, la spécification et la roadmap ont été lus intégralement avant conception.

Constats sur le code réel :

- Le compilateur rejette les références et bornes invalides et émet déjà
  `INFEASIBLE_BY_BOUNDS`, sans rapport de conflits entre départements.
- Les traces du compositeur relient les lignes aux fragments, contributions,
  paramètres et ressources. Le rapport Phase 3 mesure les marges après
  vérification indépendante ; il n'expose pas de sensibilité.
- SciPy/HiGHS n'expose ni IIS ni prix d'ombre dans le contrat du projet.
- Le vérificateur contrôle sur l'IR originale les domaines, bornes, intégralité,
  lignes et objectif ; les tolérances du run sont réutilisables.
- L'API v1 possède déjà membership actif, RBAC, RLS et artefacts immuables.
  Les diagnostics sont ajoutés comme vues GET, sans migration.

La base avant modification a donné **337 réussites, 8 tests ignorés**, avec
PostgreSQL réel. Aucun fichier du kernel, compositeur, adaptateur HiGHS ou
vérificateur n'a été modifié. Les routes legacy et historiques sont conservées.

## Validation effectuée

Environnement local : Windows/PowerShell, Python 3.14.3, Node 24.13.0,
PostgreSQL 17. La CI conserve Python 3.11 sur Linux/Windows et PostgreSQL 17.
Les tests destructifs de migrations utilisent exclusivement la base dédiée
`optimizer_brain_test`, distincte de la base du Studio.

Les 44 cas du module couvrent erreurs de bornes/références/schéma, intervalles
avec coefficients négatifs et bornes infinies, constantes et termes annulés,
contraintes proportionnelles et égalités, changements d'unités, stabilité des
preuves et départage déterministe, extrêmes décimaux `1e100`/`1e-100`, statut
inconnu/ambigu et limites de temps, absence de diagnostic concluant, plans
corrompus et contrôle hors ligne sans appel à `milp` pendant le diagnostic.
Cent petits modèles entiers déterministes sont énumérés exhaustivement pour
vérifier l'absence de faux certificats de contradiction sur ces instances.
Cette comparaison est un test de solidité, pas une preuve d'exhaustivité générale.

Les 10 cas API exécutent les mêmes cinq scénarios sur SQLite et PostgreSQL :
droits des quatre rôles, isolation, révocation, draft contradictoire, provenance,
lecture concurrente déterministe, absence d'écritures SQL, immutabilité des
documents avant/après consultation et refus d'une reconstruction incompatible.

Les 15 cas Vitest supplémentaires couvrent le contrat exact, le rejet d'un IIS
ou d'un coût inventé, les identités étrangères, le chargement explicite en GET,
les états et tolérances, la provenance, l'empreinte, les erreurs HTTP et les
réponses tardives après changement d'organisation.

Les trois nouveaux parcours Chromium utilisent l'API et PostgreSQL réels :
consultation usine, consultation université, création d'un nouveau draft avec
demande Ventes >= 60 et capacité Logistique <= 55, sans réécrire le modèle publié.
Les parcours d'exécution existants vérifient aussi les diagnostics de nouveaux
runs produits par le worker réel, notamment INFEASIBLE et TIME_LIMIT sans plan.
Les annulations, échecs techniques et répétitions idempotentes restent testés.

Références conservées : **A=40, B=15, objectif usine=4100 EUR**, et **score
université=17**, avec vérification indépendante. Une tolérance n'efface pas
une contradiction exacte ; un test distingue explicitement ces deux portées.

Les premières erreurs de parcours ajoutés provenaient d'un compte VIEWER dont
le seed limite l'accès à l'usine et d'un sélecteur de texte ambigu ; les tests
ont été corrigés sans élargir les permissions. Une relance a été nécessaire
après régénération du contrat OpenAPI pendant un processus de tests déjà chargé ;
les contrôles finaux sont exécutés sur les sources et contrats figés.

## Garanties et limites

Voir [le guide](constraint-diagnostics-phase-5a.md) et
[l'ADR 0008](decision-records/0008-exact-read-only-constraint-diagnostics.md).
L'analyse statique est exacte mais incomplète ; aucun IIS, coût marginal,
prix d'ombre, assouplissement HARD ou nouveau statut d'optimalité n'est inventé.
Les modèles invalides sont diagnostiqués par l'entrée DSL hors ligne ; l'API
n'accepte que des modèles déjà validés à la création. Les rapports sont des
vues dérivées versionnées, pas de nouveaux artefacts historiques persistés.
Pas de benchmark de très grands modèles ; lectures synchrones sans cache.
Les Phases 5B, 5C et 6 ne sont pas commencées.

## Résultats finaux

| Contrôle local | Résultat observé |
|---|---|
| pytest complet, SQLite et PostgreSQL | **391 passed, 8 skipped**, 88,73 s |
| Ruff check | Réussi sur brain/tests/migrations/scripts |
| Ruff format | Réussi sur les chemins contrôlés par la CI, module et nouveaux tests inclus |
| mypy strict | Réussi, 40 fichiers sources |
| TypeScript | Réussi |
| Build Vite | Réussi |
| ESLint | Réussi |
| Vitest | **104 passed**, 8 fichiers |
| Playwright complet, API/PostgreSQL/worker réels | **30 passed**, 1,3 min |
| Assertions finales INFEASIBLE/TIME_LIMIT | **2 passed**, relance ciblée après ajout des assertions |
| Trois parcours diagnostics / captures | **3 passed**, relance finale |
| OpenAPI exporté | Égalité exacte avec le schéma de l'application, test réussi |

Les huit skips sont les variantes SQLite de tests de file/RLS qui exigent
PostgreSQL ; leurs variantes PostgreSQL sont exécutées dans la même suite.
Les deux avertissements pytest viennent des dépendances anyio et Starlette/httpx.
Le build signale la taille d'un bundle > 500 kB et une directive du runtime React ;
ces avertissements ne sont pas des erreurs de compilation et restent visibles.

La CI de branche réutilise les jobs Linux/Windows et PostgreSQL existants :
pytest découvre les nouveaux tests, Ruff/mypy incluent explicitement le module,
et les contrôles frontend exécutent Vitest et tous les parcours Playwright.
La dérive OpenAPI/TypeScript est bloquée par `git diff --exit-code` après
régénération. Les exécutions sont consultables dans les
[Actions de la branche](https://github.com/SIMOS21/Optimizer-brain/actions?query=branch%3Afeature%2Fphase-5a-constraint-diagnostics).
Le résultat distant du commit poussé est vérifié avant le rapport de livraison ;
les résultats locaux ci-dessus ne sont pas une extrapolation des résultats CI.
