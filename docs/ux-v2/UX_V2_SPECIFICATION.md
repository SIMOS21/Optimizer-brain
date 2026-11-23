# Optimization Brain — UX V2 / Design Specification

**Statut :** proposition à valider. **Aucun changement du dépôt, du backend ou de la base.**

## Vision

Une interface métier simple par défaut et un mode expert transversal. Un « mode » est une préférence de présentation, jamais un mécanisme RBAC. Toutes les actions sensibles continuent d'être autorisées uniquement par les endpoints FastAPI sécurisés, la gouvernance publiée et les protections PostgreSQL RLS existantes.

## Personae et tâches

| Profil | Besoin premier | Écran d'entrée |
|---|---|---|
| Direction / décideur | Comprendre le dernier plan, ses limites et les décisions accessibles | Tableau de bord |
| Responsable métier | Identifier ses ressources, proposer une hypothèse autorisée, solliciter validation | Organisation / Scenario Lab |
| Analyste / ingénieur | Inspecter variables, contraintes, provenance, vérification, formulations | Mode expert |
| Administrateur | Gérer rôles et publications selon les permissions existantes | Administration (projection des capacités existantes) |
| Lecteur | Explorer sans déclencher de mutations | Tous écrans en consultation |

## Architecture d'information V2

### Mode métier (par défaut)

1. **Tableau de bord** : dernière décision vérifiée, objectif avec unité, marges/capacités, pistes d'examen sourcées, accès « Comprendre » / « Explorer une hypothèse ».
2. **Mon organisation** : carte métier des départements et ressources ; fiches contextuelles ; filtres ; respect strict de la différence entre arête informative et contrainte mathématique.
3. **Optimisation** : choix d'un modèle publié, options essentielles avec valeurs validées serveur, lancement idempotent, suivi technique distinct du statut mathématique, annulation demandée vs confirmée.
4. **Scenario Lab** : référence → changement autorisé → preview serveur → validation → graphe et modèle publiés explicitement → résolution réelle. Aucun gain avant 5B-3.
5. **Décisions & historique** : liste filtrable des jobs/runs, statut mathématique qualifié, plan vérifié ou absence de solution, explications et détails sur demande.

### Mode expert (progressive disclosure)

Sur les mêmes routes, panneaux « Modèle / IR / contraintes », « Traçabilité », « Rapport du vérificateur », « Paramètres du solveur », « Audit et permissions » et « Données brutes » ; pas de duplication du backend. Les JSON/identifiants ne dominent plus la vue métier.

## Parcours prioritaires

A. **Comprendre le résultat** : choisir organisation → dashboard → dernière décision disponible → mesurer la ressource saturée → ouvrir les détails du résultat → consulter diagnostic exact si enregistré.

B. **Exécuter** : modèle publié → vérifier settings → lancer avec clé idempotente → suivre QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED → lire le statut du solveur distinctement → ne montrer le plan que si vérifié.

C. **Modifier une hypothèse** : politique publiée et utilisable → délégation nominative → choix SET numérique, domaine et unité → preview serveur → confirmation figée/idempotente → owner ACK et publications selon ordre réel des contrats → job via worker → run vérifié. Adapter le positionnement chronologique des validations à l'API existante : la publication de politique nécessite l'accord du propriétaire AVANT le scénario, puis publication du nouveau graphe et du modèle.

D. **Lecture seule** : rôle VIEWER → navigation, recherche et consultation des artefacts autorisés ; aucune commande active de modification ni accès élargi via le mode expert.

## Page 1 — Tableau de bord

### Composants

- En-tête clair, organisation et statut de démo.
- Objectif du run récent, unité, statut mathématique et qualité de preuve (toutes valeurs sourcées).
- Decision highlights (quantités A/B du cas usine si référence correcte).
- Ressources (capacité, consommation, reste), mini-barres dimensionnées par valeurs vérifiées.
- Points d'attention : « saturée » n'implique pas « ressource économiquement profitable à augmenter ».
- CTA comprendre résultat, explorer scénario, lancer optimisation avec garde de permissions.

### États

No-run : empty state pédagogique ; loading : skeleton local ; API error : retry ciblé ; revoked : aucun accès ; INFEASIBLE : pas de décision.

## Page 2 — Organisation

- Carte métier (départements, ressources, responsables déclarés et dimensions). Clic sur nœud → détails ; sur relation → source et sens ; filtres recherche/département ; zoom/fit ; panneau droit contextualisé.
- Mode expert : graphe typé, relations, contraintes réellement compilées, provenance, JSON secondaire.
- Aucune arête ajoutée ou consommations recalculées à partir de la seule topologie.
- L'organisation universitaire doit utiliser ses vraies données, pas une carte inventée.

## Page 3 — Optimisation

- Sélection explicite du modèle PUBLISHED (no DRAFT), paramètres solveur validés, « démarrer » seulement ADMIN/BUILDER.
- Job suivi sans chevauchement de polling, pause onglet, reprise explicite après 300 lectures, états séparés ; bouton d'annulation réservé creator/ADMIN en respectant la vérification serveur.
- Jamais de pourcentage de progression inventé, de plan affiché sans preuve ou de SUCCEEDED associé implicitement à OPTIMAL.

## Page 4 — Scenario Lab

- Parcours de validation clair, policy change card, owner ACK, délégataires explicites, preview serveur, création et publication en DRAFT.
- SET uniquement pour la tranche 5B-2 ; plage/unité/domaine du serveur ; prévisualisation n'est pas un solve.
- Modes expert et lecteur ; traitement des réponses incertaines par répétition de même corps/clé et changement d'organisation.
- 5B-3 comparaison et gains montrés comme « à venir », pas de données produites artificiellement.

## Page 5 — Décisions & historique

- Liste paginée avec date, modèle, statut de calcul, statut du solveur, qualité de vérification et accès détail.
- Détail : valeur d'objectif + unité, décisions, marges et ressources, diagnostic, provenance/versions.
- Statuts : OPTIMAL (tolérances), FEASIBLE_NOT_PROVEN_OPTIMAL, INFEASIBLE, UNBOUNDED, TIME_LIMIT_NO_SOLUTION, SOLUTION_FAILED_VALIDATION, SOLVER_ERROR, etc., sans fausse solution.
- Rapprochement de scénarios et gains : hors périmètre jusqu'à livraison testée de 5B-3.

## Design system

- **Couleurs** : Navy #17304A, Teal #087D70, fond #F5F8FB, surface #FFFFFF, bordure #DCE5EE, warning #BD8034, error #AE4B48. Les couleurs ne constituent jamais le seul indicateur d'état.
- **Typographie** : Inter / Segoe UI ; corps 14–16px, titres 28–36px, labels au moins 12px ; unités visibles.
- **Espacements** : échelle 4/8/12/16/24/32/48 ; radius 8/10/14 ; focus visible et navigation clavier.
- **Composants** : app-shell, nav, cards, KPI-with-evidence, status-chip, resource-meter, data-grid, trace-details, inspection-drawer, wizard, confirmation dialog, notification, empty state, skeleton, retry panel.
- **Responsive** : desktop large 1440, notebook 1280, tablette ~768, mobile ~390 ; tableau scrollable, sidebar remplacée par nav compacte.
- **Accessibilité** : cible WCAG 2.2 AA ; couleur + texte, tabulation, labels, notifications ARIA, tests clavier, zoom, réductions de mouvement.

## Fluidité et performance

- Profilage préalable (React Profiler, Performance API, réseau) ; hypothèse actuelle : Workspace charge plusieurs collections avant le rendu. Vérifier avant optimisation.
- Charger chaque écran selon ses besoins ; cache borné par organisation/utilisateur, invalidation au changement de tenant, abort requests tardives, pagination et virtualisation mesurées.
- GraphCanvas : mémorisation des nœuds et arêtes, éviter des objets instables dans chaque render, layout/cadrage mesurés ; ne pas calculer les mathématiques côté navigateur.
- Cibles de test proposées (à valider et mesurer) : interaction de navigation perçue <200ms sur une session chaude ; sortie immédiate de données de tenant précédent ; affichage « en cours » sans blocage ; aucun freeze de 500ms sur les graphes démo. Aucune garantie revendiquée avant profilage.

## Données et tests E2E

- L'actuel `frontend/tests/e2e/studio.spec.ts` génère `studio_import_<Date.now()>` et « Organisation synthétique importée ». Cette cause probable de pollution des démos doit être corrigée par séparation stricte d'une DB E2E jetable et de la DB démonstration — sans purge automatique des organisations existantes.
- Conserver 4100 EUR usine (A=40, B=15), 95/100h machines, 7000/8000 EUR budget, 55/55 logistique ; université score 17, 9/9 budget, 2/2 salles. Un scénario usine capacité logistique 45 a donné 3500 EUR, université 1 salle score 10 dans les tests 5B-2 : exemples documentés, **pas** des gains.
- Chaque nombre affiché par le produit connecté doit provenir d'un artefact réel, avec sa qualification, sa date et sa version.

## Plan d'intégration après validation des maquettes

1. Base UX et isolation des données de test, sans migration destructive.
2. App shell métier/expert + navigation et organisation picker.
3. Dashboard décisionnel connecté aux runs réels.
4. Carte organisationnelle et inspector contextuel.
5. Optimization Center et Decision Cockpit.
6. Scenario Lab guidé + historique lisible.
7. Mesures de performance, accessibilité, permissions et E2E sur PostgreSQL/worker réels.

### Invariants de non-régression

Ne pas modifier kernel, compositeur, HiGHS, vérificateur, migrations ou historiques pour « améliorer l'UX ». Conserver OpenAPI typé, RLS, RBAC, idempotence, publication explicite, validation indépendante et annulation. Aucun LLM ni lancement de Phase 5B-3 dans cette refonte.

## Limites du prototype HTML

Le prototype est autonome, hors dépôt, sans connexion API ni écritures en base. Les boutons de scénario et job simulent seulement le **parcours UX** ; les valeurs connues viennent des tests documentés. Le prototype n'accorde aucune autorisation, ne lance aucun solveur et ne saurait valider l'architecture de production.
