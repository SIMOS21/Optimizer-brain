# Audit et plan Phase 4B — Visual Organization Studio

Le brief fourni dans Downloads, AGENTS.md, les 1128 lignes de la spécification,
les documents Phase 4A, organization-graph.md et model-composition.md ont été lus.
Base : branche `phase-4a-persistence-identity-governance`, commit `a6b6ee2`.
Branche de travail : `feature/phase-4b-visual-studio`. `main` reste inchangée.
Le fichier non suivi `tatus` est préexistant et conservé hors commit.

Baseline locale réellement répétée : **304 passed, 2 warnings in 56.74s**,
avec PostgreSQL réel et aucun skip. La réussite CI 4A indiquée dans le brief est
une information fournie ; elle ne remplace pas cette exécution locale.

L'API sécurisée porte déjà le RBAC et les publications immuables. Les créations
valident atomiquement avant stockage ; aucun PATCH de contenu, layout persistant,
endpoint de job ou résolution n'existe. `ArtifactResponse.document` est trop générique
dans OpenAPI : trois réponses de détail typées documenteront exactement les documents
déjà renvoyés, sans nouvelle logique mathématique ni modification des JSON existants.

## Plan avant implémentation

1. Contrats : typer les documents de détail côté `brain/platform/`, exporter OpenAPI
   de manière reproductible et générer les types TypeScript ; tester leur compatibilité.
2. `frontend/` : React/TypeScript strict/Vite, routeur, client fetch typé, jeton en
   mémoire, annulation des requêtes et remontée des erreurs sans recopier les secrets.
   Chaque workspace est démonté au changement d'organisation ou de session.
3. `features/graph/` : React Flow pour zoom/pan, déplacement local, sélection,
   clavier et inspecteur. Conversion déterministe ; seules les arêtes API sont dessinées.
   Recherche, filtres, ressources, provenance et relations restent distincts des équations.
4. Édition : copie détachée en mémoire, formulaires de propriétés/relations/capacités,
   nouvelle version explicite et validation/enregistrement serveur, puis confirmation
   de publication selon le rôle. Aucune mutation de la source ou des positions persistées.
5. `features/models/` et `features/history/` : DSL, contraintes HARD, traces et IR
   du backend ; comparaison descriptive de versions et affichage des runs existants.
   Aucun bouton actif de calcul, aucune inférence d'un prix d'ombre ou d'un optimum.
6. Vitest/Testing Library, parcours Playwright sur les deux exemples via l'API
   PostgreSQL réelle, responsive/clavier, refus d'accès et purge tenant ; conserver
   pytest/Ruff/mypy. Documentation PowerShell, ADR et captures sans secrets.

## Parcours et sécurité

Connexion → organisation autorisée → graphe réel → inspection et copie versionnée →
validation/enregistrement → publication confirmée → modèle et historique enregistré.
Un ADMIN peut enregistrer un département ; BUILDER prépare, APPROVER publie, VIEWER
consulte. Les contrôles serveur restent l'autorité, même si un rôle change en cours
de session. Proxy Vite même origine vers 127.0.0.1:8001, aucun cookie/CORS permissif,
aucun stockage navigateur du jeton. Logout et changement de tenant annulent les
requêtes et détruisent les données/éditeurs locaux, y compris les réponses retardées.

Les positions n'ont aucun sens mathématique et ne sont pas envoyées au backend.
DEPENDS_ON n'ajoute aucune équation ; USES_RESOURCE n'est pas une consommation.
Les capacités/coefficients restent textuels ; le navigateur n'optimise ni ne certifie.
Risques : payload générique, précision JSON, réponses asynchrones d'un ancien tenant,
arêtes implicites et fausse publication. Ils sont couverts par contrats générés,
parsing précis, isolation de cycle de vie et tests de correspondance API/canvas.
