# ADR 0013 — Assistant de scénarios et historique qualifié

Date : 26 novembre 2026. Statut : adopté pour UX-F5.

## Contexte

Les contrats 5B-1/5B-2 fournissent déjà clones, politiques, OWNER_ACK,
prévisualisations, création atomique et publications distinctes. Leur interface
exposait d’abord les formulaires techniques et toutes les politiques. History
proposait seulement un sélecteur de runs et un cockpit. Aucun nouveau contrat
serveur, calcul de comparaison ou changement du Brain n’est nécessaire.

## Décision

Conserver les mutations existantes et présenter sept étapes explicites : référence
publiée, politique, accords/délégations, hypothèses SET, preview serveur,
confirmation/création DRAFT, puis publications et lancement distincts. La carte
des étapes est un repère de lecture, pas une progression de calcul.

`ScenarioReference` lit le modèle sécurisé et refuse une référence non publiée ou
une empreinte différente de celle attendue. Le catalogue `scenario-targets` donne
les valeurs de référence ; pour un parent, seule la preview serveur confirme la
valeur héritée. Original, précédent et proposé restent des chaînes exactes. Ni
`Number`, ni arrondi, ni calcul économique ne sont nécessaires.

Le formulaire conserve le corps de création et l’empreinte de preview après une
réponse incertaine. La référence, la politique et les actualisations qui pourraient
démonter ce formulaire sont verrouillées. Le composant conserve la politique
sélectionnée pendant cette séquence. Une navigation complète ou une déconnexion
perd toujours cet état en mémoire : aucune nouvelle garantie de reprise durable
n’est revendiquée.

La définition d’une politique est montée au premier dépliage, puis reste montée
si le panneau est refermé. Cela évite les lectures de membres et départements
quand l’utilisateur souhaite seulement employer une politique existante, tout en
préservant une saisie ou une répétition en cours. Le catalogue des politiques
conserve la pagination API de 50 éléments.

`History` filtre et pagine les métadonnées autorisées déjà chargées par Workspace.
Cinq `HistoryCard` au maximum lisent les artefacts complets par page et appellent
`assessTrust`. Une métadonnée favorable ne permet jamais de montrer un objectif
vérifié. Le sélecteur direct et les URL historiques conservent l’accès à tous les
runs autorisés, indépendamment des filtres de la liste.

Une seule page de 50 jobs est consultée, avec pagination et actualisation
explicites, sans polling. Le rapprochement exige organisation, run et modèle.
Un job absent de cette page reste « Non fourni » ; sa présence ne constitue pas
une preuve de faisabilité ni d’optimalité. Cette borne de lecture limite les
requêtes, sans prétendre résoudre la pagination serveur de toutes les métadonnées.

Les lectures utilisent `ApiClient` et `useLoad`, avec identités tenant/artefact.
Workspace garde son remontage et l’annulation lors du changement d’organisation.
Le mode expert ne change aucune autorisation serveur et ne lance aucune mutation.

## Correspondance des statuts observée

`brain.organization.reporting.build_report` écrit `result.status` dans le rapport
organisationnel. L’orchestrateur expose séparément `FEASIBLE` et `TIME_LIMIT`
avec plan comme `FEASIBLE_NOT_PROVEN_OPTIMAL`. Le contrôle d’affichage précédent
exigeait l’égalité textuelle du statut du rapport et du statut public, masquant
donc certains plans pourtant vérifiés.

`assessTrust` accepte désormais cette correspondance fermée : statut public
`FEASIBLE_NOT_PROVEN_OPTIMAL`, statut natif `FEASIBLE` ou `TIME_LIMIT`, et rapport
portant ce même statut natif. Les artefacts portant déjà le statut public restent
compatibles. Tous les autres contrôles indépendants sont conservés : validation
valide, plan réalisable, rapport avec plan vérifié, décisions présentes et
cohérence du statut enregistré/public. Un statut public `OPTIMAL` exige toujours
un statut natif `OPTIMAL`. Les statuts inconnus ou incohérents restent refusés.

Le parcours réel avec SET `45.00000000000000001` démontre cette nécessité : le
serveur conserve la valeur rationnelle, HiGHS signale la conversion binary64 non
exacte, le résultat natif est `FEASIBLE` et le plan passe la vérification
indépendante. L’interface affiche le résultat enregistré et l’absence de preuve
d’optimalité ; elle ne certifie ni optimum rationnel exact ni gain.

## Conséquences et limites

Aucune modification du kernel, de HiGHS, du vérificateur, des tables, des routes,
des politiques RBAC/RLS ou des historiques. Les garanties d’immuabilité et
d’autorisation restent celles du backend, testées avec PostgreSQL réel. Les
comparaisons, gains, sensibilité, Phase 5C et fonctions LLM restent hors périmètre.

Les mesures avant/après portent sur des latences de parcours automatisés et des
comptages de requêtes, avec références immuables identiques. Elles ne mesurent ni
INP, ni charge de production, ni durée de résolution. L’historique E2E grandit sans
purge ; le nombre de runs et politiques peut donc différer entre mesures.
