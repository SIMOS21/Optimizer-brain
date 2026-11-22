# Visual Organization Studio — Phase 4B

Une interface de modélisation et de consultation connectée à l'API sécurisée 4A.
Voir [audit et plan](audit-phase-4b.md), [ADR 0005](decision-records/0005-visual-studio-browser-contracts.md)
et [résultats de validation](validation-phase-4b.md).

## Lancement Windows PowerShell

Pré-requis : installation Python/PostgreSQL de [4A](platform-phase-4a.md), Node.js
**24** (testé : 24.13.0), npm et navigateur. Utiliser `npm.cmd` sous PowerShell
si npm.ps1 est bloqué ; aucune modification de la politique PowerShell n'est nécessaire.

Dans une console d'administration, à la racine du dépôt :

```powershell
Get-Content .local/phase4a.env | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
    $pair = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
}
docker compose --env-file .local/phase4a.env -f infra/compose.phase4a.yml up -d --wait
python -m alembic upgrade head
python -m scripts.seed_studio --with-history
```

Le script demande un mot de passe sans l'afficher. Il crée les comptes synthétiques
`studio_demo_admin`, `studio_demo_builder`, `studio_demo_approver`, `studio_demo_viewer`.
ADMIN accède aux deux exemples ; les trois autres comptes sont membres de l'usine.
Ne pas utiliser ce provisionnement pour des données réelles. Les secrets ne sont
jamais placés dans les arguments. Un compte existant garde son mot de passe ; une
collision de version est refusée. Aucune base ni version existante n'est réinitialisée.
Si une autre organisation possède déjà une clé synthétique requise, le script échoue
sans la reprendre : utiliser une base de démonstration distincte.

Avec --with-history, le script lance explicitement les anciens solveurs Python de
Phase 3 et stocke leurs résultats via le hook 4A vérifié. Il ne fournit aucun job web.
Sans cette option, le Studio peut légitimement afficher un historique vide.
Le manifeste `.local/studio/manifest.json` contient seulement les identités non secrètes.
Pour la démonstration provisionnée pendant cette validation, le mot de passe généré
est dans `.local/studio/password.txt`, ignoré par Git ; aucun secret n'est affiché
dans ce document. Le script standard demande votre propre secret lors d'une nouvelle
installation et ne réinitialise pas celui d'un compte existant.
L'option développeur --fixtures exporte les réponses métier vers frontend/tests/fixtures.

Avant de lancer le serveur, retirer les identifiants administrateur de son environnement :

```powershell
Remove-Item Env:BRAIN_MIGRATION_DATABASE_URL, Env:BRAIN_MIGRATOR_PASSWORD, Env:BRAIN_APP_PASSWORD, Env:BRAIN_TEST_MIGRATION_DATABASE_URL, Env:BRAIN_TEST_DATABASE_URL, Env:BRAIN_DEMO_PASSWORD -ErrorAction SilentlyContinue
python -m uvicorn brain.platform.api:create_app --factory --host 127.0.0.1 --port 8001
```

Dans une seconde console :

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Ouvrir **http://127.0.0.1:5173**. Le proxy ne cible que /api/v1 du serveur sécurisé
sur 8001. Ne pas utiliser `brain.api:app`, qui reste un démonstrateur anonyme séparé.
Le jeton est en mémoire uniquement : rechargement = nouvelle connexion. Aucune
variable BRAIN_* ni secret n'est requis dans l'environnement du serveur frontend.

## Parcours livrés

1. Se connecter et choisir une organisation autorisée. Le rôle courant est affiché.
2. Consulter le registre des départements, les graphes et les versions de modèles.
   ADMIN peut créer un espace et enregistrer ses départements.
3. Ouvrir un graphe : zoom/pan/minimap, sélection clavier ou souris, recherche,
   filtre de département, propriétés et provenance. La légende distingue les relations.
4. BUILDER/ADMIN créent une copie de version, éditent propriétés/ressources/relations,
   puis valident et enregistrent. La source et son historique sont conservés.
5. APPROVER/ADMIN publient après confirmation. BUILDER et VIEWER ne disposent pas
   de cette action. Une erreur serveur reste l'autorité même si le rôle a changé.
6. Consulter la DSL, l'IR, les variables, contraintes HARD, unités et traces des modèles.
   Les nouvelles versions de modèle s'éditent en JSON structuré, avec graphe publié
   explicitement référencé. La comparaison reste descriptive.
7. Lire un run conservé : objectif, unité canonique, vérification, bornes, gaps,
   options, avertissements, décisions et ressources. Aucun run → aucun KPI inventé.

Pour commencer sans graphe : enregistrer les départements, puis utiliser « Importer
un graphe JSON » dans Organization Graph. Le document attendu est GraphCreate,
soit `{graph, shared_parameters}`. Il est aussi le format de l'export du canvas.
La clé graph.organization.id doit être la clé métier de l'organisation active.
Les ajouts complexes de nœuds et paramètres restent possibles par JSON dans le
brouillon ; la validation serveur contrôle périmètres, provenance, unités et références.

Après publication du graphe, « Importer un modèle JSON » attend un OrganizationModel
assemblé, avec graph, fragments, shared_parameters, objectif et métadonnées. Les
fichiers project.json de Phase 3 référencent d'autres fichiers : les assembler avec
le chargeur Python existant avant import. Le navigateur ne suit pas ces chemins.
Pour copier entre organisations, modifier explicitement la clé du graphe et les
organization_id des fragments, puis relire les provenances ; aucun renommage implicite.

Les déplacements et filtres ne changent aucune équation et ne sont pas persistés.
Une relation DEPENDS_ON ne crée pas de règle, USES_RESOURCE ne mesure aucune charge.
Les consommations et contraintes viennent de ResourceUse/DSL et des rapports enregistrés.
Une capacité est affichée avec l'unité du paramètre ; l'unité de ressource est séparée.
Les bornes ou unités ne sont pas reconstruites par calcul dans le navigateur.

## Contrats et commandes de contrôle

Depuis la racine, puis frontend :

```powershell
python -m scripts.export_studio_contract
Set-Location frontend
npm.cmd run generate:types
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

OpenAPI et generated.d.ts sont versionnés ; les générateurs restent reproductibles.
AJV valide les réponses contre ce même schéma. Le code source n'importe aucun
template métier ni donnée de fixture ; seuls les tests et scripts de démo le font.

Pour les parcours réels, garder l'API et Vite actifs ; fournir le mot de passe de
démonstration par variable d'environnement locale, sans le commiter :

```powershell
Set-Location frontend
npm.cmd exec playwright -- install chromium
# BRAIN_DEMO_PASSWORD est fourni par votre environnement privé.
npm.cmd run test:e2e
```

Pour tester le code compilé : lancer `npm.cmd run preview` dans une autre console,
puis `$env:STUDIO_BASE_URL = 'http://127.0.0.1:5180'` avant test:e2e. Preview reprend
le proxy sécurisé ; c'est une vérification locale, pas un serveur de production.
Les tests réels créent des versions et une organisation synthétique supplémentaire.
Utiliser une base de démonstration, pas une base de données métier. Traces/vidéos
sont désactivées ; les captures explicites n'incluent ni formulaire de login ni jeton.
STUDIO_SCREENSHOT_DIR permet de changer leur répertoire ; la CI utilise
frontend/test-results/screenshots pour ne publier que les images de son exécution.

Les contrôles Python restent ceux de 4A avec les variables BRAIN_TEST_* :
`python -m pytest -q`, `python -m ruff check brain tests scripts migrations`,
`python -m mypy`. Les tests de reset de schéma ciblent exclusivement optimizer_brain_test.
La CI étend le job PostgreSQL avec Node 24, build/tests frontend et parcours réels,
dans une base de Studio distincte de la base réinitialisée par pytest.

## Captures et limites

Captures réelles après connexion : [usine](screenshots/studio-factory.png),
[université](screenshots/studio-university.png), [mobile 390 px](screenshots/studio-mobile.png).

Interface locale, Chromium testé. Pas de certification WCAG exhaustive, Safari ou
Firefox non testés, gros graphes non benchmarkés. Édition des contraintes en JSON,
pas d'éditeur algébrique complet ; layout non persisté ; aucun undo/merge collaboratif.
Les tokens en mémoire impliquent un relogin au rechargement. Une publication ADMIN
ne requiert pas un second acteur : la politique 4A n'impose pas quatre yeux.

Avant exposition publique : HTTPS, proxy d'exploitation, CSP adaptée aux validateurs,
politique de session et exploitation sont à concevoir. Aucun CORS ouvert ou cookie
n'est introduit pour les contourner. Aucun bouton Optimiser actif, endpoint de solve,
worker, Phase 4C/5 ou fonctionnalité LLM n'est fourni.
