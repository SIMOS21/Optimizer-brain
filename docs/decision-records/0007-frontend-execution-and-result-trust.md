# ADR 0007 — Exécution navigateur, idempotence et confiance des résultats

Date : 22 novembre 2026. Phase 4C frontend, base main `c3b41a1` après fusion PR #2.

## Décisions

Réutiliser React/TypeScript strict, React Router, AJV et le client v1 du Studio.
Aucune dépendance nouvelle, aucun endpoint anonyme ni appel solveur depuis le
navigateur. Le backend conserve compilation, autorisations, calcul et vérification.

**Soumission.** Le formulaire expose temps limite, gap relatif, presolve et limite
de nœuds. Il conserve les tolérances de vérification par défaut du backend. Une
clé UUID et le corps validé sont capturés avant le POST ; une référence bloque
les clics concurrents et reste verrouillée après acceptation jusqu'à navigation.
Une erreur réseau, un 5xx ou une réponse incompatible laisse la réception
incertaine : paramètres verrouillés et répétition explicite avec la même clé et
le même corps. Aucun retry automatique, aucune nouvelle clé silencieuse. Les
refus explicites 401/403/404/409/413/422 sont affichés sans corps sensible.

**Suivi.** Une seule lecture automatique à la fois, prochaine lecture 1500 ms
après la précédente, maximum 300 lectures par session de suivi. Arrêt sur état
terminal/erreur, pause quand l'onglet est masqué, reprise visible et bouton de
reprise explicite. La borne est un nombre de lectures, pas une garantie de durée
murale ; la file peut attendre davantage. Une URL tenant/job permet de retrouver
le travail après navigation ou reconnexion. La liste pagine par 50 et est un
instantané à actualiser, distinct du suivi du job sélectionné.

**Isolation.** Aucun token ni résultat dans localStorage/sessionStorage/cookie.
Changer d'organisation annule les requêtes du client et détruit l'espace précédent.
Chaque réponse est contrôlée par organisation/identité/modèle selon sa route.
Les contrôles d'abort sont répétés après fetch et lecture du corps, avant même un
401 : un transport tardif ne peut pas expirer une nouvelle session. Les hooks et
callbacks de mutation sont également invalidés à la destruction des composants.
Les requêtes de moniteur ont un AbortSignal individuel, sans interrompre les
autres composants. RBAC côté UI réduit les actions visibles ; seul le serveur
autorise effectivement l'action, même si le rôle vient d'être révoqué.

**Annulation.** Le POST exprime une demande. L'UI relit ensuite le job et ne
déduit jamais CANCELLED localement. Un succès concurrent reste un succès ; un
timeout technique du worker reste FAILED, distinct de TIME_LIMIT mathématique.

**Résultat.** Le cockpit charge exclusivement le run immuable du job, contrôle
son modèle et expose les valeurs enregistrées, unités, contraintes, ressources,
tolérances et provenance. SUCCEEDED signifie run produit, pas problème réalisable.
Le plan est présenté comme vérifié uniquement si validation.valid, plan.feasible,
report.has_verified_plan, présence des décisions et statuts enregistrés concordent.
Pas de recomposition d'équations, d'arrondi des décisions, de calcul des marges,
de progression ou de preuve d'optimalité dans React. Une borne/gap absent reste
« Non fourni ». Le statut OPTIMAL est toujours qualifié par les tolérances.

## Frontière numérique du contrat

Le parseur lossless conserve décimaux et fractions métier sous forme textuelle.
Seuls les deux champs de configuration `time_limit_seconds` et `mip_rel_gap`
retournés comme nombres JSON sont normalisés en nombres binary64 pour AJV. Ils
sont déjà définis comme flottants par SolveSettings ; aucune mesure métier
n'est touchée. Les tolérances ne sont pas converties.

Pydantic émet réellement des chaînes Decimal `1E-7` et `1E-9` alors que son schéma
**de sortie** génère un pattern sans exposant. La copie du schéma utilisée par
AJV autorise donc la notation décimale scientifique uniquement sur les cinq
champs de VerificationSettings-Output. Les chaînes exactes sont préservées ; NaN,
mantisses absentes et exposants invalides sont rejetés. L'OpenAPI original,
les types générés, les schémas d'entrée et le Brain ne sont pas modifiés.
Cette adaptation est couverte par des fixtures reproduisant les réponses réelles.

## Conséquences et limites

Un rechargement exige une nouvelle authentification. L'URL du job/run est ensuite
réutilisée sous les permissions courantes. Une soumission dont la réponse est
perdue n'est conservée qu'en mémoire dans le panneau ; après destruction ou
rechargement, consulter la liste des jobs avant de décider d'une nouvelle
soumission. Aucun journal durable des demandes ni mode hors ligne de l'UI.

Les garanties de calcul restent celles des ADR 0002 et 0006. Les workers de tests
sont démarrés/arrêtés avec le rôle runtime uniquement, sans secrets de migration ;
les cas INFEASIBLE et TIME_LIMIT sont des modèles synthétiques explicitement
publiés via l'API. Aucun modèle historique n'est modifié. Le parcours a également
justifié un flush RLS minimal du worker (ADR 0006), sans modification mathématique.
