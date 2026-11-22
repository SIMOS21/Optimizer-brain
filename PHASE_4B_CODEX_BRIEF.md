# Optimization Brain — Phase 4B: Visual Organization Studio

**Date:** 2026-11-22

**Statut:** cahier des charges pour Codex, non implémenté

**Dépôt:** https://github.com/SIMOS21/Optimizer-brain

**Base de travail:** `phase-4a-persistence-identity-governance`, commit `a6b6ee2` (ou la branche d'intégration actualisée)
**Périmètre:** **Phase 4B seulement**. Ne pas commencer les jobs de Phase 4C ni l'intelligence de scénarios de Phase 5.

## 0. Pré-requis obligatoires

Lire intégralement `AGENTS.md`, `OPTIMIZATION_BRAIN_SPEC.md`, `docs/platform-phase-4a.md`, `docs/validation-phase-4a.md`, `docs/organization-graph.md`, `docs/model-composition.md`, `docs/decision-records/0004-persistence-identity-governance.md` et examiner les contrats OpenAPI du serveur **sécurisé** `brain.platform.api:create_app`. Auditer réellement les schémas, permissions et endpoints avant d'écrire du code. La CI de 4A a réussi sur Ubuntu, Windows et PostgreSQL (run GitHub Actions `45028081054`). Ne jamais supposer qu'une fonctionnalité cible existe déjà.

Avant modification : rapport court d'audit, arborescence visée, parcours utilisateur, choix d'authentification frontend et test plan. Utiliser une branche dédiée `feature/phase-4b-visual-studio` sans modifier `main` directement.

## 1. Objectif produit

Livrer un **workspace web interactif** — pas un chatbot — qui représente le fonctionnement d'une organisation par un **Organization Graph** exécutable : départements, ressources, propriétaires, relations, contraintes et modèles globaux. Le backend reste la seule source de vérité. Le graphe visuel ne constitue pas une seconde interprétation mathématique ; une arête informative `DEPENDS_ON` n'ajoute pas d'équation. Le système doit clairement distinguer une relation visuelle d'une contrainte compilée.

**Parcours minimal:** se connecter → sélectionner une organisation autorisée → voir départements et graphes → ouvrir un graphe, inspecter les relations, ressources, capacités et provenance → créer un nouveau brouillon à partir d'une version source → valider et publier selon son rôle → ouvrir une version de modèle → voir l'IR/les contraintes et l'historique vérifié lorsqu'il existe. Aucune exécution de solveur depuis le navigateur en 4B : l'API de gouvernance 4A ne propose pas encore de POST de job.

## 2. Stack initiale et structure

- `frontend/` : React + TypeScript en mode strict, Vite, routeur accessible et client API typé. Choisir une bibliothèque de graphe maintenue et justifier son intégration ; ne pas imposer une version particulière sans vérifier son contrat.
- Design responsive, accessible (clavier, labels, contrastes, états de chargement et d'erreur), clair et minimaliste, avec un vrai canvas zoom/pan, sélection de nœud et de lien, panneaux latéraux de propriétés, légende et recherche.
- Isolation stricte des composants de visualisation et des contrats métier (`api/`, `features/organizations/`, `features/graph/`, `features/models/`, `features/history/`, `shared/`). Pas de logique de solveur côté client.
- Aucun appel LLM nécessaire. Pas de génération de code Python à partir de l'interface.

## 3. Authentification et sécurité de navigateur

- Utiliser uniquement le service `brain.platform.api:create_app` (port 8001), **jamais** les endpoints anonymes de `brain.api:app`.
- Le backend 4A retourne un bearer token. Pour ce prototype local, garder le jeton **en mémoire uniquement** (pas `localStorage` ou `sessionStorage`), avec relogin après rechargement, ou proposer un design BFF/cookie HttpOnly + CSRF documenté avant implémentation si nécessaire. Ne pas introduire silencieusement des cookies ou un CORS ouvert.
- En développement : proxy Vite de même origine pour `/api/v1`, sans exposer les secrets ni contourner les contrôles backend.
- Respecter les rôles `ADMIN`, `BUILDER`, `APPROVER`, `VIEWER`. L'UI cache/désactive les opérations non autorisées, **mais le serveur reste l'unique autorité**. Gérer 401 (session expirée), 403, 404 masquant des ressources d'autres tenants, 409 versions, 422 entrées invalides et 413 taille de requête.
- Les détails d'un autre tenant ne doivent jamais être conservés dans le cache après un changement d'organisation ou une déconnexion. Ne pas mélanger les clés de cache entre organisations.
- Zéro token dans les URLs, logs, messages d'erreur ou snapshots de tests.

## 4. Fonctionnalités 4B — tranche verticale

### 4.1 Organization Workspace

Afficher les organisations accessibles uniquement, le rôle actif, les départements, les graphes publiés/brouillons et la navigation vers les versions. Écran de login, logout et états vides clairs.

### 4.2 Executable Organization Graph

- Rendre les départements, ressources et arêtes depuis **un snapshot publié ou brouillon réel** de l'API 4A ; ne pas inventer de connexion entre départements.
- Nœuds typés, étiquettes de propriétaire, capacité/unité/source/version, états DRAFT/PUBLISHED. Distinguer `DEPENDS_ON` des relations de partage de ressource.
- Inspection du graphe sélectionné, panneau de propriétés avec chemin vers la provenance, filtres de département et recherche de nœuds.
- Conserver les identifiants stables du modèle canonique, les ordres déterministes à l'export et la signification exacte des relations.
- Prévoir un éditeur de brouillon **limité aux opérations effectivement représentables et validables par l'API**. Un canvas drag-and-drop de placement n'est pas un changement mathématique ; les modifications de propriétés métier, elles, doivent produire une nouvelle version via validation et publication explicites. Ne pas prétendre à une édition persistante de positions si aucune persistance de layout n'existe : positions locales déterministes ou métadonnées non sémantiques isolées.

### 4.3 Constraint / Model Inspector

Afficher les variables, contraintes HARD, unités, paramètres et provenance d'une version persistée. Expliquer les liens connus entre une ressource et ses contraintes, sans extrapoler une dépendance non présente dans l'IR. Le backend existant ne couvre qu'un objectif HARD : aucune UI de SOFT/multiobjectif active.

### 4.4 Models & History

Liste des versions et états ; comparaison structurée des métadonnées et paramètres de deux snapshots si faisable sans nouveau moteur. Résultats historiques lisibles via GET `/optimization-runs`, uniquement s'ils existent. Ne pas inventer de KPI, de simulation ou de run. Afficher statut de vérification et garanties numériques uniquement tels qu'enregistrés.

### 4.5 Publication

Actions réservées aux rôles habilités ; aucune mutation en place. En cas d'erreur 409, proposer de recharger et de créer une nouvelle version, jamais d'écraser un snapshot. Confirmer visuellement l'action avant publication ; le backend assure l'autorisation.

## 5. Contrat des données

Toute page doit consommer les schémas réels de l'API sécurisée. Préférer génération de types depuis `/openapi.json`, figée dans le dépôt ou répétable, avec tests de compatibilité. Aucun `any` non justifié. Préserver décimaux, fractions et identifiants textuels : ne pas convertir automatiquement les montants significatifs en `number` JavaScript lorsque cela compromet la précision ; les valeurs sont affichées et non recalculées pour « prouver » un objectif.

L'API 4A ne propose pas de POST `/optimization-runs` : **ne pas ajouter un bouton actif « Optimiser » qui ne fonctionne pas**, ne pas appeler le backend legacy anonyme. Prévoir un emplacement explicitement marqué « disponible en Phase 4C » si utile.

## 6. Tests et Definition of Done

1. La suite Python existante continue de passer (baseline documentée : **304 tests**, Linux/Windows/PostgreSQL CI 4A).
2. Tests TypeScript : conversion API → graphe, identifiants, labels, unités, statuts, rôles et gestion d'erreurs.
3. Tests de composants : graphe avec arêtes réelles et sans arêtes inventées, ressources partagées, provenance, état vide.
4. Tests de parcours avec API réelle ou fixtures contractuelles fidèles : login → organisation → graph → modèle → publication autorisée → historique, plus refus 401/403/404/409.
5. Isolation tenant : déconnexion/change d'organisation purge les données de l'organisation précédente.
6. Vérifier que les modifications visuelles locales ne mutent aucun snapshot mathématique sans validation et version explicites.
7. UI testable au clavier, responsive, sans fuite de secret ; tests automatisés frontend (Vitest et, si raisonnable, Playwright).
8. `npm run build`, vérification des types, linter/tests frontend, puis `pytest`, Ruff et mypy exécutés ; consigner les résultats réels et ne pas inventer de réussite.
9. Documentation de lancement **Windows PowerShell**, configuration proxy, répertoire frontend, illustrations et écarts connus.
10. Démonstration sur les **deux graphes réels synthétiques** de la Phase 3 (usine, université), avec statuts et données réels. L'affichage du golden 4100 EUR ne doit être montré que dans le contexte d'une solution effectivement stockée.

## 7. Hors périmètre strict

Pas de worker, job asynchrone, nouvelle API de solve, exécution depuis navigateur, comparaison de scénarios avancée, diagnostic infaisabilité avancé, SOFT/multiobjectif, CP-SAT, LLM, synchronisation ERP/CRM, moteur de visualisation 3D, déploiement public HTTPS ou restructuration massive du kernel. Tout besoin d'endpoint nouveau doit être minimal, justifié, sécurisé et testé ; ne pas affaiblir la gouvernance 4A.

## 8. Sortie demandée à Codex

Commencer par plan/audit et un prototype vertical fonctionnel, puis itérer en modifications testées. Terminer avec **Livré / Tests / Limites / Prochaine action**, captures ou descriptions vérifiables de l'UI, et `docs/validation-phase-4b.md` + ADR pour les choix de sécurité/browser si nécessaire. Ne jamais qualifier la Phase 4B de livrée avant un parcours complet démontré avec l'API 4A réelle.
