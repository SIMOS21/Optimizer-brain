# ADR 0015 — Passerelle NVIDIA facultative et assertions fermées

Date : 28 novembre 2026. Statut : adopté pour la première tranche 7A.

## Contexte et audit

Base `4666308ccc181fc10a71838688dc70a3fd9ec0ce`, PR #12 fusionnée,
CI main [46083598613](https://github.com/SIMOS21/Optimizer-brain/actions/runs/46083598613)
réussie. Un seul worktree ; `tatus` non suivi, empreinte préservée.
Instructions, spécification, sections 5.2/11, roadmap, validation 5B-3 et contrats
de comparaison, cockpit, authentification et gouvernance examinés avant édition.

Le service 5B-3 autorise les deux runs sous RLS, reconstruit les modèles et
snapshots, vérifie la filiation et revérifie les plans sur leurs IR originales.
Il fournit les valeurs rationnelles et les limites de comparabilité. Réutiliser
ce service évite de créer une seconde interprétation des preuves historiques.
Une explication d’un seul run utilise une comparaison de ce run avec lui-même.
Aucun solveur n’est invoqué par cette lecture.

## Décision : séparer sélection linguistique et autorité factuelle

`brain/llm_gateway` est importé seulement par l’application sécurisée. Aucun
appel de ce module depuis le kernel, HiGHS, le compositeur, le vérificateur ou
le worker. Son transport utilise la bibliothèque standard ; aucune dépendance
LLM/GPU ou nouveau service requis pour les calculs.

Le fournisseur reçoit un schéma fermé : intention guidée, alias `f0`, catégories
et valeurs rationnelles sous forme de chaînes. Il renvoie exclusivement :

```json
{"schema_version":"7A.1","fact_ids":["f0","f1"]}
```

Le serveur refuse les champs supplémentaires, doublons JSON, constantes non
JSON, alias inconnus ou répétés, prose, nombres et assertions libres. Une
réponse peut contenir au plus huit alias distincts. Les paragraphes français
sont rendus depuis les faits du serveur ; les qualifications, statuts et limites
de comparaison sont ajoutés même si le modèle les omet. Le client contrôle à
nouveau le contexte, le tenant, les références, les faits et les paragraphes.

Ce choix est volontairement plus restreint qu’un chatbot à prose libre. Une
validation JSON ou un filtre de chiffres ne pourrait pas empêcher une phrase
comme « cette capacité garantit un gain », ni un montant écrit en lettres.
Le modèle choisit les faits pertinents et leur ordre ; il ne rédige pas de
nouvelle assertion mathématique. L’interface indique cette frontière. Les
questions ouvertes, la mémoire conversationnelle et les diagnostics causaux
non démontrés ne sont pas livrés dans cette tranche.

Les statuts favorables exigent les contrôles 5B-3 existants. Un plan absent ou
refusé n’expose ni décision ni objectif exploitable. `INFEASIBLE` est un statut
déclaré, sans attribution d’une cause. Saturation, prix d’ombre et gain restent
distincts. Un écart observé n’est jamais présenté comme un gain économique.

## Fournisseur réellement annoncé

Le candidat documentaire initial `meta/llama-3.3-70b-instruct`, adapté au français,
était absent du catalogue public réel lors de l’audit. Le défaut retenu est
`nvidia/nemotron-3.5-lightning-30b-a3b`, présent dans `GET /v1/models` le 28 novembre.
La carte officielle annonce le français, 30B paramètres/3B actifs, un contexte
allant jusqu’à 1M tokens et la licence OpenMDW 1.1. Ces capacités publiées ne
constituent ni une mesure locale de qualité ni une garantie de disponibilité.

L’API hébergée documente `POST /v1/chat/completions`, `max_tokens` de 1 à 32768
et une limite distincte de raisonnement. Pour Lightning, `reasoning_budget=0`
évite de consacrer le petit budget de cette sélection à une trace libre.
Notre sortie est bornée à 512 tokens
par défaut, configurable entre 64 et 1024 ; tout arrêt par limite de tokens est
refusé. Aucun raisonnement libre n’est affiché. Le respect du schéma est validé
localement ; aucune garantie de génération contrainte côté fournisseur n’est
supposée. Un modèle externe configuré doit être testé avec ce contrat avant
activation ; aucune sélection automatique ni bascule silencieuse.

Les essais hébergés ont leurs conditions propres : usage interne d’évaluation,
pas de données confidentielles, crédits et limites du compte. Aucun tarif par
token ni quota gratuit illimité n’a été vérifié. La tarification GPU de NIM
auto-hébergé n’est pas une tarification de cet endpoint. Aucune clé n’étant
configurée, aucune inférence authentifiée ni latence/coût NVIDIA ne sont certifiés.

Sources primaires : [API](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-lightning-30b-a3b-infer),
[carte du modèle](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard),
[FAQ crédits](https://docs.api.nvidia.com/nim/docs/faq),
[conditions de l’essai](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf).

## Confidentialité et autorisation

Activation serveur explicite, liste d’organisations et liste d’empreintes
complètes de modèles publics/synthétiques autorisés. Une autorisation sur le
seul hash mathématique serait insuffisante pour identifier un manifeste complet.
Les deux modèles d’une paire doivent être autorisés. Un nouveau manifeste exige
une nouvelle autorisation opérateur. Le créateur d’un scénario n’acquiert aucun
droit d’export implicite. Aucun rôle supplémentaire n’est accordé en mode expert.

Prévisualisation locale avant consentement : JSON externe exact, références et
faits contrôlés. Tout membre actif, dont VIEWER, peut demander une explication
des artefacts autorisés à l’export. Les secrets, noms, URLs, auteurs, descriptions,
identifiants de ressources et sources, documents, unités et questions libres ne
font pas partie du contexte externe. Les identifiants restent dans la réponse
locale autorisée pour les liens de provenance. Les données métier ne deviennent
jamais des instructions. Aucun outil d’écriture, SQL, shell ou résolution fourni.

L’approbation opérateur de données publiques/synthétiques demeure une décision
humaine : le système ne prétend pas classifier automatiquement la confidentialité
d’un nombre. Le consentement d’un lecteur ne suffit pas à autoriser un modèle
absent de la liste serveur. Aucune donnée confidentielle permise dans ce prototype.

## Quotas, I/O et réponses tardives

Réservation persistante dans les événements d’audit existants : verrou
PostgreSQL de l’organisation, horloge de base, comptage de la dernière heure,
insertion et commit avant I/O externe. Aucun nouveau schéma ni migration.
Échecs et déconnexions consomment la réservation ; ni redémarrage ni rollback de
la réponse HTTP ne remboursent artificiellement un appel. Défaut : vingt appels
par heure/organisation, maximum configurable cent. Le plafond d’output réservé
est donc borné par appels × `max_tokens`, sans prétendre mesurer la facturation.
Un sémaphore limite à quatre appels simultanés par processus API ; le quota
persistant est partagé entre processus. Pas de file d’attente ou retry automatique.
Les garanties concurrentes ne sont pas revendiquées pour SQLite, réservé aux tests.

Corps sortant et réponse bornés à 32 KiB ; premier dix de chaque type de mesure
et par côté, avec avertissement explicite si le rapport est tronqué. Timeouts
réseau et contrôle d’un délai écoulé entre lectures partielles. Un read bloquant
peut ajouter jusqu’au timeout socket au délai écoulé : ce n’est pas une promesse
de deadline murale stricte. Pas de redirect, proxy implicite, endpoint arbitraire,
polling fournisseur, chaîne de fournisseurs ni appel supplémentaire après échec.
Clé masquée dans la représentation de configuration, erreurs publiques fermées,
pas de prompts/réponses dans les journaux applicatifs. Les audits enregistrent
acteur, tenant, empreinte de contexte et instant, pas les valeurs envoyées.

Après l’appel, session expirée/revoquée et appartenance tenant sont contrôlées
à nouveau. Une révocation ne peut rappeler des données déjà envoyées ; le contrôle
avant réservation constitue le point d’autorisation de l’envoi. Les modèles
historiques sont immuables. React jette consentement, question et réponse lors
d’un changement de run/paire/tenant ; les réponses tardives ne réapparaissent pas.
Le jeton reste en mémoire, sans stockage navigateur.

## Conséquences et limites

Les calculs hors ligne restent entièrement disponibles avec NVIDIA désactivé,
même si ses variables facultatives sont invalides. Les résultats historiques ne
sont jamais modifiés. Les explications ne sont pas de nouveaux certificats et
ne sont pas persistées comme décisions. Un réessai explicite est un nouvel
appel soumis au quota, pas une nouvelle résolution. La sélection du LLM peut
être peu pertinente ; les faits et qualifications restent contrôlés.

Le faux fournisseur E2E est injecté par une factory distincte dans `scripts/`,
refusant toute base hors PostgreSQL local `optimizer_brain_e2e`. Aucun flag
utilisateur ni variable de production ne remplace le fournisseur réel par un faux.
Les parcours historiques tournent séparément avec toutes les clés NVIDIA retirées.
