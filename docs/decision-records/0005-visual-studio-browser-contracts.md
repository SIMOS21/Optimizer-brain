# ADR 0005 — Studio visuel, contrats et session navigateur

Date : 22 novembre 2026. Portée : Phase 4B uniquement.

## Architecture

Le Studio est une application React 19 / TypeScript strict / Vite 8, indépendante
du package mathématique. React Router gère les routes d'organisation, graphe,
modèle et historique. `frontend/src/api/` porte transport, contrats générés et
validation ; `features/organizations`, `graph`, `models`, `history` portent les
parcours. Les composants communs restent dans `shared/`.

React Flow **13.0.2**, licence MIT, fournit canvas zoom/pan, minimap et interaction
clavier. Son contrat installé a été examiné : les changements de nœuds/arêtes
utilisent `changes.applyTo`, et leur sélection est conservée dans un état visuel
séparé. Aucun compilateur, solveur ou vérificateur n'est ajouté en JavaScript.
Le renderer est chargé à la demande pour ne pas charger son runtime au login.

Références primaires consultées : [React Flow / TypeScript](https://reactflow.dev/learn/advanced-use/typescript),
[accessibilité](https://reactflow.dev/learn/advanced-use/accessibility),
[Vite](https://vite.dev/guide/), [openapi-typescript](https://openapi-ts.dev/introduction).
Les versions effectivement testées sont épinglées dans package.json et package-lock.json.
Le verrou complet est généré sans node_modules préexistant et vérifié par une
installation Linux propre, y compris les dépendances optionnelles d'autres plateformes.

## Une seule sémantique mathématique

Le canvas contient exactement les départements, ressources et arêtes du document
API. Les identifiants ne sont pas renommés. Nœuds et arêtes ont des espaces de noms
distincts ; leur sélection porte donc `{kind, id}`. Une arête peut légitimement
porter le même identifiant qu'un nœud sans changer l'objet inspecté.

Le layout est une disposition déterministe en colonnes par type et identifiant.
Déplacer, zoomer, rechercher ou filtrer modifie uniquement l'état de présentation.
Aucun layout n'est envoyé à l'API. L'export trie nœuds, arêtes et périmètres de
partage et conserve le document entier, même si le canvas est filtré.

DEPENDS_ON est une relation informative ; USES_RESOURCE ne calcule aucune charge.
Le propriétaire ou shared_with n'entraîne pas l'ajout d'une arête implicite. Seuls
les fragments/ResourceUse compilés définissent les équations. L'inspecteur de modèle
affiche la DSL, les variables, paramètres, contraintes HARD, traces et IR enregistrés.
Les liens ressource → contrainte utilisent resource_traces et vérifient la présence
de la contrainte dans la DSL. Aucune saturation ou dépendance mathématique n'est devinée.

La capacité d'une carte utilise la valeur **et l'unité du paramètre référencé**.
L'unité de la ressource est inspectable séparément ; le navigateur ne convertit pas
60 minutes en heures pour modifier une équation. Les chaînes décimales/fractions
restent textuelles. Le parseur lossless-json conserve les nombres non entiers et
entiers hors de la plage sûre comme chaînes ; seuls les entiers sûrs deviennent
des nombres JavaScript. Les valeurs historiques ne sont ni arrondies ni recalculées.

## Contrats backend

L'audit a montré que le champ document de 4A était générique. GraphArtifactResponse,
ModelArtifactResponse et RunArtifactResponse décrivent désormais les réponses
de détail déjà présentes. Leurs JSON, URLs et autorisations restent identiques.
Les tests comparent les documents aux compositions canoniques existantes et
contrôlent des décimaux qui ne tiennent pas en binary64. Aucun nouvel endpoint
ni migration, aucun changement de kernel, compositeur, HiGHS ou vérificateur.

OpenAPI s'exporte via `scripts.export_studio_contract`, sans base réelle ni secret.
FastAPI 0.143.2 et Pydantic 2.12.5 sont figés aux versions testées pour stabiliser
la génération de schéma ; leurs mises à jour doivent régénérer et vérifier le contrat.
openapi-typescript génère les types et la CI vérifie l'absence de dérive. AJV valide
les réponses et imports contre ce contrat embarqué. Les seules valeurs par défaut
ajoutées côté client sont les listes vides resources/edges/shared_with autorisées
par les schémas ; aucune donnée métier n'est inventée.

AJV compile les schémas **fixes du dépôt**, jamais des schémas fournis par un
utilisateur ou les expressions d'un modèle. Cette compilation interne utilise la
génération de validateurs JavaScript : une CSP de déploiement interdisant toute
évaluation dynamique nécessitera des validateurs précompilés. Cette évolution n'est
pas masquée par une configuration CSP permissive ajoutée silencieusement.

## Authentification et isolation

Le bearer 4A reste dans une instance ApiClient privée en mémoire. Aucun cookie,
localStorage, sessionStorage, URL, snapshot, log ou fixture ne contient ce jeton.
Un rechargement recrée une application sans session. Le proxy Vite de même origine
redirige seulement /api/v1 vers l'API sécurisée 127.0.0.1:8001 ; aucun CORS ouvert
ni appel au serveur legacy. Les identifiants SQL sont échappés dans les chemins.

Les workspaces sont démontés au changement d'organisation/session, les requêtes
sont annulées et les chargements ignorent leurs réponses retardées. Les documents
sont cachés dès le changement d'identité de ressource, avant le prochain effet
React. Aucun cache persistant n'est introduit. Le client vérifie aussi l'organisation
et l'identité retournées pour un détail. Le serveur reste la seule autorité :
les boutons selon rôle ne remplacent jamais RBAC/RLS ou les références composites.

401 efface la session et ramène au login. 403/404/409/413/422 ont des messages
contrôlés, sans recopier les corps serveur ou erreurs de transport. Le logout
efface immédiatement la session locale et demande la révocation serveur ; si
celle-ci n'est pas confirmée, l'interface le dit au lieu d'affirmer une révocation.
HTTPS, MFA/SSO, BFF/cookie et exposition publique restent hors de cette phase.

## Brouillons et publication

Une copie de graphe est détachée de la source. Une nouvelle version explicite est
obligatoire ; l'éditeur demande de nouvelles versions des objets/paramètres modifiés
et un nouvel identifiant de snapshot lorsque les paramètres changent. Ces contrôles
de confort ne remplacent pas la validation ni la gouvernance serveur de 4A.

Les formulaires couvrent propriétés, capacité, unité du paramètre, propriétaire de
ressource, partage et relations. Le JSON structuré couvre les ajouts complets de
nœuds/paramètres et l'édition des fragments/contraintes. L'import lit uniquement le
contenu d'un fichier JSON assemblé, jamais des chemins/fichiers référencés ni du code.
Les départements doivent être inscrits dans le registre ; un modèle référence
exactement un graphe publié. Aucun alignement de fragments ni relaxation automatique.

Valider/enregistrer utilise les POST atomiques existants ; publier est une autre
action, confirmée visuellement, réservée à ADMIN/APPROVER. Un 409 propose rechargement
et nouvelle version ; aucune commande d'écrasement n'existe. La désactivation des
boutons est une aide d'interface, pas une règle de sécurité autonome.

## Historique et limites

Les valeurs et qualifications d'optimalité proviennent des runs conservés. Le label
de vérification dépend des indicateurs enregistrés validation_report.valid et
report.has_verified_plan. L'interface ne certifie pas à nouveau un plan ni un optimum.
Les bornes/gaps absents restent « Non fourni ». La comparaison de modèles décrit
métadonnées et paramètres, sans simulation ni gains.

Le script de démonstration provisionne des comptes/organisations synthétiques via
les API existantes et, seulement avec --with-history, utilise le pipeline Python
existant pour conserver des runs revérifiés. Il n'est pas accessible depuis le web.
Aucun bouton Optimiser actif, worker, endpoint de job, scénario avancé ou LLM.
Chromium et les deux exemples constituent la validation locale ; pas de garantie
de performance pour de grands graphes ni de certification WCAG exhaustive.
