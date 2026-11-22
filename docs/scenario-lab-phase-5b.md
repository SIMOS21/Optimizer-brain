# Scenario Lab — première tranche de Phase 5B

## Livré et non livré

Créer une copie identique isolée d'une référence publiée, la consulter avec sa
provenance et son historique, publier explicitement son modèle puis la résoudre
dans l'Optimization Center existant. Le modèle, le snapshot et les résultats
de référence restent inchangés. Les exemples sont synthétiques.

Cette tranche **ne livre pas toute la Phase 5B** : aucun paramètre, capacité ou
règle n'est modifiable dans un scénario ; pas de comparaison de résultats, de
gain calculé, d'exécution batch ou de politique de changement encore disponible.
L'[ADR 0009](decision-records/0009-scenario-versions-and-comparison-boundaries.md)
décrit l'architecture, l'audit et les invariants prévus pour ces incréments.
Les Phases 5C et 6 ne sont pas commencées.

## Contrats API

Application sécurisée seulement, sous `/api/v1/organizations/{org}` :

| Route | Comportement |
|---|---|
| `POST /scenarios` | ADMIN/BUILDER crée un clone en DRAFT ; réponse 201, y compris répétition identique |
| `GET /scenarios?limit=50&offset=0` | Historique paginé (limite maximale 100), membres actifs |
| `GET /scenarios/{id}` | Version et provenance vérifiées, membres actifs |

Corps strict de création :

```json
{
  "key": "synthetic_trial",
  "version": "1",
  "name": "Copie de référence",
  "reason": "Vérifier le parcours sans changer les hypothèses",
  "source_model_version_id": "<UUID du modèle publié>",
  "expected_source_content_hash": "<empreinte exacte de la réponse du modèle>"
}
```

Aucun document de modèle ni champ overrides/changes/constraints/author n'est
accepté. L'auteur vient de la session, le tenant de la route vérifiée. Même
clé/version/demande/auteur : même scénario ; collision différente : 409.
Une famille de clé conserve la même référence. 401 sans session, 403 pour un
rôle insuffisant, 404 pour une ressource étrangère/absente, 409 pour une référence
non publiée, une empreinte incompatible ou une incohérence historique, 422 pour
les champs invalides. Aucun PATCH/PUT/DELETE de scénario.

`ScenarioResponse` porte les identités, clé/version, auteur/date, empreinte du
scénario et état actuel de publication du modèle dérivé. Son `document` canonique
`5B.1` contient nom, justification, référence et empreinte, graphe et empreinte,
snapshot, modèle dérivé et empreinte, `scenario_id`, `kind=IDENTICAL_CLONE` et
`changes=[]`. La projection `model_state` peut passer de DRAFT à PUBLISHED ; le
document et son empreinte sont immuables.

Le modèle dérivé utilise une nouvelle ModelVersion. Les équations, unités,
paramètres, bornes, domaines et hash mathématique sont identiques ; seuls
`model_version` et `scenario_id` changent dans la source compilée. Le graphe et
le snapshot de données sont réutilisés car aucune valeur n'est changée.

## Parcours Studio

1. Choisir une organisation puis **Scenario Lab**.
2. ADMIN/BUILDER choisit un modèle publié et saisit clé, version, nom et justification.
3. **Créer la copie isolée** conserve le scénario et son modèle DRAFT atomiquement.
4. Ouvrir le lien **Modèle du scénario** pour inspecter les règles et demander la
   publication. Seuls ADMIN/APPROVER peuvent la confirmer.
5. Dans **Optimization Center**, sélectionner le modèle dérivé publié puis lancer
   le calcul. Les paramètres SolveSettings, l'idempotence, le suivi, les limites
   de processus, l'annulation et le vérificateur 4C restent applicables.
6. Consulter le run historique et retrouver le scénario dans son historique.

Le nom/justification ne sont pas des règles mathématiques. Une copie identique
ne promet pas un vecteur de décisions identique en présence d'optima multiples.
La page n'annonce aucune amélioration, même si un futur réglage résout plus vite.

## Migration et lancement local

Avec l'environnement privé de migration habituel configuré :

```powershell
python -m alembic upgrade head
python -m uvicorn brain.platform.api:create_app --factory --host 127.0.0.1 --port 8001
python -m brain.platform.worker
```

L'API et le worker n'utilisent que `BRAIN_DATABASE_URL` avec le rôle runtime.
`BRAIN_MIGRATION_DATABASE_URL` reste réservé à Alembic. La révision requise est
`0005_5b` ; redémarrer API et workers après migration, sans ancien worker actif
sur le nouveau schéma. La migration est additive et ne recalcule aucun run.
Dans `frontend`, `npm run build` puis `npm run preview` sert le Studio sur 5180,
ou `npm run dev` sur 5173. Les guides 4A/4C restent les références de déploiement.

Un downgrade vers `0004_4c` supprime le registre des scénarios : réservé aux tests
jetables ou à un rollback explicitement préparé et sauvegardé, jamais exécuté
silencieusement sur une base contenant des scénarios à conserver.

## Validation et limites

Tests : création identique, publication obligatoire, champs de modification
interdits, permissions, isolation, RLS sans contexte et sans fuite du pool,
triggers immuables, FK d'auteur, répétition, collision et concurrence, rollback
atomique, corruption et upgrade préservant les payloads existants. Les parcours
réels usine/université utilisent PostgreSQL et le worker et conservent 4100 EUR/17.
Les régressions 4C couvrent encore annulation, infaisabilité et TIME_LIMIT.
Voir [validation-phase-5b-slice-1.md](validation-phase-5b-slice-1.md) pour les
résultats observés, sans attribuer aux tests ignorés une exécution réussie.

Les lectures reconstruisent chaque modèle et son graphe : coût non benchmarké à
grande échelle. Une future évolution de compilation peut provoquer un refus 409
plutôt qu'une réinterprétation silencieuse. Aucun catalogue de snapshots externe,
gain, politique de modification fine ou comparaison mathématique n'est livré ici.
