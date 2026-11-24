> **Développement :** lire `AGENTS.md` et `OPTIMIZATION_BRAIN_SPEC.md`. Les phases 0 à 3, 4A, 4B et le centre d'exécution backend/frontend 4C sont livrés. La Phase 5 reste hors périmètre.

# Optimization Brain — MVP conservé et Universal Model Kernel

Le MVP industriel v0.1 reste disponible avec ses routes et ses tests historiques.
La nouvelle bibliothèque `brain/kernel/` ajoute la DSL v1 stricte, les unités,
le compilateur vers une IR immuable et la vérification d'un plan fourni.
La phase 2 ajoute le solveur générique SciPy/HiGHS, l'orchestrateur et la vérification
indépendante des valeurs brutes sur cette IR. Le Brain fonctionne hors ligne, sans LLM.

Documents : [audit initial](docs/audit-phase-0.md), [contrat DSL](docs/model-dsl.md),
[choix algorithmiques](docs/decision-records/0001-universal-kernel.md),
[roadmap réelle](docs/roadmap.md), [résultats de validation](docs/validation.md).
Phase 2 : [contrat solveur](docs/solver-contract.md), [API](docs/API.md),
[ADR numérique](docs/decision-records/0002-highs-numerics-and-verification.md),
[validation phase 2](docs/validation-phase-2.md).
Phase 3 : [Organization Graph](docs/organization-graph.md),
[composition et snapshots locaux](docs/model-composition.md),
[ADR de composition](docs/decision-records/0003-organization-composition-and-local-snapshots.md),
[audit préalable](docs/audit-phase-3.md), [validation phase 3](docs/validation-phase-3.md).
Phase 4A : [déploiement PostgreSQL et API sécurisée](docs/platform-phase-4a.md),
[ADR identité et gouvernance](docs/decision-records/0004-persistence-identity-governance.md),
[audit préalable](docs/audit-phase-4a.md), [validation](docs/validation-phase-4a.md).
Phase 4B : [Visual Organization Studio](docs/studio-phase-4b.md),
[ADR navigateur et contrats](docs/decision-records/0005-visual-studio-browser-contracts.md),
[audit](docs/audit-phase-4b.md), [validation et captures](docs/validation-phase-4b.md).
Phase 4C : [centre d'exécution backend](docs/execution-center-phase-4c.md),
[ADR jobs et concurrence](docs/decision-records/0006-asynchronous-execution-center.md).
La [revue backend et le plan frontend 4C](docs/review-phase-4c-backend.md)
documentent la reprise, les preuves de validation et le préalable d'intégration.
Frontend 4C : [guide utilisateur et lancement](docs/frontend-execution-phase-4c.md),
[ADR navigateur](docs/decision-records/0007-frontend-execution-and-result-trust.md),
[validation](docs/validation-phase-4c.md).

## Optimization Center (phase 4C)

Dans le Studio, sélectionner une organisation puis **Optimization Center** :
choisir une version publiée, configurer SolveSettings et lancer le job. Un worker
runtime distinct doit tourner avec `python -m brain.platform.worker`. Le centre
suit l'état technique, accepte une demande d'annulation autorisée et présente le
run immuable avec son statut mathématique et sa vérification indépendante.
Les références synthétiques restent **4100 EUR** pour l'usine et **17** pour
l'université. Aucun gain sans baseline, progression ou certificat n'est inventé.

## Studio organisationnel interactif (phase 4B)

`frontend/` fournit React + TypeScript strict, Vite et React Flow : organisations,
graphe zoomable au clavier/souris, ressources/provenance, brouillons versionnés,
imports JSON, publication confirmée, inspecteur DSL/IR et historique enregistré.
Les relations du canvas sont exactement celles du snapshot ; aucune arête ne crée
d'équation. Les contraintes et résultats restent ceux du backend existant.

Après lancement de l'API sécurisée sur 8001 et provisionnement des exemples suivant
le [guide PowerShell](docs/studio-phase-4b.md), lancer :

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Studio : http://127.0.0.1:5173. Jeton en mémoire uniquement ; rechargement = relogin.
Le proxy appelle l'API sécurisée. Aucun calcul depuis le navigateur, scénario
avancé ou LLM n'est introduit. Les positions restent locales ; les
équations sont inspectables dans les modèles persistés et l'IR canonique.

## Fondations de persistance et de gouvernance (phase 4A)

`brain/platform/` ajoute PostgreSQL, migrations Alembic, comptes Argon2id,
sessions révocables, appartenances et rôles par organisation. Les graphes et
modèles ont une publication authentifiée et un contenu immuable ; les résultats
historiques et l'audit restent append-only. Les contrats API sont versionnés et
décrits dans OpenAPI, avec isolation applicative et RLS PostgreSQL sur les artefacts.

Lancer cette application avec `python -m uvicorn brain.platform.api:create_app --factory`
après la [configuration et les migrations](docs/platform-phase-4a.md).
L'application legacy `brain.api:app` reste une démonstration locale séparée,
sans authentification. Les snapshots SQLite de Phase 3 et le Brain hors ligne
restent disponibles. La Phase 4C ajoute une file PostgreSQL et un worker autonome :
`python -m brain.platform.worker`. Son API sécurisée est consommée par
l'Optimization Center React ; l'API legacy anonyme reste séparée.

## Composition multi-départements (phase 3)

`brain/organization/` assemble un graphe typé et des fragments indépendants vers
**un seul** modèle mathématique. Les variables sont déclarées par un propriétaire,
importées explicitement par les autres départements, et les consommations d'une
ressource partagée sont additionnées dans une seule contrainte de capacité.
Les arêtes informatives n'inventent pas d'équations. Le solveur/vérificateur de
phase 2 sont réutilisés sans modification de leur logique ni de leurs tolérances.

```powershell
python -m brain.organization solve examples/organizations/factory/project.json --store local_store/phase3 --output results/organization_factory.json --mermaid results/organization_factory.mmd
python -m brain.organization solve examples/organizations/university/project.json --store local_store/phase3 --output results/organization_university.json --mermaid results/organization_university.mmd
python -m brain.organization replay --store local_store/phase3 --organization synthetic_factory --model demo_cross_department --version 1.0.0 --output results/organization_factory_replay.json
```

Les projets séparent graphe et fichiers de départements. Les snapshots SQLite
embarqués conservent la source complète, DSL, IR, traces et runs avec checksums,
transactions atomiques et refus d'écrasement des versions publiées localement.
Le résultat industriel reste 40/15 et 4100 EUR ; le cas universitaire synthétique
sélectionne mathématiques + sciences, score 17, budget et créneaux saturés.
Les rapports JSON/Mermaid montrent dépendances, propriétaires et utilisations
recalculées sur les décisions brutes vérifiées. Aucun frontend, RBAC ou worker n'est ajouté.

## Démarrage du kernel et contrôles

Depuis ce dossier dans PowerShell, avec Python 3.11 ou supérieur :

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python -m brain.kernel validate examples/demo_cross_department.json --output results/demo_ir.json
python -m brain.kernel verify examples/demo_cross_department.json --plan examples/golden_plan.json
python -m brain.kernel validate examples/generic_allocation.json
python -m brain.kernel solve examples/demo_cross_department.json --output results/golden_solve.json
python -m pytest -q
python -m ruff check brain tests
python -m ruff format --check brain/kernel brain/solvers brain/organization tests/test_kernel.py tests/test_generic_solver.py tests/test_organization.py
python -m mypy
```

Sans activation, remplacer `python` par `.\.venv\Scripts\python.exe`.
Le plan golden fourni est réalisable et vaut **4100 EUR**. Le test exhaustif
confirme l'unique optimum `qty_A=40`, `qty_B=15`. La commande de vérification
contrôle ce plan et ses marges ; elle n'exécute aucun solveur et ne déclare pas
elle-même d'optimalité. Les exemples sont synthétiques. Aucun LLM requis.
La commande `solve` appelle HiGHS, puis vérifie les décisions et l'objectif sans
arrondir les valeurs natives. Un statut OPTIMAL reste « optimal à tolérance près ».
Les conversions non exactes en binary64 empêchent de certifier l'optimum du modèle
rationnel original ; les bornes/gaps absents restent null. Voir le contrat solveur.
Le [schéma JSON](docs/model-dsl.schema.json) se régénère avec
`python -m brain.kernel schema --output docs/model-dsl.schema.json`.

Les commandes suivantes décrivent le **MVP historique**, conservé sans changement
de ses équations. L'API reste une démonstration locale sans authentification.

**Principe non négociable : le Brain ne dépend pas du LLM.** Le LLM est une couche facultative qui transforme une intention métier en propositions de paramètres et explique un résultat vérifié. Il ne choisit pas les valeurs optimales, ne contourne pas les contraintes et ne peut pas exécuter des actions de manière autonome.

## Ce que le prototype fait réellement

Il optimise en une seule résolution des décisions prises par les départements **Ventes**, **Production**, **Finance**, **Logistique** et la capacité **RH**. Il arbitre entre :

- quantités à fabriquer par produit (entiers),
- quantités à sous-traiter (entiers),
- quantités à livrer (entiers),
- activation des lignes de production avec coût de mise en route (binaires),
- heures machine supplémentaires (entiers).

Il respecte les contraintes métier obligatoires : demande, minimum à livrer, stock initial, capacité machine, capacité humaine, capacité logistique, budget, limites de sous-traitance et heures supplémentaires. Les résultats sont **revérifiés indépendamment du solveur**.

**Limitation importante :** toutes les données sont fictives ; un seul horizon de planification ; coûts et revenus linéaires ; stock initial supposé déjà financé ; pas d'incertitude ni d'ordonnancement détaillé. Ce n'est pas encore un moteur universel, ni une preuve de gains en entreprise réelle.

## Installation Windows / VS Code (PowerShell)

```powershell
# Ouvrir PowerShell dans le dossier contenant ce README.
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m brain.demo
python -m pytest -q
```

> Si l'activation PowerShell est bloquée, utilisez directement `.\.venv\Scripts\python.exe -m brain.demo`.

## API locale (facultative)

```powershell
python -m uvicorn brain.api:app --reload
```

Consulter `http://127.0.0.1:8000/docs` et la route `POST /optimize` ; envoyer `{"scenario": <objet scenario>}` en reprenant l'objet `scenario` dans `examples/factory.json`. L'API ne fait aucun appel à un LLM.

Les nouvelles routes `POST /api/v1/models/validate` et `POST /api/v1/models/solve`
acceptent `{"model": <DSL>}` ; la résolution accepte aussi `settings` facultatif.
Elles sont synchrones pour le client, sans worker ni authentification ; elles
préservent le contrat legacy. Exemples complets dans [docs/API.md](docs/API.md).

## Modèle mathématique

Pour chaque produit `i`, variables :

- `q_i` : fabrication (entier >=0),
- `o_i` : sous-traitance (entier >=0),
- `s_i` : livraison (entier >=0),
- `y_i` : ligne activée (binaire),
- `t` : heures machine supplémentaires (entier >=0).

Objectif : **maximiser le profit net de la période** :

```text
max Σ_i [(prix_i - cout_livraison_i) * s_i
          - cout_fabrication_i * q_i
          - cout_soustraitance_i * o_i
          - cout_activation_i * y_i]
    - cout_heure_sup * t
```

Contraintes :

```text
min_commande_i <= s_i <= demande_i       (Ventes)
s_i <= q_i + o_i + stock_i               (Stock / flux)
q_i + o_i <= s_i                         (Pas de fabrication inutilisée)
q_i <= demande_i * y_i                   (Activation de ligne)
o_i <= capacite_soustraitance_i          (Fournisseurs)
Σ_i heures_machine_i * q_i <= capacité_machine + t       (Production)
Σ_i heures_RH_i * q_i <= capacité_RH                       (RH)
Σ_i charge_logistique_i * s_i <= capacité_logistique     (Logistique)
Σ_i (cout_fabrication_i*q_i + cout_soustraitance_i*o_i
     + cout_livraison_i*s_i + cout_activation_i*y_i)
     + cout_heure_sup*t <= budget                         (Finance)
Σ_i s_i >= engagement_global                             (Ventes)
0 <= t <= limite_heures_sup
```

Résolution avec [`scipy.optimize.milp`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html), interface SciPy au solveur **HiGHS**. Statuts `optimal`, `infeasible` et `feasible_not_proven_optimal` sont distincts. Un plan ne doit jamais être qualifié d'optimal si le solveur n'a pas prouvé l'optimalité.

## Exécuter une simulation

```powershell
python -m brain.demo
```

Le script affiche les KPI, allocations et contraintes saturées, puis relance l'optimiseur sous plusieurs conditions (`+15 heures machine`, `+1500 EUR de budget`, `+10 charges logistiques`, objectif de `82 unités livrées`). Sortie JSON enregistrée dans `results/sample_results.json`.

**Résultat avec l'exemple livré :** le plan initial réalisable donne 4620 EUR de profit et 50 livraisons ; le plan optimisé prouvé donne 6840 EUR et 81 livraisons. L'amélioration ne prouve rien pour une entreprise réelle, car le plan initial a été construit pour la démonstration.

## Contrat LLM / Brain

```text
USER / DONNÉES MÉTIER -> LLM (optionnel) -> JSON PROPOSÉ
-> validation stricte des champs (autorisations et provenance à ajouter)
-> modèle mathématique versionné -> solveur -> vérification indépendante
-> résultat JSON avec statut + mesures -> LLM (optionnel) pour explication
```

Le champ de type `"ignore_constraints"` sera rejeté. Un LLM ne peut pas inventer une capacité ou une règle cachée : les paramètres doivent provenir d'une source métier validée. Aucun appel LLM n'est inclus dans ce dépôt.

## Structure

```text
optimization_brain_mvp/
├── brain/
│   ├── __init__.py
│   ├── models.py        # contrats, validation et vérification indépendante
│   ├── optimizer.py     # modèle MILP, solveur, statuts du solveur
│   ├── diagnostics.py   # contraintes saturées et marges
│   ├── demo.py          # démonstration multi-scénarios
│   ├── api.py           # interface REST facultative
│   ├── kernel/          # DSL, unités, IR, compilateur, vérification et CLI
│   ├── solvers/         # contrats, HiGHS sparse, orchestrateur, routes de phase 2
│   └── organization/    # graphe, fragments, composition, rapports, snapshots et CLI
├── examples/
│   └── factory.json     # données fictives et plan initial
├── results/
│   └── sample_results.json
├── tests/
│   └── test_solver.py
├── requirements.txt
└── README.md
```

## Suite du développement

La [roadmap](docs/roadmap.md) suit désormais les phases de la spécification.
Les phases 3, 4A, 4B et 4C sont livrées. Le centre 4C lance, suit et annule les
jobs autorisés et consulte leurs résultats historiques vérifiés. La
[Phase 5A](docs/constraint-diagnostics-phase-5a.md) ajoute des diagnostics exacts
et incomplets, accessibles en lecture seule dans le Studio et l'API sécurisée.
La [première tranche de 5B](docs/scenario-lab-phase-5b.md) permet de créer des
scénarios identiques et isolés, avec provenance et publication explicite avant
résolution. La [tranche 5B-2](docs/controlled-scenarios-phase-5b2.md) ajoute les
changements numériques sous politiques publiées, accords de responsables,
prévisualisation et nouveaux graphes/modèles DRAFT. Les comparaisons, gains et
analyses de sensibilité restent à construire.
La Phase 5C, le LLM et les optimisations avancées restent hors périmètre.

La [fondation UX-F1](docs/validation-ux-f1.md) ajoute navigation responsive,
catalogue d'organisations et modes de présentation métier/expert. Les pages et
leurs permissions restent disponibles aux URL existantes. Le
[guide E2E isolé](docs/ux-f1-e2e-isolation.md) décrit le lancement des tests sur une
base PostgreSQL dédiée, sans purge de la démonstration :

```powershell
python -m scripts.studio_e2e --env-file .local/e2e.env
# Studio interactif E2E sur 5181, API sur 8002 ; arrêt par Ctrl+C
python -m scripts.studio_e2e --env-file .local/e2e.env --serve
```

Le fichier privé contient uniquement les URLs E2E et, facultativement, son
mot de passe synthétique. Aucun secret ni base de démonstration ne doit être
utilisé pour ces tests. Le lancement de démonstration existant reste décrit dans
[le guide Studio](docs/studio-phase-4b.md).

**Règle de conception :** benchmarker et prouver l'apport de chaque couche algorithmique avant de l'ajouter. Un algorithme complexe n'est utile que s'il améliore la qualité, la vitesse de résolution, la robustesse ou l'explicabilité.
