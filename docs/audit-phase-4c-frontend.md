# Audit préalable — Frontend Optimization Execution Center

22 novembre 2026. PR #2 confirmée fusionnée sur GitHub ; main synchronisé par
avance rapide au commit `c3b41a1`, contenant `114d252`. Branche créée depuis ce
main : `feature/phase-4c-frontend-execution-center`. Aucun fichier suivi modifié
au départ ; le fichier non suivi `tatus` est conservé et exclu des commits.

Lecture intégrale : AGENTS.md, OPTIMIZATION_BRAIN_SPEC.md, guide d'exécution 4C,
revue backend et ADR 0006. Le code et les types OpenAPI confirment quatre routes
de jobs, une API de runs immuables, un worker PostgreSQL et la vérification avant
persistance. Le Studio 4B n'a aucun lancement, moniteur ni route durable de run.
Son client, ses contrôles de rôle, sa validation JSON et son identité de tenant
sont réutilisables. Aucun changement mathématique ni nouveau backend nécessaire.

## Incréments prévus

1. Client HTTP typé : jobs paginés, soumission idempotente, annulation, garde
   tenant/modèle/identité et rejet des réponses tardives même sans abort transport.
2. ExecutionPanel, OptimizationCenter et JobMonitor : paramètres bornés validés,
   même clé pour une réponse POST incertaine, polling sans chevauchement et arrêt
   borné, navigation/reconnexion et annulation confirmée par le serveur.
3. DecisionCockpit partagé avec l'historique : objectif, décisions, contraintes,
   ressources, statuts mathématiques et vérification exclusivement enregistrés.
4. Vitest et Playwright avec API/PostgreSQL/worker réels ; deux secteurs, erreurs,
   annulations, infaisabilité et limites de temps ; régressions Python et CI.

## Risques et décisions initiales

Pas de nouvelle dépendance. Jeton en mémoire, aucun cache persistant de décisions
ou de demandes. L'URL peut contenir des identifiants de jobs/runs, sans secret.
Une réponse POST perdue laisse une demande incertaine : seul son renvoi explicite
avec la même clé peut lever cette incertitude sans lancer un deuxième calcul.

Le parseur lossless existant préserve les décimaux JSON sous forme de texte. Le
contrat de jobs exige cependant des nombres pour `time_limit_seconds` et
`mip_rel_gap`. Seuls ces deux champs de configuration binary64 sont normalisés
avant AJV ; aucun coefficient, décision, objectif ou marge n'est converti par ce
mécanisme. Le backend conserve l'autorité sur les limites et tolérances.

La garde d'annulation du client est contrôlée après fetch et après lecture du
corps : une réponse tardive, y compris un 401, ne doit pas rétablir des données
d'un ancien tenant ni expirer la nouvelle session. Les composants ajoutent leur
propre invalidation à la destruction, en plus d'AbortController.

Premier incrément : TypeScript strict et ESLint réussis ; **46 tests Vitest
réussis**, dont les 37 antérieurs. La validation complète et les limites finales
seront consignées dans le rapport de livraison frontend 4C.
