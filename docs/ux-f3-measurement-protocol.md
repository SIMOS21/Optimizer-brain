# UX-F3 — Protocole de mesure de la carte

Depuis la racine, Node 24 et environnement PostgreSQL E2E privé configuré :

```powershell
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build --graph-measure before
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build --graph-measure after
```

Le garde existant impose `optimizer_brain_e2e`, distincte de la démonstration.
Le script ajoute une organisation `studio_import_ux_f3_benchmark`, ses départements
et trois snapshots synthétiques de 7, 50 et 200 nœuds. Les créations et publications
passent par l'API sécurisée, avec le registre autorisé. Aucun reset, purge ou
changement de snapshot existant. Les ids et empreintes doivent être identiques
avant/après ; un écart interrompt la comparaison.

Le lanceur démarre exceptionnellement Vite en développement sur ses ports E2E
habituels 8002/5181 pour rendre React Profiler actif. Le HTML
`frontend/benchmarks/graph.html` et le composant sous `tests/performance/` ne sont
pas des entrées du build de production. Le banc reçoit uniquement les
GraphDocuments synthétiques lus dans l'API. Il n'injecte pas de résultat solveur
et n'est pas une nouvelle route de l'application sécurisée.

Trois contextes Chromium neufs par taille, largeur 1440, mouvements réduits.
La mesure initiale attend tous les nœuds/arêtes et 100 ms sans commit : elle
inclut cette fenêtre de stabilisation et ne doit pas être appelée temps de
rendu React pur. Les commits et durées React sont conservés séparément par le
Profiler racine. La sélection est effectuée au clavier sur le premier nœud,
jusqu'au titre de l'inspecteur. Le temps inclut l'automatisation Playwright.
Il ne s'agit pas d'un compteur individuel de rerenders de chaque nœud.

La projection est également mesurée sous Node, 30 appels après 10 échauffements
par taille. Cette même série figure dans chacun des trois échantillons navigateur
de la taille ; elle représente 30 mesures, pas 90 mesures indépendantes.

Les fichiers bruts et captures sont écrits dans `.local/ux-f3/{before,after}`.
La baseline a été mesurée sur `ccbac0f` avant modification du composant :
[mesures](metrics/ux-f3-before.json), [snapshots](metrics/ux-f3-snapshots.json).
Les résultats finaux figurent dans `validation-ux-f3.md` après exécution.
Pas de SLA, de promesse de gain, de mesure INP en production ou de benchmark
de calcul mathématique : seules la projection visuelle et les interactions sont
mesurées, sur une même machine et les mêmes snapshots.
