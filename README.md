> **Développement avec Codex :** lire `AGENTS.md` et `OPTIMIZATION_BRAIN_SPEC.md`. Les phases 0 et 1 sont livrées ; la plateforme complète reste une cible.

# Optimization Brain — MVP conservé et Universal Model Kernel

Le MVP industriel v0.1 reste disponible avec ses routes et ses tests historiques.
La nouvelle bibliothèque `brain/kernel/` ajoute la DSL v1 stricte, les unités,
le compilateur vers une IR immuable et la vérification d'un plan fourni.
Le solveur générique branché sur cette IR appartient à la phase 2 et n'est pas livré.

Documents : [audit initial](docs/audit-phase-0.md), [contrat DSL](docs/model-dsl.md),
[choix algorithmiques](docs/decision-records/0001-universal-kernel.md),
[roadmap réelle](docs/roadmap.md), [résultats de validation](docs/validation.md).

## Démarrage du kernel et contrôles

Depuis ce dossier dans PowerShell, avec Python 3.11 ou supérieur :

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python -m brain.kernel validate examples/demo_cross_department.json --output results/demo_ir.json
python -m brain.kernel verify examples/demo_cross_department.json --plan examples/golden_plan.json
python -m brain.kernel validate examples/generic_allocation.json
python -m pytest -q
python -m ruff check brain tests
python -m ruff format --check brain/kernel tests/test_kernel.py
python -m mypy
```

Sans activation, remplacer `python` par `.\.venv\Scripts\python.exe`.
Le plan golden fourni est réalisable et vaut **4100 EUR**. Le test exhaustif
confirme l'unique optimum `qty_A=40`, `qty_B=15`. La commande de vérification
contrôle ce plan et ses marges ; elle n'exécute aucun solveur et ne déclare pas
elle-même d'optimalité. Les exemples sont synthétiques. Aucun LLM requis.
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
│   └── kernel/          # DSL, unités, IR, compilateur, interpréteur et CLI (phase 1)
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
Prochaine action : phase 2, adaptateur HiGHS générique, résultats traçables et
vérification indépendante des sorties brutes. Gouvernance, base de données,
interface web, LLM et optimisations avancées ne sont pas implémentés.

**Règle de conception :** benchmarker et prouver l'apport de chaque couche algorithmique avant de l'ajouter. Un algorithme complexe n'est utile que s'il améliore la qualité, la vitesse de résolution, la robustesse ou l'explicabilité.
