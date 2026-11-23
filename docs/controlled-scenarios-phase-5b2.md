# Phase 5B-2 — Hypothèses contrôlées

Le Scenario Lab sait créer un nouveau scénario à partir d'une référence publiée
avec des valeurs explicitement autorisées par une politique approuvée. La
référence, le parent et les anciens résultats restent immuables. Les exemples
usine et université restent synthétiques. Architecture et limites :
[ADR 0010](decision-records/0010-controlled-scenario-policies.md).

## Parcours Studio

1. Dans Scenario Lab, ouvrir **Nouvelle politique de changement**, choisir la
   référence publiée et une cible du catalogue serveur.
2. Saisir clé/version, motif, domaine et bornes. L'unité est fixée par la
   référence. Choisir le département/responsable lorsqu'ils ne sont pas déjà
   déterminés et cocher explicitement les délégataires.
3. Créer la politique DRAFT. Chaque responsable nommé donne son accord sur les
   règles complètes ; un ADMIN/APPROVER publie ensuite la politique.
4. Choisir cette politique publiée et utilisable. Saisir identité et justification
   du scénario, source et valeurs proposées. Une case vide conserve la valeur
   héritée ; aucune contrainte ne peut être supprimée ou modifiée directement.
5. Prévisualiser : le serveur contrôle droits, unités, domaine et plages puis
   recompile. Il renvoie valeurs de référence, précédentes et proposées,
   provenance et contraintes concernées. Cette étape ne lance pas HiGHS.
6. Confirmer la création. Le nouveau graphe, modèle et scénario sont enregistrés
   atomiquement en DRAFT. En cas de réponse incertaine, réessayer la même demande.
7. Depuis le détail du scénario, inspecter et publier le nouveau graphe, puis
   le modèle, avec les confirmations habituelles ADMIN/APPROVER.
8. Dans Optimization Center, exécuter le modèle publié. Worker, limites,
   annulation, idempotence et vérificateur indépendant restent ceux de 4C.

La révocation d'un responsable ou du publieur bloque l'usage futur ; l'historique
reste lisible et inchangé. Le serveur est l'autorité, même si la liste des
politiques affichée avant révocation n'a pas encore été actualisée.
`usable` décrit la validité actuelle des autorités de la politique ; chaque
acteur doit en plus disposer de la délégation explicite sur les règles utilisées.

## API sécurisée

Préfixe `/api/v1/organizations/{org}`. Toutes les routes exigent un membre actif
du tenant. Permissions supplémentaires indiquées ci-dessous.

| Route | Contrat et permission |
|---|---|
| `GET /model-versions/{id}/scenario-targets` | Catalogue de cibles typées de la référence publiée, valeurs/unités/responsabilité et impact |
| `POST /scenario-change-policies` | `ChangePolicyCreate`, ADMIN/BUILDER, création DRAFT idempotente par clé/version/auteur/document |
| `GET /scenario-change-policies` | Historique paginé, `limit <= 100`, `offset` explicite |
| `GET /scenario-change-policies/{id}` | Document immuable, accords, publication et disponibilité actuelle |
| `POST /scenario-change-policies/{id}/owner-approval` | Hash attendu, responsable nommé actif seulement |
| `POST /scenario-change-policies/{id}/publish` | Hash attendu et accords, ADMIN/APPROVER |
| `POST /controlled-scenarios/preview` | `ControlledProposal`, ADMIN/BUILDER explicitement délégué |
| `POST /controlled-scenarios` | `ControlledCommit` avec proposition complète et hash de prévisualisation attendu, même délégation |
| `GET /scenarios` et `GET /scenarios/{id}` | Anciens clones `5B.1` et scénarios contrôlés `5B.2`, union discriminée par `kind` |

Exemple de règle synthétique sur une capacité (les UUID et hashes viennent des
lectures sécurisées, jamais de l'exemple) :

```json
{
  "id": "delivery",
  "target": {
    "kind": "RESOURCE_CAPACITY",
    "resource_id": "logistics_resource",
    "parameter_id": "delivery_capacity_units",
    "path": "shared_parameters.delivery_capacity_units.value"
  },
  "operation": "SET",
  "unit": "unit",
  "domain": "INTEGER",
  "minimum": "40",
  "maximum": "70",
  "owner_department": "logistics",
  "owner_user_id": "<responsable du registre>",
  "allowed_user_ids": ["<délégataire explicite>"],
  "approval": "OWNER_ACK_AND_PUBLICATION"
}
```

Une proposition nomme la politique et son hash, la référence et son hash,
clé/version/nom/motif du scénario et éventuellement un parent publié. `changes`
contient `rule_id`, `operation=SET`, `unit`, `value` décimal textuel et `source`.
La confirmation contient `proposal` et `expected_preview_hash`. Les champs non
attendus, unités différentes, paramètres sans règle, plages ou domaines invalides
sont refusés. Aucun JSON Patch, expression ou chemin arbitraire.

Le document contrôlé conserve auteur, référence et parent, politique et hash,
empreintes du modèle/graphe, nouveau snapshot, hash de prévisualisation et
changements cumulés avec valeurs originale/précédente/proposée et provenance.
Le hash mathématique couvre les équations recomposées ; il peut rester identique
pour un SET de même valeur. Les empreintes d'audit restent distinctes.

401 sans session, 404 pour objet absent/étranger, 403 pour rôle/délégation ou
autorité révoquée, 409 pour état/empreinte/idempotence incompatibles, 422 pour
contrat/unité/domaine/plage invalide. Les erreurs fermées de changement portent
`detail.code` (par exemple `CHANGE_OUT_OF_RANGE` ou `POLICY_AUTHORITY_REVOKED`).
Les erreurs génériques existantes restent compatibles. Aucun corps arbitraire
de réponse serveur n'est affiché comme message d'erreur dans React.

## Migration et exécution

Sauvegarder la base, arrêter API/worker anciens, puis avec le rôle de migration :

```powershell
python -m alembic upgrade head
```

Révision requise : `0006_5b2`. Migration additive, sans réécriture de modèle,
graphe, scénario ou run existant. Démarrer ensuite API et worker avec le seul
`BRAIN_DATABASE_URL` runtime, sans variables de migration dans les processus :

```powershell
python -m uvicorn brain.platform.api:create_app --factory --host 127.0.0.1 --port 8001
python -m brain.platform.worker
```

Dans `frontend`, `npm run build` et `npm run preview` (5180), ou `npm run dev`
(5173). Contrat : `python -m scripts.export_studio_contract`, puis dans frontend
`npm run generate:types`. Les commandes et protections 4A/4C restent applicables.

Un downgrade de `0006_5b2` supprime politiques, accords et liens : réservé aux
bases de test jetables ou à un rollback préparé et sauvegardé. Ne pas rétrograder
une base contenant des scénarios contrôlés à conserver.

## Limites

SET numérique uniquement ; une règle par politique créée dans le Studio, jusqu'à
50 via API. Pas de paramètre multi-propriétaires de ressources. Parent par UUID,
profondeur maximale 16. Deux actes d'approbation/publication, sans obligation de
deux personnes distinctes. Pas de révocation dédiée de politique ; les autorités
vivantes sont revérifiées. Pas de comparaison, gains, sensibilité, 5C/6 ou LLM.
Les propriétés de faisabilité/optimalité viennent exclusivement du résultat réel
et de sa vérification, jamais de la politique ou de React.
