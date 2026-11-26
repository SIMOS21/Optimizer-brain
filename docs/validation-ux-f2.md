# UX-F2 — Dashboard métier connecté aux résultats réels

## Récupération et audit initial

- Branche `feature/ux-v2-dashboard` basée sur `main` (`75734ef`, après fusion de la PR #7 UX-F1).
- Le worktree historique `Optimizer brain` et le fichier non suivi `tatus` sont préservés.
- Le répertoire `frontend/src/features/dashboard/` n'existait pas encore ; `Workspace.tsx` chargeait encore les quatre collections (`departments`, `graphs`, `model-versions`, `optimization-runs`) avant de rendre toute route.
- Aucun changement n'a été apporté au moteur mathématique (`brain/kernel`), à HiGHS, au vérificateur indépendant, aux règles RBAC/RLS, aux historiques immuables ni aux politiques de scénarios.

## Changements UX-F2

- **`frontend/src/features/dashboard/trust.ts`** : réutilisation de la chaîne de confiance de `DecisionCockpit` (`validation_report.valid === true`, `plan.feasible === true`, `has_verified_plan === true`, concordance `record.status === solve.public_status === report.status`). La revue ajoute l'exigence du statut natif `OPTIMAL` pour qualifier un optimum. `SUCCEEDED` n'est jamais traité comme synonyme de `OPTIMAL`.
- **`frontend/src/features/dashboard/Dashboard.tsx`** :
  - Valeur d'objectif et unité lues uniquement depuis les artefacts réels enregistrés (ex. `4100 EUR` pour l'usine, `17` pour l'université dans les fixtures/artefacts). Aucune constante codée en dur.
  - Distinction explicite entre le **dernier run disponible** et le **dernier plan vérifié** (avec lien vers le dernier plan vérifié antérieur lorsque le dernier run est `INFEASIBLE`, `TIME_LIMIT_NO_SOLUTION`, `SOLUTION_FAILED_VALIDATION` ou non vérifié).
  - Décisions optimisées, ressources consommées / capacités / marges (`ResourceMeter`), contraintes saturées (avec avertissement explicite qu'une saturation n'implique pas un gain économique), date et version du modèle.
  - Mode expert : provenance complète (IDs de run/modèle, snapshot, hashes, solveur/version, durée, portée du certificat, bornes, gap relatif, tableau complet des contraintes) sans accorder aucune permission supplémentaire.
  - Actions autorisées vers *Comprendre ce résultat*, *Optimisation* (`canBuild` uniquement) et *Scenario Lab*.
  - État vide pédagogique sans KPI fabriqué lorsqu'aucun run n'existe, retry local en cas d'erreur, tri déterministe (`created_at` décroissant puis `id`) et pagination des runs récents (5 par page).
- **`frontend/src/features/organizations/Workspace.tsx`** :
  - Suppression du chargement bloquant global des quatre collections.
  - Utilisation directe de `authorizedOrganization` lorsque fournie par `AuthenticatedApp`.
  - Chargement paresseux par route (`Dashboard`, `GraphsRoute`, `ModelsRoute`, `ScenariosRoute`, `ExecutionRoute`, `HistoryRoute`) avec `Skeleton` ciblés et boutons `Réessayer` locaux. `DepartmentRegistry` est conservé sur la route `Mon organisation` (`/organizations/:org/graphs`).
- **`frontend/src/features/history/History.tsx`** : tri déterministe des runs (`created_at` décroissant puis `id`).
- **`frontend/src/styles/foundation.css`** : styles V2 responsives (desktop 1440 px et mobile 390 px) pour le dashboard et les indicateurs de ressources.

## Revue finale du 26 novembre 2026

Le code UX-F2 existant au commit `45b576ecb011ac1211e2ce8fa72ef2d30374a874`
a été revu et corrigé sur la même branche, sans réimplémentation. Le seul
worktree enregistré est le dossier historique `Optimizer brain`. Aucun changement
suivi n'était présent ; `tatus` conserve le SHA-256
`29ae5a2c4accb7dc1aadc718ef108caaecdfefddbde17de2913c4213183185f8`.
Les références distantes ont été vérifiées : main `75734ef`, branche `45b576e`.
Aucun nouveau worktree, reset, clean, force push, purge de données ou downgrade.

### Causes des sept échecs

Le [workflow initial](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45520399050)
passe sur Linux et Windows ; PostgreSQL échoue sur Playwright : **35 réussites,
7 échecs**. La reproduction locale sur le code initial retrouve exactement ces
sept échecs, avec **35 réussites / 42**, en 4,2 minutes.

| Test initial | Cause confirmée | Correctif |
|---|---|---|
| `dashboard.spec.ts:21` | Le scénario industriel contrôlé exécuté avant le dashboard produit réellement 3500 EUR ; le test attend la référence 4100 sur le dernier run | Comparer le dernier run à son artefact API, puis sélectionner explicitement l'id de référence pour le golden |
| `dashboard.spec.ts:51` | Même confusion sur mobile | Sélection explicite du run de référence avant contrôle des valeurs et de la largeur |
| `dashboard.spec.ts:67` | Même confusion pour VIEWER | Même sélection en lecture seule, avec maintien des assertions de permissions dans les deux modes |
| `foundation.spec.ts:168` | Le lien attendu appartient au run de référence, absent de la page du dernier run | Capturer le lien du run réellement affiché, vérifier sa disparition au changement de tenant et sa restitution après retour navigateur ; conserver le test de réponse tardive |
| `foundation.spec.ts:207` | Le titre UX-F1 a été remplacé par le nom de l'organisation dans le dashboard | Attendre le titre exact du tenant actif ; conserver Tab, Échap, retour du focus et contrôle de largeur |
| `studio.spec.ts:179` | Même ancien titre après changement d'organisation | Vérifier le nom exact de l'université, l'absence de l'ancienne ressource et l'effacement de session au rechargement |
| `studio.spec.ts:277` | Le lien desktop « Mon organisation » est masqué à 390 px | Ouvrir le vrai dialogue mobile, suivre son lien accessible, vérifier fermeture, focus dans le contenu et absence de débordement |

Aucun timeout augmenté, aucun test désactivé, aucun ordre de runs modifié.
Les scénarios restent présents dans le dashboard et l'historique.

### Correctifs de fidélité des résultats

Le tri reste `created_at` décroissant puis `id` décroissant. Le sélecteur
« Résultat du tableau de bord » permet de choisir tout run chargé par identifiant,
y compris une référence ancienne hors de la page de cinq runs récents. Son
option automatique restaure le dernier run. Un libellé ARIA explicite évite
l'ambiguïté observée dans Chromium avec les textes des options.

Modèle, version, scénario déclaré, snapshot et lien du run sont visibles dans
le contexte du résultat. Le libellé `base` vient de l'artefact et n'est pas une
déduction de « référence universelle ». Aucun objectif n'est codé en dur dans
l'implémentation, aucun gain n'est calculé.

La recherche du plan vérifié antérieur lisait seulement le premier candidat
ayant un statut favorable. Un test reproduit son arrêt sur un candidat dont la
validation indépendante est négative alors qu'un plan plus ancien est valide.
Elle lit maintenant les candidats strictement antérieurs, dans le même ordre,
jusqu'à vérification concluante. Une erreur HTTP est affichée avec reprise
explicite ; elle n'est pas assimilée à l'absence de plan. Le contexte du plan
antérieur identifie aussi son propre modèle/scénario/snapshot, sans comparaison
économique avec le run courant.

Un test démontre le refus d'un statut natif `FEASIBLE` incohérent avec un statut
public `OPTIMAL`. Les autres contrôles indépendants restent obligatoires.
`SUCCEEDED` reste technique ; les goldens, INFEASIBLE, TIME_LIMIT sans plan,
FEASIBLE sans optimalité prouvée et SOLUTION_FAILED_VALIDATION restent distincts.

La jauge calculait un pourcentage en convertissant les mesures en `Number` :
`1/3` devenait zéro, et des décimaux exacts pouvaient être arrondis. Ce calcul
React est supprimé. Consommation, capacité, marge et unité restent les chaînes
du rapport enregistré. Les états `UNMODELED`/`UNAVAILABLE` ne sont plus affichés
comme « Disponible » et les mesures absentes restent « Non fourni ». Une
contrainte saturée est qualifiée selon les tolérances, sans prix d'ombre ni gain
implicite. Ces défauts ont été reproduits par tests avant correction.

### Provenance et références mathématiques

Les [observations API E2E](metrics/ux-f2-run-provenance.json) conservent les ids,
hashes et snapshots des quatre artefacts consultés en lecture. Chaque run a été
rapproché de sa ModelVersion publiée : hash et snapshot concordants,
`validation_report.valid` et `validation_report.plan.feasible` vrais. Pour les
scénarios contrôlés, le lien de scénario confirme le modèle source de référence
et l'identité du modèle dérivé. Il s'agit de données synthétiques.

| Organisation | Référence explicitement sélectionnée | Scénario contrôlé réellement calculé |
|---|---|---|
| Usine | **4100 EUR**, A=40, B=15 ; machine 95/100, budget 7000/8000, logistique 55/55 | **3500 EUR**, modèle et snapshot dérivés distincts |
| Université | **17**, modèle de référence et snapshot universitaire | **10**, autre modèle et snapshot contrôlé |

Les deux colonnes représentent des hypothèses différentes. Aucun gain ou
classement de performance entre elles n'est revendiqué. Aucun historique,
modèle, snapshot ou résultat de référence n'est réécrit.

### Tests réellement exécutés après correction

Windows, Python 3.14.3, Node 24.13.0, PostgreSQL 17, Chromium Playwright.

| Contrôle | Résultat local |
|---|---|
| TypeScript et build Vite | Réussis |
| ESLint | Réussi |
| Vitest complet | **194 réussites / 13 fichiers**, dont 22 tests dashboard |
| Ruff check et format CI | Réussis, 67 fichiers formatés contrôlés |
| mypy | Réussi, 46 fichiers source |
| pytest complet avec PostgreSQL réel | **478 réussites, 8 variantes SQLite ignorées** |
| Les sept parcours E2E initialement défaillants | **7 réussites** après correction |
| Playwright complet avec API/PostgreSQL/worker | **42 réussites**, ordre normal du workflow |

Huit tests unitaires sont ajoutés : sélection référence/scénario et retour au
dernier run, poursuite après candidat non vérifié, exclusion d'un plan plus récent
du fallback antérieur, refus d'un faux optimum natif, fractions sans jauge
fabriquée, erreur de lecture/reprise, SUCCEEDED technique et ressource UNMODELED.
Les tests existants de chargement paresseux, permissions et isolation restent
exécutés. `Workspace.tsx` et `History.tsx` ne sont pas modifiés par ce correctif.

Le build conserve l'avertissement de bundling `use no memo` de la dépendance
React. pytest émet des avertissements de dépréciation AnyIO/Starlette ; aucun
échec de test n'en résulte. Aucun changement de dépendance dans cette revue.

### Captures réelles

- [Dernier scénario usine — 3500 EUR, 1440 px](screenshots/ux-f2/ux-f2-dashboard-latest-1440.png).
- [Référence usine — 4100 EUR, 1440 px](screenshots/ux-f2/ux-f2-dashboard-factory-1440.png).
- [Référence usine — 4100 EUR, 390 px](screenshots/ux-f2/ux-f2-dashboard-factory-390.png).
- [Référence université — 17, mode expert, 1440 px](screenshots/ux-f2/ux-f2-dashboard-university-1440.png).

Ces images proviennent des parcours réels et ont été inspectées. Aucun écran
simulé ni secret. Les captures du menu mobile et du graphe restent également
produites par les tests historiques et publiées dans l'artefact CI.

### PostgreSQL local, limites et livraison

Le diagnostic initial sur le port 5432 ne correspondait pas à la configuration
locale : `.local/e2e.env` vise **127.0.0.1:55432**. Le daemon Docker était arrêté.
Docker Desktop puis le seul conteneur existant `optimizerbrain4a-postgres-1` ont
été redémarrés, sans recréer son volume. La suite Python utilise
`optimizer_brain_test`, Playwright exclusivement `optimizer_brain_e2e` sur
8002/5181. Aucun test navigateur n'utilise la base de démonstration ; aucun
nettoyage automatique E2E n'est introduit. `.local/` est conservé hors Git.

Le catalogue des runs est toujours chargé via l'API paginée existante ; le
sélecteur propose tous ces ids et la liste récente garde cinq lignes par page.
La recherche d'un plan antérieur peut nécessiter plusieurs lectures séquentielles ;
les erreurs bloquent explicitement sa conclusion. Les très grands historiques
ne sont pas benchmarkés. Aucune certification WCAG/Safari/Firefox ni mesure de
latence avant/après n'est revendiquée. Les captures et tests de largeur/clavier
concernent Chromium à 1440 et 390 px.

Le workflow GitHub existant contrôle les plateformes Linux/Windows et PostgreSQL,
puis les contrats API générés et les suites frontend. Les résultats du SHA final
sont à vérifier sur la [branche UX-F2](https://github.com/SIMOS21/Optimizer-brain/actions?query=branch%3Afeature%2Fux-v2-dashboard).
La PR est destinée à la revue, sans fusion automatique. En cas de refus du
connecteur, [ouvrir la comparaison](https://github.com/SIMOS21/Optimizer-brain/compare/main...feature/ux-v2-dashboard?expand=1).
UX-F3, UX-F4, UX-F5 et 5B-3 ne sont pas commencés.
