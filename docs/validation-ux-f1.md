# UX-F1 — Navigation et fondations du Studio

## Audit initial

PR #6 fusionnée, main synchronisé en fast-forward sur `7c8b6bd` ; CI après
fusion [45229261084](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45229261084)
réussie. Branche `feature/ux-v2-foundation-navigation`. AGENTS, spécification,
roadmap et cinq fichiers `docs/ux-v2/` lus avant conception ; l'HTML est une
référence visuelle. L'architecture et le plan ont été présentés avant les éditions.

L'ancien App regroupait connexion, catalogue non borné et sélecteur natif ;
Workspace possédait sa propre navigation et chargeait ses quatre collections
avant chaque page. Les contrats existants, les gardes asynchrones et les rôles
ont été conservés. Aucun endpoint sécurisé ni moteur mathématique n'a changé.
Le fichier local non suivi `tatus` conserve son SHA-256 initial
`29ae5a2c4accb7dc1aadc718ef108caaecdfefddbde17de2913c4213183185f8`.

## Changements UX-F1

- Shell responsive : organisation active, navigation, rôle réel, identité,
  déconnexion et menu mobile. Toutes les URL précédentes restent utilisables.
- Métier à chaque nouvelle session, expert activable en mémoire. Les identifiants
  du shell/catalogue et certains libellés changent ; les autorisations serveur
  et les capacités des pages restent identiques.
- Annuaire : recherche française sur nom/clé/id, tri A–Z/Z–A, groupes explicites
  et six lignes par page de groupe. Aucun espace n'est supprimé. Les espaces
  `studio_import_` restent visibles dans leur groupe et recherchables.
- GET d'identité autorisée indépendant du catalogue pour les liens profonds ;
  effacement immédiat du tenant précédent et ignorance des réponses tardives.
- Tokens et primitives partagés, chargement, vide, erreurs publiques, focus,
  dialogues avec Échap et restitution du focus. Aucun ajout de dépendance.
- Environnement E2E PostgreSQL dédié et garde anti-base-démo. Le seeding E2E
  exporte ses propres fixtures et conserve les historiques des précédents runs.

Les décisions et limites sont détaillées dans l'[ADR 0011](decision-records/0011-ux-foundations-and-isolated-e2e.md).
Le [guide E2E](ux-f1-e2e-isolation.md) décrit les commandes de provisionnement,
tests, mesure et lancement interactif. Le Studio de démonstration garde ses
ports 8001/5180 ; le Studio E2E utilise exclusivement 8002/5181.

## Tests et captures

Validation locale Windows, Python 3.14.3, Node 24.13.0, PostgreSQL 17 et Chromium
159.0.8154.6. Résultats réellement exécutés :

| Contrôle | Résultat |
|---|---|
| pytest, PostgreSQL réel via le lanceur local existant | 478 réussis, 8 variantes SQLite ignorées |
| Vitest, tous les fichiers | 172 réussis, 12 fichiers |
| Playwright, API/PostgreSQL/worker réels | 39 réussis, 2 minutes |
| Ruff check et format | Réussis ; 67 fichiers contrôlés par format |
| mypy | Réussi, 46 fichiers source |
| TypeScript, ESLint, build Vite | Réussis |
| Syntaxe du script de mesure Node | Réussie |

Les tests ajoutés couvrent un catalogue de plus de 100 organisations, la recherche
hors page visible, accents, tri, groupes fiables, pagination, vide/erreur,
identité absente, réponse tardive même sans support d'abort, nouvelle session et
mode expert. Les tests Python et Vitest refusent les environnements E2E invalides.

Les parcours Playwright utilisent API, PostgreSQL et worker réels. Ils conservent
les parcours précédents (publications, scénarios contrôlés, diagnostics, jobs,
annulation, échec, INFEASIBLE et TIME_LIMIT) et ajoutent catalogue, quatre rôles
ADMIN/BUILDER/APPROVER/VIEWER dans les deux modes, lien profond après connexion,
réponse tardive et clavier mobile. Le cycle Tab du menu mobile a échoué pendant
le développement ; la primitive Dialog a été corrigée et le cas réel revérifié.
Les références calculées et indépendamment vérifiées restent **4100 EUR** pour
l'usine et **17** pour l'université. Les scénarios contrôlés ont leurs propres
résultats réellement calculés ; ils ne remplacent pas ces références.

La première CI de l'infrastructure E2E a détecté une assertion trop large sous
Windows : elle contrôlait aussi les variables système du runner. L'assertion
porte désormais sur les espaces de noms Brain/Studio effectivement filtrés,
avec un cas de non-régression pour les métadonnées système sans rapport.
Une autre vérification couvre la resélection du tenant actif pendant un
chargement : elle conserve ses requêtes, dont l'identité n'a pas changé.

Les captures suivantes sont issues des mesures, sans données métier réelles ni
secrets. Le contenu des pages métier existantes est volontairement conservé.

| Vue | Avant | Après |
|---|---|---|
| Catalogue 1440 px | [PNG](screenshots/ux-f1/before/organizations-1440.png) | [PNG](screenshots/ux-f1/after/organizations-1440.png) |
| Organisation 1440 px | [PNG](screenshots/ux-f1/before/organization-1440.png) | [PNG](screenshots/ux-f1/after/organization-1440.png) |
| Catalogue 390 px | [PNG](screenshots/ux-f1/before/organizations-390.png) | [PNG](screenshots/ux-f1/after/organizations-390.png) |
| Organisation 390 px | [PNG](screenshots/ux-f1/before/organization-390.png) | [PNG](screenshots/ux-f1/after/organization-390.png) |

## Métriques observées

Trois contextes Chromium neufs par largeur et version, même machine et mêmes
références. Baseline mesurée avant modification du frontend. Mesure finale sans
autre suite de tests concurrente. Les durées incluent l'automatisation des
interactions. Données brutes : [avant](metrics/ux-f1-before.json) et
[après](metrics/ux-f1-after.json). Médianes en millisecondes :

| Parcours | 1440 avant | 1440 après | 390 avant | 390 après |
|---|---:|---:|---:|---:|
| Connexion → catalogue | 254,2 | 244,6 | 128,8 | 227,7 |
| Ouverture → graphe enregistré accessible | 215,7 | 229,8 | 122,2 | 200,9 |
| Navigation chaude → liste des graphes | 46,4 | 51,7 | 71,6 | 58,2 |
| Changement d'organisation → nouveau tenant | 105,8 | 181,3 | 91,3 | 175,9 |

Requêtes API inchangées dans tous les échantillons : 3 jusqu'au catalogue, 5
supplémentaires à l'ouverture, 0 pour la navigation chaude. Aucun débordement
horizontal observé dans ces parcours. Les six références immuables usine et
université ont le même digest avant/après. Aucune mutation métier n'est permise
par le script de mesure ; seule l'authentification est autorisée.

Le nouveau changement d'organisation comprend ouverture du dialogue, recherche
et choix, alors que l'ancien sélecteur natif demandait une seule action. Le
temps mobile de connexion et d'ouverture augmente aussi dans cet échantillon.
Il n'y a donc aucune affirmation de gain général de fluidité. Le DOM du catalogue
est borné par pagination ; réseau et chargement des collections ne sont pas
optimisés dans UX-F1. La mesure de navigation chaude démarre après ouverture du
menu mobile ; elle ne mesure pas le coût complet de ce menu.

## Limites et prochaine tranche

Le catalogue complet reste chargé via les pages serveur existantes ; la recherche
et la pagination sont locales. Pas de virtualisation, de recherche serveur ni de
benchmark de milliers d'organisations. Le Workspace conserve le chargement des
quatre collections. Les écrans non refondus gardent leur terminologie et leurs
outils techniques dans les deux modes. Aucune certification WCAG, lecteur
d'écran ou validation Safari/Firefox n'est revendiquée ; Chromium desktop/mobile
et scénarios clavier sont testés. Les mesures locales à trois échantillons ne
constituent ni un SLA ni une mesure INP en production.

La base E2E conserve ses données et peut croître ; aucun nettoyage automatique
n'est ajouté. Le lanceur ne gère pas une exécution simultanée sur les mêmes ports
et la même base. Les historiques de démonstration et fixtures versionnées restent
inchangés. UX-F2 pourra traiter le dashboard et le chargement de ses collections
dans une PR distincte, après revue de cet incrément. UX-F3, 5B-3, 5C et LLM ne
sont pas commencés.
