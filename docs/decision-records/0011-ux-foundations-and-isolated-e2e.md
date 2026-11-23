# ADR 0011 — Fondations UX et environnement E2E isolé

Date : 23 novembre 2026. Statut : adopté pour UX-F1.

## Contexte et périmètre

Base `7c8b6bd`, après fusion de PR #6 et CI `45229261084` réussie.
L'application authentifiée mélangeait connexion, catalogue et navigation dans
App/Workspace. L'API sécurisée fournit un catalogue paginé par offset, sans
recherche serveur ni tri français. Les lanceurs locaux précédents réutilisaient
la base de démonstration et exportaient les fixtures dans le dépôt.

Le pack `docs/ux-v2/` est une référence de conception. Son HTML autonome n'est
pas intégré. Cet incrément concerne le shell et le catalogue ; le dashboard,
le graphe et les formulaires métier gardent leurs contrats et pages existants.

## Composition et présentation

App conserve la session en mémoire. AuthenticatedApp compose AppShell,
Navigation, OrganizationPicker et le Workspace existant. Les chemins des routes
restent identiques. Un contexte en mémoire choisit métier par défaut ou expert ;
il adapte les libellés de navigation et les identifiants visibles dans le shell
et le catalogue, sans intervenir dans les appels API ni les permissions.
Une nouvelle session revient au mode métier. Les écrans non refondus conservent
leurs détails techniques : le basculement complet de ces écrans n'est pas livré.

Le GET d'identité de l'organisation est indépendant du catalogue et de sa
pagination visuelle. Il confirme l'accès avant le montage du Workspace. Le hook
existant efface immédiatement les données dont l'identité a changé et ignore les
réponses tardives ; le Workspace est remonté par identifiant d'organisation.
La sélection explicite annule également les requêtes actives. Aucun jeton ou
choix de rôle n'est stocké dans localStorage, sessionStorage ou l'URL.

## Catalogue sans nouveau contrat backend

Le client continue de parcourir les pages serveur de 100 éléments, comme avant.
Recherche et tri portent sur l'ensemble autorisé reçu, pas sur une seule page.
La normalisation française ignore casse et diacritiques ; Intl.Collator assure
le tri des noms, avec identifiant comme départage stable. Chaque groupe affiche
au plus six lignes par page. Seul le préfixe explicite `studio_import_` identifie
un espace de test. Tous ces espaces restent consultables et recherchables.

Ce choix borne le DOM, pas le volume réseau ou la mémoire du catalogue. Aucun
endpoint backend n'est ajouté. Une recherche serveur pour de très grands
catalogues nécessiterait un contrat et une tranche distincts. Le chargement des
collections métier du Workspace reste également inchangé pour UX-F1.

## Accessibilité et composants

Tokens CSS, PageHeader, EmptyState, Skeleton, StatusChip et Dialog sont communs ;
ErrorNotice existant conserve ses messages publics et son rôle d'alerte. La
navigation utilise liens natifs, état courant et lien d'évitement. Le menu
mobile et le sélecteur utilisent des dialogues natifs, Échap, cycle de focus et
retour au déclencheur. L'état d'un statut reste textuel, jamais seulement coloré.
Les scénarios clavier sont vérifiés dans Chromium réel, sans prétendre à une
certification exhaustive d'accessibilité ou de lecteurs d'écran.

## Isolation de la validation

Le lanceur `scripts.studio_e2e` exige PostgreSQL local et le nom exact
`optimizer_brain_e2e`, avec identités migration/runtime distinctes. Les ports
8002/5181 doivent être libres ; aucun service existant n'est réutilisé. Le
provisionnement réexécutable applique les migrations existantes et ajoute les
fixtures synthétiques manquantes, sans reset, purge ni réécriture des historiques.
Les artefacts E2E sont exportés sous `.local/e2e`, jamais dans les fixtures
Vitest versionnées ou le manifeste de démonstration. Les processus enfants
reçoivent uniquement l'environnement runtime filtré. Le garde Playwright refuse
les anciens lanceurs ciblant la démonstration.

La mesure de navigation est en lecture seule hors authentification, sur les
mêmes références immuables, avant puis après refonte. Les données brutes et
captures sont versionnées avec le rapport. Elles ne constituent ni un SLA, ni
une preuve d'amélioration systématique : le dialogue de sélection change le
nombre d'interactions, et certains temps mobiles augmentent.

## Invariants

Aucun changement du backend, des migrations métier, du kernel, du compositeur,
de HiGHS, de la vérification indépendante ou des règles RBAC/RLS. Aucun nouveau
calcul mathématique dans React, aucun KPI simulé, aucun résultat fabriqué.
UX-F2, UX-F3, 5B-3, 5C et fonctions LLM restent hors périmètre.
