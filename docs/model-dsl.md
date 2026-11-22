# DSL v1 — Universal Model Kernel (phase 1)

Le kernel valide un problème linéaire borné, le compile en IR et vérifie un plan
fourni. Il fonctionne en local, sans LLM, réseau, SciPy ni serveur HTTP.
Le solveur industriel historique conserve son contrat. Le solveur générique
DSL/IR sera ajouté en phase 2.

## Contrat d'entrée

Le [schéma JSON généré](model-dsl.schema.json) décrit les champs autorisés.
Les validations sémantiques ci-dessous nécessitent également le compilateur :
un validateur JSON Schema seul ne résout pas les références ni les unités.

Exemples complets exécutables :

- [Allocation générique](../examples/generic_allocation.json), sans vocabulaire sectoriel,
  avec deux variables indexées explicitement.
- [Exemple inter-départements](../examples/demo_cross_department.json), correspondant
  au §7.2 de la spécification, enrichi des identifiants de version/snapshot,
  départements et métadonnées d'approbation obligatoires.
- [Plan golden](../examples/golden_plan.json) fourni pour vérification.

Les données de tous ces fichiers sont synthétiques.

| Objet | Contrat pris en charge |
|---|---|
| Modèle | `schema_version="1.0"`, `id`, `name`, `model_version`, `data_snapshot_id`, `scenario_id` obligatoires |
| Départements | Registre explicite `id`, `name` ; chaque variable/règle référence un département déclaré |
| Dimensions | Dictionnaire facultatif de dimensions vers listes finies de labels distincts |
| Variable | `id`, `type`, `lb`, `ub`, `unit`, `department`, `indices` facultatifs ; bornes finies explicites |
| Paramètre | Registre par identifiant ; `value`, `unit`, `source`, `approved`, `version` |
| Contrainte | `id`, `owner_department`, `kind="HARD"`, `terms`, `operator`, `rhs`, `unit`, provenance |
| Objectif | Une seule entrée ; `sense="MAX"` ou `"MIN"`, `priority` entier positif (défaut 1), termes, unité, propriétaire, provenance |

`currency`, facultatif, sert à l'affichage ; seules les unités de chaque expression
déterminent les dimensions mathématiques. Aucun taux de change n'est supposé.
Les identifiants suivent `[A-Za-z][A-Za-z0-9_]*` (100 caractères maximum).
Les identifiants doivent être uniques dans leur registre ; les clés JSON dupliquées
sont rejetées par le chargeur, y compris dans les objets imbriqués.

Domaines : `CONTINUOUS`, `INTEGER`, `BINARY`. Les bornes d'un domaine discret
doivent être entières ; une binaire est sans dimension (`1`), bornée dans `[0,1]`.
Les bornes négatives et coefficients négatifs sont autorisés.
Les variables indexées sont **développées explicitement** : chaque entrée a son
identifiant stable et ses indices validés dans `dimensions`. Les termes et plans
référencent cet identifiant. Il n'y a pas de générateur `forall`, de somme symbolique,
de produit cartésien implicite ou de dataset à exécuter.

Une expression est une liste de termes `variable`, `coefficient`, `coefficient_unit`.
Les comparateurs autorisés sont `<=`, `>=`, `==`. La liste vide exprime zéro.
Les constantes côté gauche se déplacent explicitement dans le membre droit.
Chaque coefficient, borne ou membre droit est soit un littéral décimal, soit
une référence stricte `{"parameter": "identifiant"}`. Par exemple :

```json
{
  "operator": "<=",
  "rhs": {"parameter": "machine_capacity_hours"},
  "unit": "hour"
}
```

Ce fragment appartient à une contrainte complète. Dans l'exemple livré, il évite
de répéter la capacité 100. Une modification du paramètre est automatiquement
reflétée dans l'IR et son hash. Les références sont autorisées aussi dans les
coefficients et bornes ; leur unité est vérifiée et convertie vers l'unité attendue.

Tous les paramètres et règles doivent porter `approved: true`. C'est une
**déclaration dans un fichier local**, pas une preuve d'identité ou d'approbation
métier : authentification, autorisations et stockage immuable restent futurs.
Ne pas exposer ce kernel ou l'API legacy comme service multi-tenant de production.

## Nombres et unités

Utiliser de préférence des chaînes décimales, par exemple `"0.10"`.
Les nombres JSON sont acceptés ; `load_model_json` conserve les chiffres décimaux
sans passage par un flottant binaire. Pour l'API Python, un flottant déjà arrondi
par l'appelant ne permet pas de retrouver les chiffres d'origine.
Les booléens, `NaN`, infinis, calculs textuels et objets numériques arbitraires
sont refusés. Limites : 128 caractères, 100 chiffres et exposant décimal [-100,100].

L'entrée utilise `Decimal` ; l'IR et l'interpréteur utilisent `Fraction`.
Les additions, produits et conversions de ces valeurs sont rationnels, sans
dépendance au contexte d'arrondi Decimal. Les exports utilisent des chaînes
`"4100"` ou `"1/60"` : une fraction d'IR n'est pas un littéral d'entrée DSL.
Cette exactitude d'évaluation ne constitue pas un certificat d'optimalité.

| Unités atomiques | Dimension / facteur dans l'unité de référence |
|---|---|
| `1`, `percent` | Sans dimension ; 1 et 1/100 |
| `unit` | Quantité comptée |
| `hour`, `minute`, `second` | Temps ; 1, 1/60, 1/3600 heure |
| `kg`, `tonne` | Masse ; 1, 1000 kg |
| `meter`, `km` | Longueur ; 1, 1000 mètres |
| `EUR`, `MAD`, `USD` | Trois dimensions monétaires distinctes |

Grammaire fermée : produits `*`, au plus un `/`, puissances entières de -8 à 8
(zéro exclu), sans espaces ni parenthèses. Tout ce qui suit `/` est au dénominateur :
`kg*meter/second^2` est accepté. `hour/unit × unit` est compatible avec `hour` ;
`EUR/unit × unit` ne l'est pas avec `hour`. Même un terme de coefficient zéro
doit être dimensionnellement valide et référencer une variable déclarée.
La conversion est exacte : un coefficient de `120 minute/unit` vaut `2 hour/unit`.
Les objets Unit exportés contiennent les dimensions triées et leur facteur `scale`.
Les valeurs des lignes restent exprimées dans l'unité déclarée de la ligne.

## Compilation, canonicalisation et erreurs

`compile_model` valide d'abord les schémas, puis les références, approbations,
unités, domaines et bornes. Une erreur Pydantic comporte sa localisation ; une
`ModelCompilationError` expose `issues` avec `path`, `code`, `message`, par exemple
`constraints[0].terms[0].variable / UNKNOWN_VARIABLE`.
Le compilateur s'arrête à la première erreur sémantique.

La compilation résout les paramètres, applique les facteurs d'unités, agrège les
termes répétés, supprime les coefficients résultants nuls, trie les variables,
contraintes et termes par identifiant. Les objets IR sont des dataclasses gelées,
contenant des tuples et des valeurs immuables ; ils ne gardent aucune référence
aux listes/dictionnaires Pydantic d'entrée.

`model_hash` (SHA-256) porte sur la version DSL, les variables (id, domaine, bornes,
unité, indices), les contraintes et l'objectif résolus. L'ordre des déclarations,
les variantes `2`/`2.0`, les libellés, départements et sources n'affectent pas ce hash.
Les paramètres inutilisés n'y participent pas. Les identifiants de version/snapshot
sont conservés séparément dans l'IR. Le hash n'est pas un test général d'équivalence
algébrique : changer les unités déclarées d'une ligne ou renommer un identifiant
peut changer le hash même si le problème mathématique est équivalent.
`manifest_hash` couvre tout le manifeste Pydantic validé, métadonnées et paramètres
inutilisés compris ; conserver également le JSON d'origine pour un audit complet.

Une analyse par intervalles calcule les extrema possibles de chaque ligne dans
les bornes déclarées. Si son intervalle ne peut satisfaire le comparateur, un
avertissement `INFEASIBLE_BY_BOUNDS` est émis. Le modèle reste compilé sans retirer
la contrainte ; l'absence de cet avertissement ne prouve aucune faisabilité.
Les interactions entre contraintes et l'infaisabilité discrète nécessitent un solveur.

## Vérification d'un plan et commandes

Le plan est un objet contenant **exactement** les identifiants de variables :

```json
{"qty_A": "40", "qty_B": "15"}
```

`verify_plan` contrôle les nombres, bornes, domaines, chaque ligne, puis recalcule
l'objectif. Le rapport expose résidus, marges, unités, tolérances, versions et hashes.
Les marges des inégalités sont positives si satisfaites ; pour `==`, la marge
vaut moins l'écart absolu. `violation = max(0, -slack)`.
Les valeurs ne sont jamais arrondies ni réparées. Les trois tolérances Python
`bound_tolerance`, `constraint_tolerance`, `integrality_tolerance` valent zéro par
défaut. Elles sont absolues dans les unités déclarées de chaque variable/ligne ;
la tolérance d'intégralité doit rester strictement inférieure à 0.5.
Une vérification favorable avec tolérance signifie faisable **selon ces tolérances**.
Une vérification défavorable peut encore exposer l'objectif calculé, sans valider le plan.

Depuis la racine (PowerShell, après activation du venv) :

```powershell
python -m brain.kernel validate examples/demo_cross_department.json --output results/demo_ir.json
python -m brain.kernel verify examples/demo_cross_department.json --plan examples/golden_plan.json
python -m brain.kernel validate examples/generic_allocation.json
python -m brain.kernel schema --output docs/model-dsl.schema.json
python -m pytest -q
python -m ruff check brain tests
python -m ruff format --check brain/kernel tests/test_kernel.py
python -m mypy
```

Codes de sortie CLI : 0 succès ; 1 plan refusé ; 2 entrée/compilation/lecture invalide.
La CLI n'émet aucun statut `OPTIMAL`. Les exemples IR et de vérification sont dans
`results/demo_ir.json` et `results/golden_verification.json`.

Le test golden énumère les 41 × 36 = 1 476 plans entiers dans les bornes et compare
leur faisabilité/objectif aux équations de référence indépendantes. Il confirme
l'unique maximum `40,15`, valeur 4100 EUR : machine 95/100, budget 7000/8000,
quantité 55/55. L'énumération appartient aux tests et n'est pas un solveur de production.

## Hors périmètre livré

Pas d'adaptateur solveur générique, de normalisation des statuts/timeout, de preuve
HiGHS attachée à l'IR, de comparaison à un objectif annoncé par un solveur, d'API
DSL, de contraintes souples, multiobjectif, non-linéaire, LLM, base de données ou
approbation authentifiée. Le registre d'unités est volontairement petit et fermé.
L'identifiant de snapshot est requis, mais sa conservation durable reste à construire.
