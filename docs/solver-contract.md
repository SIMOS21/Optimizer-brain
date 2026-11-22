# Generic Solver & Verification Engine — phase 2

Le moteur générique est une bibliothèque Python hors ligne. Il traite un objectif
linéaire unique, variables continues/entières/binaires, comparateurs <= / >= / ==,
sur l'IR immuable du kernel. Il utilise le backend SciPy/HiGHS déjà présent.
Les [choix et garanties numériques](decision-records/0002-highs-numerics-and-verification.md)
font partie du contrat.

## Utilisation

Depuis la racine, après installation/activation du venv :

```powershell
python -m brain.kernel solve examples/demo_cross_department.json --output results/golden_solve.json
python -m brain.kernel solve examples/generic_allocation.json --time-limit 5 --mip-rel-gap 0
```

Le golden est résolu par HiGHS et revérifié : qty_A=40, qty_B=15, objectif 4100 EUR.
La commande retourne 0 si un plan vérifié est disponible (y compris après timeout),
1 sans plan pour une terminaison mathématique/limite/inconnue, 2 pour modèle invalide,
erreur ou échec de vérification. Lire impérativement le statut JSON pour savoir si
l'optimalité a été attestée. Les commandes validate/verify/schema restent disponibles.

```python
from pathlib import Path
from brain.solvers.orchestrator import SolverOrchestrator
from brain.solvers.contracts import SolveSettings

result = SolverOrchestrator().run(
    Path("examples/demo_cross_department.json").read_text(encoding="utf-8"),
    SolveSettings(time_limit_seconds=5.0, mip_rel_gap=0.0),
)
artifact = result.to_dict()
```

Une instance Pydantic ou un dictionnaire DSL peuvent remplacer le texte JSON.
Le texte JSON est recommandé pour préserver les décimaux et rejeter les clés dupliquées.
`SolverOrchestrator` accepte un `SolverAdapter` injecté ; l'adaptateur ne dépend
d'aucun vocabulaire sectoriel. L'IR n'est pas une entrée externe désérialisable :
le point d'entrée public compile toujours la DSL validée.

## Statuts et qualification

| `status` | Sens | `public_status` cible |
|---|---|---|
| OPTIMAL | Attestation native et solution vérifiée ; tolérances, conversions exactes d'entrée | OPTIMAL |
| FEASIBLE | Témoin vérifié, preuve insuffisante pour le modèle original | FEASIBLE_NOT_PROVEN_OPTIMAL |
| INFEASIBLE | Backend déclare le modèle infaisable, sans témoin | INFEASIBLE |
| UNBOUNDED | Backend déclare le problème non borné | UNBOUNDED |
| TIME_LIMIT | Limite de temps explicitement identifiée ; témoin éventuellement disponible | FEASIBLE_NOT_PROVEN_OPTIMAL ou TIME_LIMIT_NO_SOLUTION |
| UNKNOWN | Statut inconnu/ambigu ou portée de la preuve insuffisante, sans témoin publié | UNKNOWN |
| INVALID_MODEL | Schéma/sémantique ou politique numérique non supportée | INVALID_MODEL |
| ERROR | Exception native ou résultat contradictoire/incomplet | SOLVER_ERROR |
| SOLUTION_FAILED_VALIDATION | Témoin ou objectif annoncé rejeté | SOLUTION_FAILED_VALIDATION |

Le champ `termination_reason` conserve la cause native même quand la qualification
change (par exemple `optimal` natif → FEASIBLE après conversion non exacte).
Le moteur ne dit jamais « optimum exact ». Un plan valide ne prouve pas à lui seul
l'optimalité. Si des nombres d'entrée sont arrondis en binary64, une déclaration
native d'infaisabilité/non-bornitude est dégradée en UNKNOWN pour le modèle original.

## Résultat et métriques

`results/golden_solve.json` est un résultat réel exporté dans l'environnement local.
Les nombres calculés exactement sont des chaînes rationnelles comme dans l'IR.
Les décisions natives restent des nombres JSON binary64, sans arrondi en entier.
Une valeur `40.0` d'une variable entière est conservée ; une valeur proche d'un entier
reste proche de cet entier et expose son résidu d'intégralité.

Les champs comprennent :

- run_id, model_id/version, data_snapshot_id, scenario_id, model_hash, manifest_hash ;
- solver_name/version, interface_name/version, solver_status_raw/message ;
- solver_options réellement transmises et backend_defaults inspectés ;
- started_at UTC, duration_ms (compilation/support/résolution/vérification inclus) ;
- decision_values et objective_value **seulement si le témoin est validé** ;
- objectif natif, meilleure borne native, gap relatif natif, gap absolu dérivé ;
- périmètre binary64 des gaps, certificat/statut à tolérance près, paramètres du vérificateur ;
- validation_report, résidus, conversion_report, warnings et audit_actor_id null en local.

Les champs indisponibles sont null. Les LP n'exposent pas toujours de borne/gap via
SciPy milp : aucun zéro n'est fabriqué. Le gap absolu utilise objectif natif et borne,
pas un objectif recalculé arrondi. Les rapports détaillent les écarts entre les deux
objectifs. Les métriques natives ne constituent pas une preuve rationnelle externe.

## Vérification et options

`SolutionVerifier` peut être utilisé indépendamment : il travaille sur l'IR originale,
contrôle les valeurs binaires exactes reçues et les domaines/bornes/contraintes,
puis compare les objectifs. Il ne contacte aucun service et ne relance aucun solveur.
Les entrées du solveur et ses sorties ne sont jamais corrigées silencieusement.

Les options autorisées sont exclusivement `time_limit_seconds` (0,300], `mip_rel_gap`
[0,1], `presolve` booléen, `node_limit` entier [0,2^31-1] ou null et `verification`.
Les tolérances du vérificateur sont indépendantes des options natives. Leurs valeurs,
plafonds et unités sont décrits dans l'ADR 0002. Aucune option HiGHS libre n'est acceptée.

## Limites explicites

La politique numérique rejette les coefficients trop petits ou les nombres trop grands.
La détection de mauvais conditionnement reste partielle. Les marqueurs d'approbation
et ids de snapshots sont déclaratifs ; aucun historique durable, RBAC, annulation,
limite mémoire de worker, multiobjectif ou action métier n'est implémenté.
Le moteur reste un outil local de développement, sans revendication de sécurité SaaS.
