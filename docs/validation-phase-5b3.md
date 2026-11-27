# Validation 5B-3 — Verified Scenario Comparison

Travail commencé le 26 et finalisé le 27 novembre 2026.
Branche `feature/phase-5b3-scenario-comparison`, base main
`6b5fbe1e4db5d44565a402021aa92dc11fce1c3d`.

## Audit et prérequis

La PR #11 UX-F5 est fusionnée. La CI main
[45899227727](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45899227727)
est entièrement verte avant création de branche. `git status -sb`, fetch, log,
worktrees, instructions, spécification intégrale, section 10, roadmap, guides
5B-2/UX-F5 et ADR de gouvernance/vérification ont été examinés.

Un seul worktree, aucun changement suivi au départ. Main a été synchronisé par
fast-forward. `tatus` reste non suivi et conserve son SHA256
`29AE5A2C4ACCB7DC1AADC718EF108CAAECDFEFDDBDE17DE2913C4213183185F8`.
`.local/`, bases de démonstration et historiques sont préservés. Les tests
utilisent uniquement `optimizer_brain_test` et `optimizer_brain_e2e`.

## Architecture avant / après

Avant : scénarios immuables 5B-1/5B-2, politiques, publications, worker, runs et
rapports vérifiés, mais aucun service de comparaison. Une identité `scenario_id`
ne suffisait pas à prouver la filiation ni la signification d’une métrique.

Après :

| Couche | Livraison |
|---|---|
| `brain/scenario_comparison` | Contrats stricts et moteur pur, déterministe, sans SQL/solveur/réseau/LLM ; revérification sur les IR originales et calculs `Fraction` |
| `brain/platform/comparisons.py` | Autorisation des deux runs sous le même tenant, reconstruction de modèles/graphes, vérification des scénarios et référence commune, journal de lecture |
| API FastAPI | GET de comparaison, sélection Pydantic fermée, OpenAPI et types régénérés ; aucune table/migration |
| `ScenarioComparison` | Page chargée à la demande depuis History/Scenario Lab, sélection explicite, résultats côte à côte, tables exactes et preuves expert |
| Client sécurisé | Contrôle des identités, tenant et indicateurs ; erreurs fermées, aucune valeur non vérifiée affichée, réponses tardives ignorées |

Le kernel, le compositeur, HiGHS, `SolutionVerifier`, les migrations et les
exemples existants n’ont pas été modifiés. Aucun nouveau solveur, LLM, batch,
sensibilité, multiobjectif ou Phase 5C/6. Les générateurs synthétiques de tests
INFEASIBLE/TIME_LIMIT ont été extraits mécaniquement dans un helper partagé,
sans changer leurs équations.

## Règles mathématiques et confiance

La [règle de comparabilité](decision-records/0014-verified-scenario-comparison.md)
exige une référence immuable commune et une empreinte de métrique couvrant
formule, sens, unité/échelle, variables/domaines/indices, dimensions et devise.
Un tenant commun, un libellé similaire ou deux montants en EUR ne suffisent pas.

Chaque plan est revérifié avec ses tolérances enregistrées. Le rapport historique
de vérification doit être reproduit et son objectif correspondre à l’IR originale.
Une attestation favorable doit être cohérente avec statut natif, conversion et
certificat enregistrés. SUCCEEDED n’entre pas dans cette qualification.

La différence observée est candidat − référence ; l’écart orienté respecte MAX/MIN.
Les valeurs et deltas sont des chaînes rationnelles exactes. Les décisions
binary64 natives sont évaluées exactement ; aucun montant Decimal n’est converti
en float pour la comparaison. Absence de valeur : null, jamais zéro implicite.

Une amélioration de l’objectif exige aussi même hash mathématique et même snapshot,
baseline revérifiée dans les tolérances du candidat et différence positive au-delà
de la somme des tolérances d’objectif. Le ratio exact éventuel est rapporté à
la valeur absolue de l’objectif baseline ; baseline nulle : null et motif explicite.
Cette amélioration porte sur deux plans, sans nouvelle preuve d’écart entre optima.

Un modèle/snapshot modifié autorise au mieux une observation qualifiée. Un gain
économique réel n’est pas certifié : les coûts inclus dans la formule sont évalués,
mais les coûts omis ne sont ni estimés ni réputés couverts. `economic_gain` reste
null, avec statut `NOT_DEMONSTRATED`. Une contrainte saturée ne fournit ni prix
d’ombre ni preuve de bénéfice.

## API et exemples autorisés/refusés

```http
GET /api/v1/organizations/{org}/scenario-comparisons?baseline_run_id={baseline}&candidate_run_id={candidate}
```

Tout membre actif peut lire les deux artefacts de son tenant. L’accès aux deux
IDs est contrôlé avant lecture de preuves. Un utilisateur membre de deux tenants
ne peut pas mélanger leurs runs. Paramètre absent : rapport INCOMPLETE ; inconnu,
vide ou trop long : 422. Absence/UUID étranger : même 404. Intégrité ou
reconstruction incompatible : 409. Les réponses restent sans cache.

| Cas testé | Résultat |
|---|---|
| Même run ou clone identique publié, même modèle/snapshot | COMPARABLE, delta 0 réel, aucune amélioration inventée |
| Usine 4100 EUR → 3500 EUR, capacité modifiée | QUALIFIED, écart −600 EUR ; amélioration/ratio null |
| Université 17 → 10, capacité modifiée | QUALIFIED, écart −7 unités ; amélioration/ratio null |
| Même mathématique, nouveau snapshot | QUALIFIED ; aucun gain malgré des équations identiques |
| Deux modèles publiés indépendamment | NOT_COMPARABLE, absence de filiation sémantique commune |
| MAX/MIN, formule ou unité incompatible | Motifs explicites, aucun delta croisé |
| INFEASIBLE / TIME_LIMIT sans solution réels | Statut conservé, objectif candidat et écarts absents |
| Plan refusé, métrique manquante ou attestation incohérente | Aucun objectif public de ce côté ni gain |
| Run étranger, y compris acteur membre des deux organisations | 404 sans fuite de preuve |
| Scénario sans run | Non utilisable comme résultat ; 404 pour un ID de scénario passé comme run |

Le test de témoin explicite 1900 → 4100 dans le même cadre vérifie une amélioration
mathématique de 2200 et un ratio rationnel `2200/19` %, sans gain économique.
Ce témoin est construit pour le test puis contrôlé par le vérificateur ; ce
n’est pas une nouvelle donnée opérationnelle ni un résultat inventé dans React.

## Fonctionnalités Studio

Route `/organizations/{org}/history/compare`, accessible depuis History et
Scenario Lab. Aucun résultat n’est choisi automatiquement comme baseline.
La page affiche dates, modèle/version, scénario, snapshots, objectifs et unités,
statuts/qualité de vérification, décisions, ressources/marges, contraintes et
hypothèses enregistrées. Liens vers résultats, modèles et filiation complète.

Le mode expert expose IDs, empreintes, bornes, gaps, tolérances et preuves, sans
droits supplémentaires. La sélection et la session sont en mémoire ; changement
de sélection/tenant efface le résultat précédent et ignore les réponses tardives.
Chaque comparaison est un GET sans mutation. Les tableaux sont défilables au
clavier sur mobile ; aucune approximation graphique ni recalcul dans React.

## Tests réellement exécutés

Windows, Python **3.14.3**, Node **24.13.0**, Chromium **159.0.8154.6**,
PostgreSQL **17** sur port 55432. API E2E 8002, Studio compilé 5181.

| Contrôle | Résultat local final |
|---|---|
| pytest complet avec PostgreSQL runtime réel | **534 réussis, 8 ignorés**, 207,78 s |
| Moteur pur | **32 cas** : exactitude, MAX/MIN, provenance, statuts, tolérances, zéro baseline et absence de réseau/solveur |
| API comparaison, SQLite + PostgreSQL | **24 réussis**, 29,14 s : rôles, RLS, concurrence, immutabilité, champs inconnus et erreurs historiques |
| Lanceur E2E après ajout du mode de mesure | **8 réussis** |
| Ruff check | Réussi sur `brain tests migrations scripts` |
| Ruff format, périmètre CI étendu | Réussi, **73 fichiers** |
| mypy | Réussi, **50 sources** |
| TypeScript / build / ESLint | Réussis |
| Vitest complet | **268 réussis**, 18 fichiers, dont les 244 existants |
| Playwright complet, PostgreSQL/API/worker réels | **67 réussis**, 3,4 min, dont les 57 existants |
| Mesure en lecture seule | **24 observations**, un GET par comparaison, zéro mutation métier |

Les huit skips correspondent aux variantes SQLite remplacées par leurs contrôles
PostgreSQL. Les deux avertissements locaux de dépréciation Python sont externes
(`CallSpec2`, Starlette/httpx). Le build signale la directive `use no memo` d’une
dépendance. Aucun contrôle n’a été désactivé, aucun timeout augmenté et aucun
retry Playwright ajouté.

Le premier passage Playwright complet avait 65/67 réussites : les deux échecs
étaient les anciennes assertions « comparaison indisponible » des parcours de
clone, après réussite de leur publication/résolution. Elles ont été remplacées
par le lien réel et l’absence de gain à la création ; la suite complète repasse
67/67. Le test vide History a reçu son contexte Router pour le nouveau lien.

Les dix nouveaux parcours créent explicitement des politiques/scénarios et des
modèles synthétiques via l’API sécurisée, publient séparément et utilisent le
worker existant. Les cas INFEASIBLE et TIME_LIMIT sans solution sont réels.
La réponse tardive et le conflit contenant un canari sont des injections de
transport identifiées, sans corruption de base. Les consultations des quatre
rôles en métier/expert ne déclenchent aucune écriture métier.

Les références usine **A=40, B=15, 4100 EUR** et université **17** sont conservées.
Les scénarios **3500** et **10** sont réellement calculés et revérifiés ; les
composants ne contiennent pas ces valeurs en constantes.

## Performances observées

Script `scripts/measure_comparison.mjs`, lancé avec `--comparison-measure` dans
l’environnement E2E isolé. Trois contextes Chromium neufs par secteur/largeur,
hauteur 1040, mouvement réduit, paires de runs et hashes de rapport épinglés.
Le script refuse une mutation métier ou un changement de rapport. Les mesures
commencent au clic après sélection ; chargement du catalogue et découverte des
paires sont exclus. La colonne HTTP inclut réseau local et réponse, pas seulement
temps CPU serveur. Médianes de six observations par largeur, en ms :

| Largeur | Clic → résultat affiché | Requête HTTP de comparaison |
|---|---|---|
| 1440 | 145 | 84 |
| 1280 | 164 | 90 |
| 768 | 141 | 82 |
| 390 | 143 | 78 |

Un GET par comparaison, aucun GET additionnel lors du passage en mode expert,
aucun débordement horizontal de page observé dans les 24 mesures. Les timings
incluent l’automatisation et ne sont ni INP, ni SLA, ni durée solveur. La fonction
de comparaison n’existait pas avant cette phase : aucun gain avant/après n’est
revendiqué. Base E2E enrichie sans purge ; aucune extrapolation à grande échelle.
Données brutes : [mesures](metrics/phase-5b3-comparison.json).

## Captures et vérification visuelle

[18 captures réelles](screenshots/phase-5b3/) issues du Studio compilé, deux
secteurs, 1440/1280/768/390 et preuve expert à 1440. Vues de navigateur de 1040 px
de haut, défilées vers qualification, valeurs ou preuve ; pas de montage graphique.
Les parcours vérifient focus clavier, mouvement réduit et absence de débordement
de page en métier puis expert. Cela ne constitue pas une certification WCAG.

- Usine : [1440](screenshots/phase-5b3/factory-values-1440.png),
  [1280](screenshots/phase-5b3/factory-values-1280.png),
  [768](screenshots/phase-5b3/factory-values-768.png),
  [390](screenshots/phase-5b3/factory-values-390.png).
- Université : [1440](screenshots/phase-5b3/university-values-1440.png),
  [390](screenshots/phase-5b3/university-values-390.png).
- Qualification : [desktop](screenshots/phase-5b3/factory-comparison-1440.png),
  [mobile](screenshots/phase-5b3/factory-comparison-390.png).
- Preuves : [usine](screenshots/phase-5b3/factory-expert-1440.png),
  [université](screenshots/phase-5b3/university-expert-1440.png).

## Reproduction, risques résiduels et livraison

Voir le [guide fonctionnel/API](scenario-comparison-phase-5b3.md) et le
[guide E2E isolé](ux-f1-e2e-isolation.md). PostgreSQL pytest exige ses URLs runtime
non propriétaire et migration sur **optimizer_brain_test** exclusivement.

```powershell
python -m pytest -q
python -m ruff check brain tests migrations scripts
python -m mypy
cd frontend
npm.cmd run build
npm.cmd run lint
npm.cmd test
cd ..
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build --comparison-measure
```

Limites : catalogue de runs chargé localement, pas de benchmark volumineux,
comparabilité conservatrice avec filiation de référence bornée à 16 modèles,
sélection en mémoire et aucune nouvelle table de comparaisons. Les journaux
applicatifs de consultation ne remplacent pas un audit signé ou une conservation
persistante du rapport. Les checksums ne résistent pas à une réécriture privilégiée
de toutes les preuves. Un historique non reproductible échoue fermé.

Les résultats CI push et pull_request du SHA final sont consignés dans la PR
de livraison : Ubuntu, Windows et PostgreSQL, avec les régressions frontend dans
le job PostgreSQL. Prochaine action : revue humaine ; aucune fusion automatique.
