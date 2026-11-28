# Validation — NVIDIA NIM Gateway, première tranche 7A

28 novembre 2026. Branche `feature/nvidia-nim-llm-gateway` ; base main
`4666308ccc181fc10a71838688dc70a3fd9ec0ce`.

## Audit préalable et préservation

PR #12 fusionnée, CI main
[46083598613](https://github.com/SIMOS21/Optimizer-brain/actions/runs/46083598613)
réussie avant création de branche. `main` synchronisé par fast-forward depuis
`origin/main`. Un seul worktree et aucun changement suivi au départ. AGENTS,
spécification intégrale, sections 5.2/11, roadmap, validation 5B-3 et contrats
réels de lecture, comparaison, vérification, cockpit et identité examinés.

`tatus` reste non suivi avec le SHA256
`29AE5A2C4ACCB7DC1AADC718EF108CAAECDFEFDDBDE17DE2913C4213183185F8`.
`.local/`, données de démonstration et historiques conservés. Tests uniquement
sur `optimizer_brain_test` et `optimizer_brain_e2e`, pas de purge de démonstration.
Aucune modification du kernel, compositeur, HiGHS, vérificateur, tables ou migrations.

## Livraison et frontière de confiance

| Couche | Réalisation |
|---|---|
| `brain/llm_gateway` | Contrats 7A.1 fermés, contexte déterministe masqué, validation du JSON fournisseur et rendu français depuis les faits serveur |
| Adaptateur NVIDIA | HTTP hébergé, configuration externe, clé masquée, limites de corps/tokens, timeouts, refus des redirects/proxies et erreurs fermées |
| Services sécurisés | Reconstruction/revérification 5B-3 réutilisée, RLS/RBAC, consentement booléen strict, autorisation explicite des tenants et manifestes publics/synthétiques |
| Quotas | Réservation d’audit durable sous verrou PostgreSQL, avant I/O ; échecs comptabilisés, concurrence bornée par processus |
| Studio | Panneau fermé par défaut dans les runs et comparaisons, questions guidées, JSON à transmettre, consentement, faits séparés, liens réels, expert et protection des réponses tardives |
| CI | Faux fournisseur explicite dans une factory exclusivement E2E locale ; passage historique distinct avec NVIDIA désactivé |

Le LLM ne reçoit ni texte métier ni outil. Il sélectionne des alias de faits
exacts ; il ne fournit pas de prose arbitraire. Le serveur rend les paragraphes
et insère les chiffres, statuts et qualifications. Une sortie contenant un nombre
inventé, une assertion libre, un doublon ou un alias inconnu est refusée, même
si elle ressemble à du JSON valide. Les statuts et limites essentiels ne peuvent
pas être supprimés par la sélection du LLM.

Les faits exportés sont uniquement des alias, catégories et rationnels sous
forme de chaînes. Les références identifiantes et unités restent dans la réponse
locale autorisée. La liste des manifestes publics/synthétiques est une décision
opérateur explicite, distincte du consentement du lecteur. Pas de classification
automatique de la confidentialité d’un nombre, pas de données confidentielles
dans cet essai hébergé. Aucun prompt, clé ou réponse brute dans les logs applicatifs.

Les premières dix mesures de chaque type et côté bornent le contexte ; une
troncature est signalée. Un plan absent ou refusé ne livre aucun objectif ni
décision exploitable. La saturation ne démontre ni causalité ni prix d’ombre.
Les comparaisons 4100/3500 et 17/10 restent des écarts observés qualifiés, sans
gain économique inventé. Aucune Phase 5C/6, proposition de contrainte ou action métier.

## Modèle et vérifications NVIDIA réelles

La documentation de Llama 3.3 mentionne le français, mais cet identifiant était
absent du catalogue public réel observé. Le choix par défaut est donc
`nvidia/nemotron-3.5-lightning-30b-a3b`, effectivement présent dans `GET /v1/models`.
La carte officielle documente le français et la licence OpenMDW 1.1 ; voir
l’[ADR 0015](decision-records/0015-optional-nvidia-grounded-explanations.md) pour
les sources, limites publiées et conditions distinctes du service d’essai.

Sondes sans données métier : `/v1/models` → **HTTP 200** ; POST vide à
`/v1/chat/completions` → **HTTP 400** ; requête structurée minimale avec le modèle
choisi et un message de connectivité synthétique, sans clé → **HTTP 401**.
Ces résultats prouvent la présence dans le catalogue et l’accessibilité réseau,
pas une inférence authentifiée. Aucune clé NVIDIA configurée ; aucun coût,
latence, qualité linguistique ou taux de conformité hébergé mesuré. Aucun tarif
par token ni quota gratuit illimité supposé. Ne pas confondre licence du modèle,
licence NIM auto-hébergé et conditions/crédits du service hébergé.

## Contrôles réellement exécutés

Environnement local : Windows, Python 3.14.3, Node 24, PostgreSQL 17, Chromium
Playwright ; CI Python 3.11 Linux/Windows. Les rapports CI du commit livré sont
référencés dans la PR de revue.

| Contrôle | Résultat |
|---|---|
| Première suite Python complète | 590 réussis, 9 ignorés, 283,15 s, avant ajout des cas complémentaires |
| Suite Python finale avec PostgreSQL réel | 602 réussis, 9 ignorés, 382,97 s |
| Ruff check | Réussi sur `brain tests migrations scripts` |
| Ruff format du périmètre CI | Réussi, 81 fichiers |
| mypy strict | Réussi, 56 sources |
| TypeScript / build / ESLint | Réussis |
| Vitest final | 284 réussis, 19 fichiers, 18,16 s |
| Playwright assistant, API/RLS PostgreSQL réels, fournisseur simulé | 8 réussis, 15,3 s sur le build final |
| Playwright historique, NVIDIA désactivé | 67 réussis, 8 tests assistant ignorés puis exécutés séparément, 7,2 min |

Les neuf skips de cette suite Python correspondent aux huit variantes SQLite déjà remplacées
par leurs contrôles PostgreSQL et au contrôle concurrent de quota, garanti
uniquement sous PostgreSQL. Les quatorze tests historiques sont conservés.
Les 27 tests du contexte/transport ont aussi été rejoués avec succès après le
dernier réglage du budget de raisonnement. Les captures CI historiques et
assistant sont publiées dans deux artefacts distincts pour éviter leur écrasement.

Couverture nouvelle : plan optimal réellement revérifié, témoin faisable sans
preuve d’optimalité, absence de plan INFEASIBLE/TIME_LIMIT, vérification refusée,
comparaisons de deux secteurs réellement calculées, nombres/assertions inventés,
JSON ambigu et enveloppes fournisseur invalides, injections métier exclues du
contexte externe, modèle privé, clé absente, timeout/rate-limit/indisponibilité,
réservation persistante après échec, concurrence PostgreSQL, intégrité historique,
droits des quatre rôles, session et appartenance révoquées pendant l’appel,
changement de tenant, double clic, réponse tardive et contrat client falsifié.

Les huit parcours assistant utilisent VIEWER sur l’usine et ADMIN sur l’université,
conformément aux appartenances existantes. La comparaison E2E assistant utilise
une paire identique explicite ; les paires modifiées 4100/3500 et 17/10 sont
couvertes par les calculs Python réels, les contrats Vitest et les parcours
historiques 5B-3 avec API et worker réels. Les simulations réseau d’erreur 503 et
d’expiration 401 sont identifiées ; révocations réelles et quotas sont aussi
testés dans l’API PostgreSQL. Aucun test ne requiert de clé NVIDIA réelle.

Les premiers tests frontend ont révélé des erreurs de fixtures : contrat de
session incomplet, attente d’une erreur au lieu de l’abandon de session existant,
et VIEWER sans appartenance universitaire. Ils ont été corrigés sans élargir
RBAC ni augmenter les délais. La correction des appartenances de test a permis
le passage complet des huit parcours assistant.

Une validation complète ultérieure a été interrompue pendant un arrêt administratif
du conteneur PostgreSQL : journal `received fast shutdown request`, erreurs
`the database system is shutting down`, conteneur sorti avec code 137, indicateur
OOM false. Les passages interrompus ne sont pas comptés comme réussis. Le
conteneur existant a été redémarré, son volume conservé, puis les suites relancées.
Aucun timeout, retry ou contrôle n’a été assoupli pour cet incident.

## Captures et consultation

Quatre captures réelles du Studio compilé et de l’API PostgreSQL, avec fournisseur
simulé identifié : [usine desktop](screenshots/nvidia-nim/factory-1440.png),
[usine mobile](screenshots/nvidia-nim/factory-390.png),
[université desktop](screenshots/nvidia-nim/university-1440.png),
[université mobile](screenshots/nvidia-nim/university-390.png).
Viewports 1440/390 × 1040, défilés vers le panneau et les faits ; pas de montage.
Les parcours contrôlent clavier, mouvement réduit et absence de débordement de
page. Inspection visuelle desktop/mobile effectuée ; aucune certification WCAG
ni mesure de fluidité/inférence NVIDIA revendiquée.

## Limites et prochaine action

Le produit livré est un assistant guidé : pas de chat ouvert ni de prose libre,
mémoire, RAG, outil ou écriture. La pertinence de la sélection peut varier ; les
faits et limites restent contrôlés. Les explications ne sont pas persistées comme
décisions, seuls les audits de réservation sont durables. Une déconnexion ou un
échec consomme le quota. La concurrence globale est bornée par processus, pas
par un sémaphore distribué ; le quota horaire reste partagé en PostgreSQL.

Le timeout socket et les contrôles de temps entre lectures ne constituent pas
une garantie de deadline murale stricte. Les compteurs d’essai réutilisés en E2E
restent soumis au quota, sans purge. Le catalogue fournisseur peut changer et
une sortie hors schéma échoue fermée. Un opérateur privilégié qui falsifierait
toutes les preuves ne serait pas détecté par de simples checksums.

Prochaine action : revue de la PR, puis test d’inférence authentifiée avec une
clé injectée côté serveur et les seuls modèles synthétiques autorisés. Ne pas
mettre de clé dans le chat ; ne pas activer l’essai sur des données confidentielles.
Aucune fusion automatique.

## Correctif de relance E2E POSIX après la première CI

Le commit initial `4431896` a passé les jobs Ubuntu/Windows, les 602 pytest et
284 Vitest PostgreSQL et les 67 parcours historiques, pour le push et la PR.
Le second lanceur a toutefois été refusé avant les huit tests assistant sur
les deux runners Linux. La sonde `bind` sans réutilisation prenait une connexion
fermée en `TIME_WAIT` pour un serveur encore en écoute.

Reproduction sur le noyau Linux du conteneur existant, avec sockets locales
éphémères et sans modification de PostgreSQL : serveur actif refusé, sonde simple
refusée après fermeture, sonde avec `SO_REUSEADDR` acceptée. Le
[comportement POSIX documenté](https://docs.python.org/3/library/socket.html#socket.create_server)
justifie ce réglage sur POSIX uniquement. Windows conserve sa sonde exclusive.
Deux tests couvrent la socket fermée et le refus maintenu d’un véritable listener.
Pas de délai ou retry ajouté, pas de réutilisation d’un service utilisateur.
Les résultats du correctif sont consignés dans la PR, sur son nouveau SHA.

Reproduction et configuration : [guide 7A](nvidia-nim-gateway.md).
