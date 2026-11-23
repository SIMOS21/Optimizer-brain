# Revue finale — Phase 5B, tranche 1

Référence examinée : `8d8ade1517f4e5a85a17571bf5943fc5d1255435`, branche
`feature/phase-5b-scenario-lab`, base `main` à `b25ca8d`.
AGENTS.md, OPTIMIZATION_BRAIN_SPEC.md, roadmap, guide Scenario Lab, rapport de
validation et ADR 0009 lus intégralement. Revue du diff, des services existants
réutilisés, de la migration et des tests ; exécutions réelles détaillées ci-dessous.

## Bloquants confirmés

### P2 — Une version valide normalisée par le serveur bloquait le parcours React — corrigé

Fichier : `frontend/src/api/client.ts`, `ApiClient.createScenario`.

Reproduction sur le code de référence : saisir la version ` 1 ` puis créer un
scénario. `ScenarioCreate.version` utilise le type `Text` dont Pydantic supprime
les espaces périphériques : le serveur enregistre `1` et répond 201. Le client
comparait cette version à la chaîne brute ` 1 ` et levait « Scénario incompatible
avec la demande de création ». La page considérait la réception incertaine,
verrouillait les champs et proposait de répéter la même demande. Chaque répétition
retrouvait correctement le même scénario côté serveur mais était rejetée à nouveau
par le client. Le parcours valide ne pouvait pas rejoindre son détail directement.

Trois nouveaux cas Vitest ont échoué avant correction sur espaces ordinaires,
U+0085 et U+00A0. Le comportement serveur a été contrôlé directement et via les
API SQLite/PostgreSQL. Le défaut ne changeait aucun calcul ou droit, mais bloquait
la création du point de vue de l'utilisateur malgré sa persistance réussie.

Correction minimale : comparer la version reçue à la version demandée privée de
ses seuls caractères Unicode `White_Space` périphériques. Ne pas utiliser
simplement `String.trim()` : son ensemble diffère de celui du validateur serveur,
notamment pour U+0085 et U+FEFF. U+FEFF reste significatif, et une vraie différence
de version reste refusée. La demande capturée n'est pas modifiée et les répétitions
conservent leur contenu. Aucun changement de schéma, de migration, d'API Python
ou de payload historique n'est introduit.

Non-régressions ajoutées : quatre cas Vitest, un cas API exécuté avec chacun des
deux moteurs, et les deux parcours Playwright existants désormais exécutés avec
une version entourée d'espaces ordinaires/Unicode. Les trois échecs initiaux sont
devenus des succès ; le caractère U+FEFF et les différences de version restent
explicitement testés.

**Aucun blocage restant identifié après ce correctif.** Aucun autre défaut
mathématique, de permission ou d'intégrité reproductible n'a été identifié dans
le périmètre examiné.

## Vérification des dix invariants demandés

| Axe | Éléments examinés et conclusion |
|---|---|
| Immutabilité | `0005_5b` interdit UPDATE/DELETE du scénario par triggers ; le rôle runtime n'a que SELECT/INSERT. Les triggers existants protègent modèles et graphes, DRAFT inclus. Les références ne sont jamais réécrites par la création. |
| RLS et RBAC | Les trois routes dépendent de l'acteur authentifié. Les services vérifient l'adhésion active et les rôles avant lecture/écriture. Requêtes filtrées par tenant, RLS activée/forcée, contexte local à la transaction, références composites organisation/modèles/graphe/auteur. La RLS est une frontière de tenant ; le contexte SQL runtime reste un composant de confiance et l'autorisation utilisateur est applicative. |
| Atomicité | `service.tenant(..., lock=True)`, création du modèle DRAFT, scénario et audits dans une même transaction. Le scope FastAPI `function` termine le commit avant l'accusé de succès. Une faute injectée sur l'audit scénario laisse zéro scénario et aucun modèle dérivé orphelin. |
| Idempotence/concurrence | Hash de la demande validée avec auteur, identité clé/version, référence fixe par famille ; verrou d'organisation et unicités SQL. Répétitions identiques donnent un seul scénario/modèle/audit ; deux contenus concurrents pour une version donnent 201 et 409. Les clés de jobs demeurent distinctes de cette identité de scénario. |
| Clone identique | `_clone` détache le JSON canonique et ne change que `model_version`/`scenario_id`. Les paramètres, contraintes HARD, domaines, unités et objectifs restent identiques. L'égalité du hash mathématique est contrôlée, puis la source entière est comparée en lecture après remplacement des deux seules identités. |
| Scénario/snapshot/run | `scenario_view` contrôle checksums, reconstructions complètes, empreintes et identités des deux modèles, du graphe et du snapshot. La ModelVersion dérivée est unique par scénario dans le tenant. Les jobs/runs portent cette ModelVersion ; `build_report` contrôle modèle, version, manifeste, snapshot et scenario_id puis appelle le vérificateur indépendant avant persistance. |
| Publication | Le clone est DRAFT. La soumission de job sur DRAFT est refusée ; seul ADMIN/APPROVER publie par la route existante. Le worker relit également la publication et les droits. Aucun nouveau chemin de résolution parallèle n'est ajouté. |
| Migration/historiques | Upgrade additive ; comparaisons SQLAlchemy/Alembic et roundtrips SQLite/PostgreSQL exécutés. Un test d'upgrade conserve le payload d'un modèle existant. Le downgrade supprime le registre et n'est pas une opération préservant les scénarios ; il reste réservé aux bases jetables/rollbacks préparés comme documenté. |
| React/tardiveté | Validation de réponse et identité/provenance, capture de la demande, garde immédiate contre double soumission, répétition explicite après réception incertaine. Les composants sont liés au tenant/identité ; `useLoad` masque l'ancien contenu et ignore les réponses obsolètes. Le client contrôle l'abort avant de traiter un 401 et ne stocke pas le jeton durablement. Le défaut de version ci-dessus est corrigé. |
| Régressions mathématiques | Aucun diff de la tranche sur kernel, compositeur, HiGHS, vérificateur ou diagnostics 5A. Le changement worker se limite au contrôle de la révision SQL. La correction de revue ne touche que le contrôle de métadonnée frontend et ses tests. |

## Tests exécutés et résultats

Avant correction : suite Python/PostgreSQL **408 passed, 8 skipped** ; Vitest
**118 passed**. Les trois tests de reproduction ajoutés ont ensuite échoué sur
le client initial. Après correction, nouvelles exécutions complètes :

| Contrôle | Résultat local observé |
|---|---|
| pytest, SQLite et PostgreSQL réel | **410 passed, 8 skipped**, 140,06 s |
| Vitest | **122 passed**, 9 fichiers |
| Scenario Lab Vitest ciblé | **18 passed** |
| Playwright, API/PostgreSQL/worker réels | **32 passed**, 2,0 min |
| Ruff check / format | Réussis ; **59 fichiers** conformes sur les chemins CI |
| mypy strict | Réussi, **41 fichiers sources** |
| TypeScript, build, ESLint | Réussis |

Environnement local : Windows, Python 3.14.3, Node 24.13.0 et PostgreSQL 17.
Les huit skips sont les variantes SQLite des tests de file/RLS qui exigent
PostgreSQL ; leurs variantes PostgreSQL sont exécutées. Les avertissements
anyio/Starlette et du runtime React restent ceux des dépendances.

Les goldens réels restent **4100 EUR** pour l'usine et **17** pour l'université,
avec vérification indépendante. Les parcours antérieurs d'annulation, échec,
INFEASIBLE, TIME_LIMIT, idempotence et changement de tenant passent également.
Les tests destructifs de migrations restent confinés à `optimizer_brain_test`.
Les parcours Studio ajoutent des versions synthétiques sans écraser les références.
Le fichier non suivi `tatus` reste préservé.

La [CI du code de référence](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45084343939)
était verte. Le correctif est poussé sur la même branche ; son workflow est
contrôlé avant le compte rendu final, sans extrapoler les résultats locaux.

## Risques résiduels

- Les consultations recomposent les modèles et les créations parcourent la
  famille de versions : coût non benchmarké sur de gros historiques/modèles.
- La reconstruction échoue volontairement si une future évolution du compilateur
  ne reproduit plus l'artefact ; prévoir une compatibilité de lecture versionnée.
- Les checksums et protections DML ne résistent pas à un administrateur SQL
  capable de désactiver les protections et de réécrire toutes les empreintes.
- Les règles de publication actuelles permettent à ADMIN de publier son propre
  travail ; aucune séparation à quatre yeux supplémentaire n'est revendiquée.

Ce sont des limites du périmètre documenté, pas des défauts supplémentaires
démontrés. Aucune hypothèse, comparaison, gain, sensibilité ou Phase 5C n'est ajouté.

## Recommandation

**Fusion recommandée pour la tranche 1 de 5B avec le correctif de revue**, une
fois les contrôles du commit corrigé validés. Ne pas intégrer le seul commit
`8d8ade1` sans son correctif frontend. Aucune PR n'a été fusionnée automatiquement.
