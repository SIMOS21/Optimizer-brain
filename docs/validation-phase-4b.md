# Validation Phase 4B — 22 novembre 2026

Portée : **Visual Organization Studio uniquement**, selon PHASE_4B_CODEX_BRIEF.md.
Base : `phase-4a-persistence-identity-governance` / `a6b6ee2` ; branche dédiée
`feature/phase-4b-visual-studio`. Voir [audit préalable](audit-phase-4b.md),
[guide](studio-phase-4b.md) et [ADR 0005](decision-records/0005-visual-studio-browser-contracts.md).

## Livré

React/TypeScript strict, Vite, React Router, React Flow : authentification en mémoire,
sélecteur d'organisations autorisées, registre de départements, listes/versionnage,
canvas interactif, recherche/filtre, provenance, éditeur de copie, import de graphe
et modèle JSON, publication confirmée, inspecteurs DSL/IR et historique réel.
La comparaison de versions porte seulement sur métadonnées et paramètres.

Le backend reçoit seulement des réponses de détail mieux typées pour OpenAPI.
Aucun nouvel endpoint, migration ou changement de kernel/compositeur/solveur/vérificateur.
Les JSON métier canoniques et les 304 tests antérieurs sont conservés.

## Résultats observés

Windows/PowerShell ; Python **3.14.3**, PostgreSQL **17.12**, FastAPI **0.143.2**,
Pydantic **2.12.5** ; Node **24.13.0**, npm **11.6.2**, React **19.3.1**,
TypeScript **5.9.3**, Vite **8.3.8**, React Flow **13.0.2**, Playwright **1.65.1**,
Vitest **5.1.1**. Les dépendances frontend sont verrouillées ; FastAPI/Pydantic
sont figés aux versions de génération testées.

| Contrôle réel | Résultat |
|---|---|
| Baseline avant modification, PostgreSQL inclus | **304 passed, 2 warnings in 56.74s** |
| Suite Python finale, SQLite et PostgreSQL | **311 passed, 2 warnings in 57.08s**, aucun skip |
| Vitest | **37 passed**, quatre fichiers, **8.02s** |
| Parcours Chromium sur bundle compilé + API/PostgreSQL réels | **13 passed in 16.7s** |
| Build frontend / types stricts | `npm run build` réussi, `tsc -b` sans erreur |
| Lint frontend | `npm run lint` réussi |
| Contrat généré | Export OpenAPI comparé au serveur par pytest ; `openapi-typescript --check` réussi |
| Ruff et mypy | Sans erreur ; mypy contrôle **32 fichiers** |

La suite Python utilise le harnais local ignoré de 4A : variables BRAIN_TEST_*
chargées sans les afficher, TEMP/TMP dans `%LOCALAPPDATA%/OptimizerBrain/temp`,
basetemp neuf et `-p no:cacheprovider`. Seule optimizer_brain_test est réinitialisée.
La démonstration et les parcours web utilisent une autre base, sans effacer ses
historiques. Les tests réels ajoutent des versions et des espaces synthétiques.

Les sept tests Python ajoutés vérifient OpenAPI, l'identité des compositions
canoniques, les décimaux précis et les espaces de noms distincts nœud/arête.
Les **304 tests antérieurs**, y compris les **14 historiques**, ne sont pas modifiés.

## Parcours réellement démontrés

1. Usine et université : connexion → tenant autorisé → graphe réel → sélection
   clavier de nœud **et d'arête** → déplacement local sans mutation API → export
   identique du snapshot → nouveau brouillon → publication confirmée → modèle
   compilé → nouvelle version publiée → comparaison descriptive → historique.
2. Les objectifs **4100 EUR** et **17 dans l'unité canonique count** sont lus dans
   des runs HiGHS conservés via le hook 4A revérifié. La solution d'usine du run
   garde qty_A=40 et qty_B=15. Le navigateur n'appelle aucun solveur ni LLM.
3. Création d'une organisation vide, enregistrement des départements, import de
   graphe, publication, import/compilation de modèle ; son historique vide ne
   récupère aucun objectif ou run d'une autre organisation, même à modèle équivalent.
4. VIEWER : pas de création/publication ni accès à l'université ; BUILDER : création
   d'un brouillon, publication absente. Les autorisations serveur restent testées
   par la suite Python, indépendamment de ces contrôles d'affichage.
5. Erreurs 401/403/404/409/422/413 injectées avec les vrais contrats HTTP autour
   du parcours réel : messages contrôlés, pas de corps sensible réfléchi ; 401
   supprime la session. Les refus backend réels sont couverts par les régressions 4A.
6. Changement d'organisation et logout suppriment les vues précédentes ; recharge
   impose un login ; aucun Storage navigateur utilisé. Des tests unitaires simulent
   aussi un transport ignorant l'annulation et une réponse d'un autre tenant.
7. Viewport mobile **390 × 844** sans débordement horizontal. Captures desktop
   **1440 × 1040**, page complète ; lecture visuelle effectuée sur les images.

## Captures vérifiables

- [Studio usine](screenshots/studio-factory.png) : 4 départements, 3 ressources,
  4 relations enregistrées, panneau de provenance et snapshot publié.
- [Studio université](screenshots/studio-university.png) : 5 départements,
  2 ressources partagées, 6 relations réelles.
- [Studio mobile](screenshots/studio-mobile.png) : canvas, contrôles, inspecteur
  sous le graphe, légende et empreinte sans débordement horizontal.

Les captures sont prises après login, sans mot de passe ni bearer. Les fixtures
ne contiennent que des réponses métier synthétiques ; pas de session ou hash de
mot de passe. Le compte local de démo est studio_demo_admin, son secret est dans
`.local/studio/password.txt` ignoré par Git, sans reproduction dans les rapports.

## Limites réelles

Les deux warnings Python externes préexistants persistent (anyio/pytest et
Starlette/httpx). Le build émet un warning Rolldown sur la directive externe
`use no memo` de react-compiler-runtime ; les parcours sont validés aussi sur ce
bundle compilé. Un warning de couleurs NO_COLOR/FORCE_COLOR existe dans Playwright.
Aucune de ces sorties n'est assimilée à une erreur ni masquée dans les résultats.

Le bundle est séparé : entrée **497.47 kB / 139.28 kB gzip**, renderer du graphe
**252.52 kB / 86.81 kB gzip**, CSS **28.78 kB / 5.94 kB gzip**. Aucune promesse de
temps de chargement en réseau réel ou de performance sur un grand graphe.
Les tests de composants emploient des polyfills de géométrie jsdom ; le rendu réel,
clavier et responsive sont contrôlés séparément par Chromium. Pas de certification
WCAG exhaustive ni tests Firefox/Safari ou appareil mobile physique.

Les contraintes/fragments s'éditent en JSON structuré ; pas d'éditeur algébrique
complet. Les positions et filtres ne sont pas persistés. Les approbations restent
celles de 4A, sans politique à quatre yeux imposée. Les imports ne suivent pas les
références de projets multi-fichiers. Une annulation HTTP ne promet pas d'annuler
une transaction que le serveur aurait déjà validée ; l'idempotence protège la reprise.

Fondation locale : pas d'exposition publique HTTPS, BFF, politique CSP déployée,
MFA/SSO, jobs web, workers, scénarios avancés, Phase 4C/5 ou LLM. La CI distante
est étendue mais son succès n'est pas déduit des contrôles locaux de ce rapport.

## Prochaine action

Revue visuelle et fonctionnelle du Studio, puis définition des contrats de jobs
de 4C séparément. Aucun lancement de cette sous-phase dans la présente livraison.
