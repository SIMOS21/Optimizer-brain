# ADR 0010 — Politiques et hypothèses contrôlées de scénarios

Date : 23 novembre 2026. Statut : adopté pour la tranche 5B-2.

## Prérequis et périmètre

Base `3791661` après fusion de PR #5 ; le correctif `d855d72` est ancêtre de
main et sa CI fusionnée est réussie (run `45086248613`). Branche dédiée
`feature/phase-5b-controlled-scenario-changes`. Le fichier local `tatus` est
conservé hors Git. Les ADR 0006 à 0009 restent applicables.

Le socle sait cloner une référence, publier et résoudre une ModelVersion. Il ne
possédait pas d'autorisation explicite de modifier ses paramètres. Cette tranche
ajoute ce contrôle dans la couche plateforme, sans changer DSL, IR, compositeur,
HiGHS, diagnostics ou vérificateur. Aucun service supplémentaire, aucune LLM.

## Contrats fermés et exactitude

Une politique `5B.2` référence une ModelVersion publiée et son hash complet.
Chaque règle nomme exactement un paramètre partagé, un paramètre départemental
ou une capacité liée à un paramètre partagé. Un sélecteur typé est résolu par
identifiants ; le chemin est vérifié par égalité à sa représentation attendue.
Il n'est jamais interprété comme JSON Pointer, JSON Patch ou code.

Seule l'opération `SET` sur la valeur numérique existe. Unité identique à la
chaîne de référence, domaine INTEGER/DECIMAL, minimum et maximum explicites,
département, responsable et délégataires nommés sont obligatoires. Aucun chemin
de contrainte, domaine de variable, signe, objectif structurel, unité ou champ
`HARD/SOFT` ne peut être modifié. Les effets des paramètres sur contraintes et
objectif sont signalés. Une capacité peut affecter une contrainte HARD, mais
uniquement après politique approuvée, choix explicite d'une nouvelle valeur et
publications distinctes du graphe et du modèle : aucune relaxation automatique.

La frontière API utilise les décimaux bornés du kernel. Les comparaisons de
plage et d'intégralité utilisent des rationnels, sans tolérance flottante ni
arrondi. Les chaînes numériques exactes, y compris notation exponentielle,
restent des chaînes dans React. La résolution conserve les conversions,
tolérances et garanties de l'ADR 0002 ; une prévisualisation n'est ni une
résolution, ni une preuve de faisabilité ou d'optimalité.

## Autorité et révocation

ADMIN/BUILDER peut proposer une politique DRAFT. Le responsable de chaque règle
doit être un membre actif ADMIN/BUILDER/APPROVER et correspondre au responsable
du registre des départements lorsque celui-ci est renseigné. `graph.owner_id`
reste descriptif. Chaque responsable nommé donne un accord sur le hash complet
du document ; ADMIN/APPROVER publie ensuite. Délégataires actifs ADMIN/BUILDER
explicitement nommés, jamais permission implicite du créateur ou d'un ADMIN.

Sans propriétaire enregistré, le département et son responsable désigné dans
la politique doivent exister et ce responsable doit donner son accord. Un
paramètre commun à plusieurs propriétaires de ressources est refusé dans cette
tranche : pas de délégation simplifiée qui oublierait un propriétaire.

Le statut de disponibilité est une projection actuelle. Révocation du compte,
de l'adhésion, du rôle du responsable ou du publieur, ou changement du responsable
enregistré, bloque les nouveaux usages sans modifier l'ancienne politique.
Création/prévisualisation, publication du graphe/modèle, soumission, démarrage
du worker et persistance après calcul relisent ces autorités. L'exécutant doit
être délégataire de chaque changement hérité aussi. Les comptes concernés sont
verrouillés par identifiant trié, sous le verrou d'organisation lors des
mutations ; aucun verrou ne reste tenu pendant HiGHS. Une révocation validée
pendant le calcul empêche le run d'être enregistré.

La lecture historique vérifie l'intégrité sans exiger que ces permissions soient
encore valides. Les anciens résultats restent consultables par les membres
actuels autorisés. Une même personne peut être responsable et ADMIN publieur :
deux actes explicites sont requis, mais pas de séparation de personnes garantie.
Pas de workflow de votes configurable ni d'endpoint de révocation de politique
dans cette tranche ; créer une nouvelle version pour corriger une politique.

## Persistance et transactions

Migration additive `0006_5b2` : `scenario_change_policies`,
`scenario_policy_approvals` et `scenario_change_links`. FK composées par tenant,
unicités, RLS activée/forcée, privilèges runtime limités et triggers immuables.
La politique ne peut que passer de DRAFT à PUBLISHED ; accords et liens sont
append-only. Les modèles, scénarios et runs existants ne sont pas transformés.

La prévisualisation compose une copie détachée de la référence, avec les
changements cumulés du parent publié de même référence et même politique. Son
hash canonique lie proposition normalisée, auteur, hash du parent, politique et
provenance des changements. La confirmation recalcule et compare ce hash.

Chaque confirmation crée atomiquement : nouveau GraphSnapshot DRAFT avec nouvel
identifiant de snapshot de données, ModelVersion DRAFT recompilée, ScenarioVersion,
lien de politique/parent et événements d'audit. Les versions de paramètres,
capacités, fragments et imports sont mises à jour ensemble. Les équations,
variables et unités sont conservées ; les coefficients concernés sont recalculés
par le compilateur existant. Une nouvelle version de snapshot est produite même
pour un SET de même valeur : elle représente une nouvelle hypothèse déclarée.

Adaptation délibérée de l'ADR 0009 : l'assemblage interne permet de créer un modèle
DRAFT lié au nouveau graphe DRAFT dans la même transaction. Aucun drapeau public
ne contourne cette règle. Le chemin générique exige toujours un graphe publié ;
la publication du modèle contrôlé exige désormais le graphe publié. Cette
séparation évite de publier automatiquement des données pour réussir la création.

Clé/version/auteur/proposition déterminent l'idempotence des scénarios. Le verrou
d'organisation et les unicités sérialisent les créations concurrentes ; collision
différente = 409, jamais écrasement. Les jobs conservent l'Idempotency-Key 4C.
Les lectures reconstruisent toute la composition et contrôlent hashes,
référence/parent/politique/snapshot/modèle. Profondeur de parent limitée à 16.
Une copie générique du modèle ou du graphe contrôlé ne doit pas détacher cette
filiation. Le Model Builder général conserve ses propres droits de création et
publication de modèles indépendants ; la politique de scénario n'est pas un
système global de confidentialité des nombres déjà lisibles.

## Studio et limites

Formulaire typé issu du catalogue serveur, accords et publications explicites,
prévisualisation des valeurs originale/précédente/proposée, confirmation figée,
répétition identique après réception incertaine et garde des callbacks après
destruction. Jeton en mémoire, contrats OpenAPI générés et vérification du tenant
et de la provenance. Seuls des codes d'erreur publics fermés sont reformulés.

L'éditeur visuel crée une règle par politique ; l'API en accepte jusqu'à 50 et
le formulaire de scénario peut appliquer plusieurs règles publiées. Parent
facultatif par identifiant, vérifié par le serveur. Pas de benchmark de grandes
filiations. Les hashes détectent la corruption, pas un administrateur DB qui
désactive les protections et réécrit toutes les preuves.

Pas de comparaison de runs, gains, sensibilité, batch, Phase 5C/6 ou LLM.
