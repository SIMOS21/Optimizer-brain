# API locale — phase 2

Lancer `python -m uvicorn brain.api:app --reload` sur l'interface locale par défaut.
Les routes `/health` et `POST /optimize` conservent leur contrat industriel historique.
Les nouvelles routes n'exigent aucun LLM. Authentification et multi-tenant restent
hors périmètre : ne pas déployer cette API comme service de production.

## POST /api/v1/models/validate

Corps strict : `{"model": <DSL>}`. Réponse 200 :

```json
{"valid": true, "ir": {"...": "IR canonique"}, "support": {"supported": true, "issues": [], "conversion": {"...": "mesures"}}}
```

Les objets abrégés ci-dessus sont illustratifs. La réponse réelle contient l'IR
et les mesures de conversion complètes. Cette validation ne lance pas le solveur
et n'affirme pas la faisabilité. Une contradiction locale peut figurer en warning.
Schéma invalide, références inconnues, unités incompatibles ou échelles numériques
non supportées donnent 422 avec erreurs localisées ou raisons de rejet.

## POST /api/v1/models/solve

Corps strict : `{"model": <DSL>, "settings": {...}}`. `settings` est facultatif.
Exemple PowerShell :

```powershell
$model = Get-Content -Raw -Encoding utf8 examples/demo_cross_department.json | ConvertFrom-Json
$body = @{ model = $model; settings = @{ time_limit_seconds = 5.0; mip_rel_gap = 0.0 } } | ConvertTo-Json -Depth 30
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/v1/models/solve -Method Post -ContentType application/json -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

Réponse 200 : [résultat normalisé](solver-contract.md). INFEASIBLE, UNBOUNDED,
TIME_LIMIT et les erreurs natives sont des résultats de calcul ; ils restent 200
avec statut explicite et aucune solution inventée. Les entrées invalides donnent 422.
`decision_values` vaut null lorsque la vérification échoue ou qu'aucun plan n'existe.

Les deux nouvelles routes préservent les décimaux avant Pydantic et rejettent les
clés JSON dupliquées, NaN, Infinity et champs inconnus. Les erreurs ne renvoient pas
les valeurs problématiques. L'OpenAPI `/docs` décrit les schémas des deux requêtes.
La réponse reste synchrone ; le calcul utilise le pool de threads du serveur.
Aucun job persistant, annulation ou route d'approbation n'est introduit en phase 2.
