# Optimization Brain — Plan d'intégration UX/UI V2

**Statut : conception approuvée en principe, aucun changement de code effectué par ce livrable.**

## 0. Référence de travail et prérequis

- Projet : `SIMOS21/Optimizer-brain`.
- Vérification GitHub du 23 novembre 2026 : `main` à `37916611940d6cf4dabc932a3c3b6553937f76e1` ; PR **#6** `feature/phase-5b-controlled-scenario-changes` ouverte à `477a22b070aa6e50bf993759fe8987957d9d3f52`.
- **Ne pas démarrer la réécriture V2 sur `main` tant que la PR #6 n'est pas intégrée et que la CI de fusion n'est pas verte.** Ne pas fusionner soi-même.
- Préserver le fichier local non suivi `tatus`, l'intégralité des historiques et les données de démonstration.
- Les fichiers `OptimizationBrain_UX_V2.html` et `OptimizationBrain_UX_V2_Specification.md` sont des **références de conception**. Le HTML est un simulateur hors ligne, pas du code à injecter tel quel dans React.

## 1. Vision produit validée

Une seule interface React, deux niveaux d'explication :

- **Métier par défaut** : compréhension, actions permises, synthèses et ressources ; pas de DSL/IR/JSON bruts affichés en priorité.
- **Expert sur demande** : les mêmes artefacts enrichis de DSL, IR, provenance, hashes, solveur, diagnostics, vérification, règles d'approbation et JSON secondaire.
- Le mode expert est uniquement une **préférence d'affichage**, jamais une permission RBAC. Toute lecture ou mutation reste validée par l'API, les memberships, les délégations, RLS et les états publiés.
- Aucune valeur d'objectif, capacité, consommation, marge ou gain n'est calculée par la couche de présentation. La V2 affiche uniquement des données validées provenant d'artefacts réels, et le cas échéant des états vides.

## 2. Architecture d'information cible

| Destination métier | But, parcours premier | Destination expert |
|---|---|---|
| **Tableau de bord** `/organizations/:org` | Situation, dernier run vérifié, objectifs, ressources, actions permises | Panneau provenance et identité du run |
| **Mon organisation** `/organizations/:org/graphs` et détail `graphs/:id` | Carte des départements, ressources et fiches cliquables | Editeur/inspecteur du graphe, relations typées, JSON |
| **Optimisation** `/organizations/:org/execution/:jobId?` | Sélection d'un modèle publié, lancement et suivi fiable | SolveSettings, job/process, avertissements et traçabilité |
| **Scénarios** `/organizations/:org/scenarios/:id?` | Parcours guidé sous politique de changement publiée | Cibles, délégations, preview hash, références, JSON |
| **Décisions & historique** `/organizations/:org/history/:id?` | Runs, plan vérifié, contraintes et ressources, états mathématiques | Résidus, gaps, tolérances, IR et documents canoniques |
| **Administration / Modèles** : routes existantes | Seulement actions réelles autorisées | Edition du modèle, approbations, audit existants |

Préserver les liens profonds, les routes publiques existantes dans l'application authentifiée, le contrôle session et les tests E2E. Prévoir une redirection compatible si une route change.

## 3. Composants à réutiliser vs adapter

- **Réutiliser** : `frontend/src/api/client.ts` + contrats OpenAPI générés, `useLoad` et ses gardes d'identité, `Publish`, `JobMonitor`, `ExecutionPanel`, `ConstraintDiagnostics`, `ModelInspector`, `GraphEditor`, `ScenarioLab` et `ControlledScenarios`, moteurs de validations et serveur existant.
- **Refactorer** : `frontend/src/app/App.tsx` (`SignedIn`, organisation picker), `features/organizations/Workspace.tsx` (actuellement un gros point d'entrée, charge organisation + départements + graphes + modèles + runs avant de rendre chaque route), `features/graph/GraphCanvas.tsx` + `projection.ts`, `features/execution/DecisionCockpit.tsx`, `features/history/History.tsx`, `frontend/src/style.css` (tokens et styles composant).
- **Ajouter** : `app/AppShell.tsx`, `app/Navigation.tsx`, `features/dashboard/Dashboard.tsx`, `features/organizations/OrganizationPicker.tsx`, `features/organizations/OrganizationMap.tsx` (peut utiliser `GraphCanvas` en mode métier), `features/dashboard/RunSummary.tsx`, `shared/design-system/*` et `shared/presentation/*` pour traductions typées des **données enregistrées**.
- **Ne pas dupliquer** les objets métier ni recréer un solveur, un vérificateur ou un moteur de règles dans React.

## 4. Design system V2

| Token | Valeur indicative | Usage |
|---|---|---|
| `--brand-navy` | `#17304A` | navigation et titres |
| `--brand-teal` | `#087D70` | actions principales, sélection |
| `--surface-page` | `#F5F8FB` | fond |
| `--surface-card` | `#FFFFFF` | cartes |
| `--border-muted` | `#DCE5EE` | séparateurs |
| `--state-warning` | `#BD8034` | prudence, saturation |
| `--state-error` | `#AE4B48` | erreurs prouvées |

Typographie Inter / Segoe UI, corps 14–16 px, labels ≥12px, espacement 4/8/12/16/24/32/48, grille desktop 12 colonnes adaptable, cartes sans ombres excessives. Composants communs : `PageHeader`, `SectionHeader`, `KpiCard`, `StatusChip`, `ResourceMeter`, `EvidenceLink`, `EmptyState`, `InlineError`, `Skeleton`, `ConfirmDialog`, `InspectorDrawer`, `ResponsiveDataTable`.

Les couleurs ne sont jamais le seul signe d'état. Focus clavier visible, annonces ARIA des opérations, labels réels, support `prefers-reduced-motion`, WCAG 2.2 AA comme **cible à vérifier**, non comme certification.

## 5. Cadence incrémentale et livrables

### UX-F1 — Fondations, sélecteur d'organisation et navigation

**Objectif** : résoudre le principal problème visible immédiatement, sans changement backend.

1. Créer `feature/ux-v2-foundation-navigation` depuis `main` APRÈS fusion + CI de PR #6.
2. Ajouter les tokens V2 et primitives UI sans remplacement brutal de tous les styles.
3. Refactorer AppShell, sidebar, en-tête et switch **Métier / Expert**, valeur `Métier` à l'ouverture, état en mémoire. Pas d'élévation RBAC ni de persistance de secrets.
4. Remplacer les cartes infinies du picker par recherche, tri, pagination/chargement progressif, séparation explicite « Organisations de démonstration » et « Espaces de test » uniquement **quand une identité fiable existe** (p. ex. clé `studio_import_` connue). Les organisations qui ne satisfont pas ce critère restent visibles. Aucune purge, aucun changement de membership.
5. Conserver les comptes de test, l'organisation active et toutes les routes ; vérifier les switches entre tenants, session, déconnexion et permissions.
6. Isoler le lancement local des tests E2E de la base de démo. Dans la CI, la base est éphémère ; en local, **ajouter un garde explicite** qui refuse des tests destructeurs ou de création massive lorsque `BRAIN_DATABASE_URL` désigne la base métier/démo. Pas de nettoyage automatique. Documenter une DB E2E dédiée.

**Acceptation** : à 20+ organisations, retrouver « Usine fictive » en ≤3 actions sans parcourir des cartes répétées ; le tenant affiché change immédiatement et ne montre jamais les anciennes données ; tests d'identité/session et pagination verts.

### UX-F2 — Dashboard métier réel

1. Découpler le rendu de `Workspace` : charger l'organisation active d'abord, puis les seules collections nécessaires à la route ; loading et retry locaux au lieu d'un écran bloqué par une collection.
2. `Dashboard` lit **des runs réels** accessibles et un modèle réel associé. Si aucun run exploitable n'existe, état vide avec action autorisée. Ne jamais utiliser les exemples usine 4100/université 17 comme valeurs codées en dur dans l'application.
3. KPI : valeur d'objectif + unité et statut exact, date/version, décisions principales issues du rapport, ressources et marges enregistrées ; mesures correctes uniquement si `has_verified_plan` et les validations existantes sont satisfaites. Réutiliser le contrat de `DecisionCockpit` plutôt que le réimplémenter.
4. Saturation n'implique ni causalité, ni prix d'ombre, ni gain. CTA lancement et simulation soumis aux droits déjà vérifiés par le serveur.
5. Vérifier INFEASIBLE, TIME_LIMIT sans plan, FEASIBLE_NOT_PROVEN_OPTIMAL et SOLUTION_FAILED_VALIDATION ; aucune valeur non certifiée affichée.

**Acceptation** : usine publiée/run vérifié → 4100 EUR, 40/15, 95/100h, 7000/8000 EUR et 55/55 depuis API ; université → 17 quand sa référence est sélectionnée et vérifiée ; sans run → aucun KPI fabriqué.

### UX-F3 — Carte organisationnelle interactive

1. Décliner `GraphCanvas` en **Mode métier** et **Mode expert** ; conserver la projection exacte du graphe stocké.
2. Métier : cartes lisibles (département / ressource, labels et unités), sélection, surlignage des connexions, filtre département, inspecteur explicatif avec ressources et responsabilités réellement déclarées.
3. Expert : types exacts `DEPENDS_ON` vs `USES_RESOURCE`, traces, provenance, édition autorisée et JSON secondaire. Une arête informative ne fabrique aucune équation.
4. Mesurer les rerenders React Flow, stabilité `nodeTypes`/edges, coût du layout ; optimiser seulement après mesures.
5. Keyboard/focus, responsive 390/768/1280/1440, gestes de zoom et fit, préférences réduit-mouvement.

**Acceptation** : un responsable peut sélectionner « Logistique » et voir la capacité *déclarée* de 55 unités, ainsi que les liens déclarés ; seules les consommations du rapport solveur vérifié peuvent apparaître en mode « Analyse de résultat », jamais déduites du graphe seul.

### UX-F4 — Optimization Center et Decision Cockpit

- Transformer en parcours compréhensible : modèle publié → options essentielles → lancement → état du job → résultat vérifié ; détails techniques à la demande.
- Protéger `Idempotency-Key`, retry de demande incertaine et annulation demandée ≠ `CANCELLED` confirmé.
- `SUCCEEDED` technique ≠ `OPTIMAL` mathématique ; `INFEASIBLE` et `TIME_LIMIT_NO_SOLUTION` n'ont pas de plan à afficher. Ne pas fabriquer de pourcentage de progression.
- Unité, meilleur bound, gap, solveur, tolérances visibles en expert avec provenance.

### UX-F5 — Scénarios, historique et validation complète

- Représenter les politiques 5B-2 et accords des propriétaires comme un assistant : modèle → politique publiée → délégation → valeurs SET exactes → preview **serveur** → création DRAFT → publications distinctes → worker → résultat.
- Les comparaisons/gains 5B-3 restent indisponibles jusqu'à leur livraison réelle.
- Historique lisible et paginé, sur une synthèse fiable du run vérifié ; conserver toutes les données canoniques en expert.
- Tests utilisateurs scénarisés (VIEWER, ADMIN, BUILDER, APPROVER), accessibilité, responsive et profils de performance.

## 6. Performances : mesurer avant de promettre

- Instrumentation des jalons : connexion → première navigation ; changement d'organisation → nouvelle identité visible ; dashboard → première donnée réelle ; graphe → interaction ; session chargée → route suivante.
- Relevé React Profiler et réseau sur jeu synthétique de 2, 20, 100 organisations / 7, 50, 200 nœuds ; environnement documenté et comparaison avant/après.
- Objectifs indicatifs : navigation chaude ressentie <200 ms, aucune réponse précédente affichée après changement tenant, pas de blocage UI >500 ms sur les graphes de démo. **Ce sont des objectifs et non des résultats prouvés.**
- Une liste volumineuse n'est pas automatiquement un cas pour virtualisation : examiner les volumes réels et le coût.

## 7. Invariants communs à chaque PR UX

- Aucun changement fonctionnel dans `brain/kernel`, compositeur, HiGHS, `SolutionVerifier`, job fencing/annulation, audit et politiques SQL RLS ; aucune migration sauf nécessité indépendante explicitement démontrée et approuvée.
- Aucune altération d'artefacts, modèles publiés, runs, historiques, memberships ou fichier `tatus`.
- Connexions, droits, délégations, accord préalable, publication et validation restent contrôlés côté serveur.
- Jamais de nouvelle exécution sur simple navigation, jamais de calcul mathématique dans React ni de gain inventé.
- Validation runtime OpenAPI/types, protections des requêtes tardives, session en mémoire, séparation des tenants, erreurs actionnables.
- En cas de nouvelle dépendance frontend, justification, licence, bundle/performance ; préférer l'existant si possible.
- DoD : TypeScript + lint + Vitest + Playwright API/PostgreSQL/worker réels (selon zone) + CI Linux/Windows/PostgreSQL ; pas de skips déguisés en succès.

## 8. Matrice d'acceptation

| Parcours | Attendu | Refus explicites |
|---|---|---|
| VIEWER consulte usine | Vue métier, aucune action active d'écriture | mode expert n'ouvre aucun droit |
| Switch usine → université | données universitaires seulement | jamais d'ancienne valeur usine |
| Démo avec 20 espaces de test | usine retrouvable rapidement, test spaces distingués | pas de suppression ni masquage silencieux |
| Organisation sans run | onboarding clair, aucun objectif | pas de 4100 EUR en dur |
| Usine avec run valide | 4100 EUR + ressources du run réel | pas de « gain » |
| INFEASIBLE / TIME_LIMIT sans plan | explication du statut | pas de décisions inventées |
| Graph edge DEPENDS_ON | relation informative | pas de consommation calculée de l'arête |
| Logistique dans le graphe | capacité déclarée et lien propriétaire | pas de prix d'ombre inventé |
| Double lancement ou réponse incertaine | même Idempotency-Key | pas de double job |
| Politique révoquée | action refusée côté serveur | pas de création/publication implicitement autorisée |
| Mobile 390px + clavier | navigation et détails accessibles | pas de scroll horizontal de page |

## 9. Livrables à chaque incrément

1. Audit du code réel avec métriques de base ; plan d'édition détaillé.
2. Maquette/flux et composants de la tranche, avec preuves que les états sont sourcés.
3. Code React/TS + CSS + tests non-régression.
4. Validation réelle locale et CI à la tête de branche, mesures avant/après, captures desktop/mobile.
5. Rapport « Livré / Tests / UX vérifiée / Limites / Risques / PR », **sans fusion automatique**.
