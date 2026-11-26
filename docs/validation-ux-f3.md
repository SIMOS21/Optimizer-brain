# Validation UX-F3 — Carte organisationnelle interactive

26 novembre 2026. Branche `feature/ux-v2-organization-map`, base `ccbac0f`.
PR #8 fusionnée et CI main [45843788027](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45843788027)
vérifiées avant création de branche : Linux, Windows et PostgreSQL réussis.

## Audit et architecture

Avant : page « Mon organisation » centrée sur les artefacts, carte dans leur
détail, informations techniques prédominantes, deux appels de projection lors
du montage. Les nodeTypes étaient déjà stables ; les arêtes utilisaient déjà
le renderer smoothstep de React Flow. Le chargement paresseux par route, les
contrôles de tenant et le stockage du jeton en mémoire étaient présents.

Après : `OrganizationMap` charge un snapshot choisi dans les versions autorisées,
directement sur cette page. Dernier publié par défaut, sinon dernier brouillon ;
état explicite, ordre date puis id, toutes les versions et URL conservées.
`GraphCanvas` garde React Flow et le layout déterministe en deux colonnes, avec
une projection par document immuable. `GraphSession` porte les états visuels,
réinitialisés par identité canonique de contenu. `OrganizationNode` est mémorisé ;
`GraphInspector` sépare la fiche de la navigation ; `map-view.ts` porte les règles
visuelles pures. Le CSS de carte est chargé avec son module paresseux.
Le détail du snapshot conserve édition versionnée, publication confirmée,
rechargement local et export JSON en mode expert.

Décisions et compromis : [ADR 0012](decision-records/0012-organization-map-snapshot-presentation.md).
Aucune dépendance ajoutée. Aucun changement du Brain, des migrations, des
contrats API, du solveur, du vérificateur, de RBAC/RLS ou des politiques de scénario.

## Données et interactions livrées

- Métier par défaut : noms effectivement enregistrés, catégories, propriétaire
  déclaré, capacités/unités du paramètre référencé, sélection nœud/arête,
  surlignage incident, recherche française, périmètre départemental, liste
  textuelle, zoom, déplacement local et ajustement de vue.
- Expert : identifiants, `DEPENDS_ON`/`USES_RESOURCE`, provenance, versions,
  paramètres et JSON secondaires. Aucun droit supplémentaire ; les actions
  existantes restent conditionnées par le rôle serveur dans les deux modes.
- Les arêtes sont uniquement celles du document. Propriété et partage ne
  créent pas de relation. Le périmètre inclut ressources possédées/partagées et
  voisins directs déclarés ; la recherche intersecte ce périmètre. Le filtrage
  ne recalcule pas le layout et ne supprime aucun objet du snapshot.
- Aucun calcul de consommation, de marge, de contrainte ou d’objectif. Les
  décimaux restent des chaînes, y compris au-delà de la précision de Number.
  `owner_id` est présenté comme responsabilité descriptive, sans identité ou
  privilège supposé. Le nom du propriétaire d’une ressource vient du département
  du même GraphDocument.
- Changements de version/tenant : ancienne carte immédiatement retirée pendant
  le chargement, réponses tardives ignorées par `useLoad`. Workspace conserve sa
  clé tenant et l’annulation des requêtes. Aucun stockage de session persistant.

La référence usine sélectionnée contient **55 unit** pour la logistique, 8000 EUR
pour le budget et 100 hour pour la production. Ces chaînes viennent du snapshot,
sans constante 55 dans les composants. L’université utilise son propre graphe :
cinq départements, deux ressources, six arêtes ; budget 9 EUR et salles 2 unit.
Une autre version peut déclarer d’autres capacités sans changer la référence.
Les résultats historiques restent distincts de la carte : références **4100 EUR**
et **17**, contrôlées par les parcours historiques conservés.

## Tests réellement exécutés

Windows, Python 3.14.3, Node 24.13.0, PostgreSQL 17, Chromium Playwright.

| Contrôle | Résultat local |
|---|---|
| TypeScript / build Vite / ESLint | Réussis |
| Vitest complet | **209 réussites, 15 fichiers** |
| pytest complet, PostgreSQL réel | **478 réussites, 8 variantes SQLite ignorées**, 209 s |
| Ruff check et format du périmètre CI | Réussis, 67 fichiers formatés contrôlés |
| mypy sans arguments, périmètre configuré du projet | Réussi, 46 fichiers source |
| Playwright complet, API/PostgreSQL/worker réels | **50 réussites**, dont les **42 parcours préexistants**, 2,6 min |
| Huit parcours carte rejoués après les corrections finales | **8 réussites** |
| Mesures après sur snapshots identiques | 9 échantillons, tailles 7/50/200, empreintes concordantes |

Quinze nouveaux tests Vitest : onze tests de projection/interactions et quatre
de chargement. Ils couvrent les deux secteurs, les relations exactes, l’absence
d’arêtes dérivées, les namespaces nœud/arête, les décimaux exacts, les filtres,
le mode expert sans reprojection, le reset de snapshot, le dévoilement d’une
relation filtrée avec ses deux extrémités, le clavier, les états
vides, la sélection publié/brouillon, les réponses tardives et le retry.
Le test du dernier plan vérifié attend désormais la fin de son chargement
asynchrone ; son assertion de valeur est conservée. Aucun code dashboard changé.

Les huit nouveaux parcours réels contrôlent usine/université, lecture seule,
types d’arêtes, surlignage, filtres, expert, quatre largeurs, clavier/fiche/focus,
zoom/fit, mouvement réduit, changement de version/tenant et VIEWER. Les contrôles
existants des quatre rôles ADMIN/BUILDER/APPROVER/VIEWER sont conservés.
Les assertions techniques historiques activent explicitement le mode expert.
Un contour absent sur le titre après transfert programmatique du focus a été
reproduit puis corrigé ; les cartes enrichies ont aussi reçu plus d’espace vertical.
Un autre test a reproduit une relation sélectionnée dont une extrémité restait
masquée par la recherche. La navigation depuis la fiche efface désormais les
filtres concernés et ajuste la vue sur les deux extrémités enregistrées ; le
parcours usine réel contrôle ce cas. Aucun objet du snapshot n’est changé.
La première CI PR sur `12cc976` a passé 49/50 parcours : le test tablette envoyait
Entrée après le seul comptage des wrappers React Flow, sans garantir leur
visibilité ou le focus. Ces wrappers sont cachés avant mesure par React Flow.
La CI de push sur ce même SHA passait 50/50. Le test attend désormais la visibilité
et confirme le focus réel avant Entrée. Il contrôle aussi un ResizeObserver
volontairement retardé de 150 ms à 768 px, sans sleep du test, augmentation de
timeout ou retry masquant l’échec.

Commandes :

```powershell
cd frontend
npm run typecheck
npm run build
npm run lint
npm test
cd ..
python -m ruff check brain tests migrations scripts
python -m mypy
python -m pytest -q
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build
```

Pour pytest PostgreSQL, renseigner les variables BRAIN_TEST_DATABASE_URL et
BRAIN_TEST_MIGRATION_DATABASE_URL avec les identités distinctes de la base de
test. Localement, le helper privé existant `.local/check_phase4a.py` les a fournies
pour `optimizer_brain_test`. Playwright utilise exclusivement
`optimizer_brain_e2e`, ports 8002/5181. Aucun reset, purge ou accès à la base de
démonstration. `.local/` et le fichier non suivi `tatus` sont conservés ; SHA256
de `tatus` inchangé : `29AE5A2C4ACCB7DC1AADC718EF108CAAECDFEFDDBDE17DE2913C4213183185F8`.

La CI existante conserve les contrôles Python Linux/Windows, PostgreSQL réel,
contrats générés et frontend. Les résultats du SHA de livraison sont consultables
sur la [branche UX-F3](https://github.com/SIMOS21/Optimizer-brain/actions?query=branch%3Afeature%2Fux-v2-organization-map)
et doivent être rapprochés du SHA de la PR, pas d’une exécution antérieure.

## Mesures avant/après

[Protocole reproductible](ux-f3-measurement-protocol.md),
[avant](metrics/ux-f3-before.json), [après](metrics/ux-f3-after.json),
[identités des snapshots](metrics/ux-f3-snapshots.json).
Trois contextes neufs par taille, React développement avec Profiler, largeur 1440,
hauteur 1040, mouvement réduit. Projection Node : 30 appels après 10 échauffements.
Même machine, mêmes documents persistés, mêmes empreintes avant/après.
La série après correspond au rendu `6ec3d28`, avant le correctif de navigation
depuis une fiche filtrée ; ce chemin n’est pas exercé par le benchmark clavier.

Médianes en millisecondes, avant → après :

| Nœuds | Projection Node | Initial jusqu’à stabilisation | Sélection clavier jusqu’à fiche | Durée React initiale cumulée | Durée React sélection cumulée |
|---|---|---|---|---|---|
| 7 | 0,004 → 0,016 | 197,0 → 205,1 | 29,3 → 41,0 | 41,0 → 43,5 | 11,6 → 11,3 |
| 50 | 0,021 → 0,015 | 292,3 → 316,5 | 68,2 → 60,3 | 111,7 → 118,6 | 40,7 → 35,6 |
| 200 | 0,096 → 0,085 | 489,3 → 556,6 | 108,9 → 105,2 | 244,4 → 263,5 | 49,8 → 44,4 |

Le rendu initial est plus lent sur ces échantillons ; la carte est aussi plus
riche. Les sélections 50/200 sont légèrement plus rapides, celle de 7 plus lente.
Aucun gain global ni significativité statistique n’est revendiqué. Le temps
initial inclut 100 ms de calme ; la sélection inclut Playwright. Les durées React
sont des sommes par échantillon puis une médiane, pas un temps mur. Ni INP,
ni SLA, ni mesure de calcul mathématique. La projection n’est plus répétée pendant
la recherche, la sélection ou le changement de mode, ce que vérifie le test espion.

## Captures et limites

Captures issues de l’API réelle isolée :

- [Usine métier, 1440](screenshots/ux-f3/ux-f3-factory-1440.png).
- [Université métier, 1440](screenshots/ux-f3/ux-f3-university-1440.png).
- [Université expert, 1440](screenshots/ux-f3/ux-f3-university-expert-1440.png).
- [Fiche à 1440](screenshots/ux-f3/ux-f3-inspector-1440.png),
  [1280](screenshots/ux-f3/ux-f3-inspector-1280.png),
  [768](screenshots/ux-f3/ux-f3-inspector-768.png),
  [390](screenshots/ux-f3/ux-f3-inspector-390.png).

Les interactions et débordements sont contrôlés à hauteur 1040. Pour les captures,
seule la hauteur de fenêtre est prolongée jusqu’au bas de la carte, afin de garder
le header collant en haut et d’exclure les nombreuses lignes d’historique E2E.
Les captures avant des graphes synthétiques figurent aussi dans ce dossier.

Le fit global rend les grands graphes petits : zoom, filtre et liste sont
nécessaires pour lire les détails. Le placement reste fixe, sans layout optimisé
ou sauvegarde des positions. Certains labels d’arêtes parallèles restent proches ;
la fiche conserve leurs extrémités et types exacts. Les enregistrements techniques
secondaires restent accessibles sous la carte. Aucune certification WCAG ou de
lecteur d’écran ; tests Chromium uniquement, pas Safari/Firefox ni téléphones
physiques. Avertissements de dépendances AnyIO/Starlette et bundling `use no memo`
conservés sans changement de version.

PR de revue uniquement, sans fusion automatique. UX-F4/F5, 5B-3, 5C et LLM hors
périmètre. Prochaine action : revue fonctionnelle, visuelle et des invariants de
snapshot sur la branche, puis décision humaine de fusion.
