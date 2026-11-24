# Prompt Codex — Optimization Brain UX V2, incrément UX-F1

Tu travailles dans `SIMOS21/Optimizer-brain`.

**Mission :** commencer la refonte UX/UI V2, en **mode métier par défaut + mode expert de présentation**, en limitant cet incrément au shell, à la navigation et au sélecteur d'organisations. Ne pas commencer Dashboard UX-F2 ni Graph UX-F3 dans le même PR.

**Références** : `AGENTS.md`, `OPTIMIZATION_BRAIN_SPEC.md`, `docs/roadmap.md`, et les pièces jointes `UX_V2_SPECIFICATION.md`, `IMPLEMENTATION_PLAN_UX_V2.md`, `UX_V2_PROTOTYPE.html`. Le prototype HTML est une **maquette autonome**, pas un module à injecter tel quel.

## Prérequis non négociables

1. Inspecter `git status` et préserver tout fichier non suivi, en particulier `tatus`.
2. Vérifier sur GitHub que la PR #6 (5B-2 controlled changes) est **fusionnée dans main**, vérifier la CI après fusion ; si non, effectuer uniquement l'audit, sans branche de code ni modification.
3. Synchroniser main en fast-forward, puis créer une branche `feature/ux-v2-foundation-navigation`.
4. Inventorier les routes, rôles, contrats API et tests existants ; expliquer les changements prévus **avant d'écrire du code**.

## Fonctionnalités de la seule tranche UX-F1

- Décomposer `frontend/src/app/App.tsx` et la navigation de `features/organizations/Workspace.tsx` sans casser les routes existantes.
- Construire un `AppShell` desktop et responsive : marque, organisation active, navigation lisible, rôle, identité et déconnexion.
- Ajouter un switch `Mode métier` / `Mode expert` : métier à l'ouverture ; état de présentation uniquement ; aucun effet sur RBAC, RLS ou capacité d'API.
- Refondre le sélecteur d'organisations : recherche en français, tri, groupes clairement nommés, démo usine/université retrouvable, pagination/lazy loading de collections volumineuses ; ne pas lister des dizaines de cartes identiques au premier écran.
- Identifier les espaces générés par les tests seulement à partir d'un marqueur fiable tel que `studio_import_` ; ils restent accessibles, mais regroupés comme espaces de test. Ne jamais masquer arbitrairement un espace métier ni supprimer des organisations.
- Mettre en place des tokens CSS et primitives réutilisables accessibles (Focus, PageHeader, EmptyState, Skeleton, ErrorNotice, StatusChip) ; conserver les composants métier existants pendant la migration progressive.
- Les routes directes vers graphes, modèles, résultats, exécutions et scénarios doivent fonctionner sans redirection cassante.
- Prévoir une **base PostgreSQL E2E dédiée** en local. La CI actuelle utilise un PostgreSQL éphémère ; reproduire cette séparation localement avec garde anti-base-démo et documentation, sans reset ni purge.

## Sécurité & non-régression

- Aucun changement kernel, compositeur, solveur, vérificateur, backend, migrations métier, règles RBAC/RLS, workers, historiques ni document canonique.
- Aucun secret dans localStorage, URL, erreur affichée ou capture ; conserver la session en mémoire.
- Garder l'annulation/ignore des requêtes tardives après changement de tenant ; empêcher les données de l'organisation précédente de s'afficher même brièvement.
- Pas de nouveaux KPIs ou résultats simulés dans l'UI connectée ; pas de calcul mathématique React ; pas de LLM ; pas de Phase 5B-3.

## Tests, preuves, fin de tâche

- Vitest : organisations nombreuses, recherche, rôle, état métier/expert, changement de tenant, déconnexion, réponse tardive, organisation absente/erreur.
- Playwright : ADMIN, VIEWER ; retrouver usine/université ; ouvrir profond une route existante ; switch d'organisation sans fuite de données ; navigation clavier et écran mobile 390px.
- Tests E2E avec API/PostgreSQL réels sur base dédiée, **pas** de tests destructeurs sur la base de démo.
- Exécuter TypeScript, lint, build, Vitest, Playwright, les contrôles Python/CI appropriés. Mesurer avant/après les requêtes réseau et la navigation ; ne pas inventer de chiffres de performance.
- Capturer les écrans 1440px et 390px, vérifier accessibilité clavier, textes français et absence de scroll horizontal.
- Mettre à jour les guides et ouvrir une PR de revue, sans fusionner automatiquement.

**Livraison** : `Audit initial / Changements UX-F1 / Tests et captures / Métriques / Limites / PR / Prochaine tranche UX-F2`.
