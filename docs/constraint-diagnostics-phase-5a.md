# Phase 5A — Constraint Diagnostics

## Périmètre livré

Module universel hors ligne, sans LLM ni nouveau solveur. Les interfaces legacy,
le compositeur organisationnel, HiGHS et le vérificateur sont conservés.
Le diagnostic n'assouplit et ne réécrit aucune contrainte HARD.

```python
from brain.constraint_diagnostics import diagnose, diagnose_model
from brain.organization import compose_organization_model
from brain.organization.project import load_organization_file

source = load_organization_file("examples/organizations/factory/project.json")
composition = compose_organization_model(source)
report = diagnose(
    composition.ir,
    traces=composition.constraint_traces,
    composition_manifest_hash=composition.manifest_hash,
)
print(report.model_dump_json(indent=2))
# Pour une entrée DSL susceptible d'être invalide : diagnose_model(raw_dsl).
```

L'exemple ne résout pas le modèle. Un plan facultatif peut être donné à `diagnose`
via `decisions`, `solver_objective`, `verification_settings` et `solver_status`.
Les statuts passés directement à cette fonction sont des déclarations de l'appelant,
pas des certifications. Dans l'API, ils proviennent uniquement d'un run enregistré
par le pipeline interne autorisé ; aucune saisie publique de résultat n'est ajoutée.

## Lire le rapport

| Champ | Signification et garantie |
|---|---|
| `validation=INVALID_MODEL` | Rejet du DSL ou du compilateur ; code et chemin, référence ou variable concernée si disponible. Ce n'est pas un statut solveur. |
| `ROW_OUTSIDE_BOUNDS` | Une ligne ne peut être satisfaite dans l'intervalle exact de ses variables, ou une constante contredit son RHS. |
| `PARALLEL_ROWS_CONTRADICTION` | Deux lignes proportionnelles imposent un intervalle vide à la même expression normalisée. |
| `static_conclusion=NO_CONCLUSION` | Aucune preuve parmi celles implémentées ; aucune conclusion de faisabilité. |
| `infeasibility_evidence=SOLVER_REPORTED` | Le solveur a déclaré INFEASIBLE, sans cause statique démontrée ici. |
| `plan_valid` | Nouvelle vérification indépendante du plan, domaines et objectif inclus ; `null` sans plan. Aucun certificat d'optimalité. |
| `activities` | Mesures rationnelles et tolérance par ligne ; SATISFIED, SATURATED, VIOLATED ou UNAVAILABLE. |
| `cost_status=NOT_EVALUATED` | Aucun coût d'opportunité calculé ; SATURATED ne signifie pas COSTLY. |
| `iis_available=false` | Aucun IIS fourni, aucun conflit minimal revendiqué. |

Les contraintes conservent département, source/version/approbation déclarée,
fragments, contributions, paramètres, ressource et chemins de provenance lorsque
le compositeur les fournit. L'approbation déclarée dans la source n'est pas une
publication authentifiée. Une variable a un département mais n'a pas d'objet de
provenance individuel dans le DSL actuel : ne pas lui en inventer un.

La tolérance absolue des lignes est celle du vérificateur, dans l'unité numérique
de chaque ligne IR. L'unité est exposée par dimensions et échelle rationnelle
(`time`, échelle `1/60` pour les minutes). Aucune conversion ni arithmétique de
preuve n'est faite dans le navigateur. Les différences exactes minuscules ne
sont pas masquées : voir [ADR 0008](decision-records/0008-exact-read-only-constraint-diagnostics.md).

## API et Studio

Sur l'application sécurisée `brain.platform.api:create_app` :

```text
GET /api/v1/organizations/{org}/model-versions/{id}/diagnostics
GET /api/v1/organizations/{org}/optimization-runs/{id}/diagnostics
```

Bearer en mémoire et membre actif requis : ADMIN, BUILDER, APPROVER ou VIEWER.
HTTP 401 sans session ; 404 pour une ressource absente, étrangère ou une adhésion
révoquée ; 409 si l'intégrité ou la reconstruction historique échoue.
Réponses `Cache-Control: no-store`. Les modèles DRAFT sont consultables selon
les permissions existantes. Les documents invalides ne peuvent pas être créés
via l'API : leur diagnostic détaillé reste disponible par `diagnose_model` hors ligne.

La réponse `DiagnosticsResponse` lie `id`, `organization_id`, `artifact_kind`,
`content_hash`, `model_version_id`, `model_content_hash` et `report`.
Les rapports ne sont pas persistés et ne changent aucun hash historique.

Dans le Studio : ouvrir un modèle ou un résultat historique, puis **Consulter
les diagnostics**. Affichage des preuves et de leur provenance, tableau des
mesures et limites explicites. Aucun lancement automatique, bouton de relâchement,
recommandation chiffrée de modification, Scenario Lab ou fonctionnalité LLM.
Le guide de déploiement Phase 4C reste applicable sans migration supplémentaire.

## Limites assumées

Analyse suffisante mais non exhaustive ; pas de propagation de bornes entre
lignes, de Farkas général, de recherche de conflits d'intégralité ou d'IIS.
Un rapport peut être non concluant sur un modèle effectivement infaisable.
Pas de sensibilité, de prix d'ombre ou de coûts marginaux, y compris sur LP.
Les lectures recomposent et vérifient le modèle synchroniquement, sans benchmark
sur très grands modèles. Les tolérances enregistrées peuvent accepter un plan
incompatible avec une contrainte au sens rationnel strict ; les preuves exactes
et la vérification numérique demeurent deux champs distincts.
