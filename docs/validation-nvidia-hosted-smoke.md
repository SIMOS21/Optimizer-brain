# Validation NVIDIA NIM hébergée — premier smoke test authentifié

Date : **28 novembre 2026**, fuseau Africa/Casablanca.

Base testée : `main` au commit `b8306c5e9c31975a659de7c965391f8678ebd3e7`,
PR #13 fusionnée. La [CI après fusion](https://github.com/SIMOS21/Optimizer-brain/actions/runs/46149805990)
était terminée avec succès avant le test.

## Modèle et endpoint

- Modèle : `nvidia/nemotron-3.5-lightning-30b-a3b`.
- Base : `https://integrate.api.nvidia.com/v1`.
- Appel réel : `POST /chat/completions`, authentification Bearer côté serveur.
- Paramètres testés : `temperature=0`, `max_tokens=512`, `reasoning_budget=0`,
  `stream=false`, timeout réseau configuré à 20 secondes.

La [documentation NVIDIA](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-lightning-30b-a3b-infer)
et la [carte du modèle](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard)
ont été consultées de nouveau. Les trois réponses réelles confirment que le
modèle et les paramètres ci-dessus étaient acceptés lors de cet essai.

## Périmètre du test

API sécurisée réelle en processus ASGI isolé, avec le rôle PostgreSQL runtime
et RLS existants, dans la base E2E locale existante. Aucun faux fournisseur
n’est utilisé pour les trois inférences positives.

Les références usine et université ont été comparées aux sources **canoniques**
des exemples synthétiques du dépôt, avec vérification des hashes mathématiques,
de publication et d’intégrité. La comparaison utilise un scénario contrôlé
historique dont la filiation et le changement autorisé ont été vérifiés par
le service existant. Aucune donnée d’un autre modèle n’a été autorisée.

L’activation ne concernait que ce processus d’essai : une organisation autorisée
à la fois, son empreinte complète de modèle exacte, et les deux empreintes exactes
nécessaires pour la comparaison. Aucun joker ni autorisation de tous les tenants
ou modèles. Plafond global de **trois tentatives externes**, effectivement respecté.
Les réservations de quota existantes ont été conservées ; aucune purge.

La clé a été chargée uniquement dans l’environnement du processus serveur depuis
la configuration locale privée ignorée par Git. Aucun secret, prompt, contenu
brut de réponse ou identifiant d’artefact n’est reproduit dans ce rapport.

## Résultats authentifiés

| Cas synthétique | HTTP NVIDIA | HTTP API sécurisée | Durée fournisseur | Durée appel API | Schéma 7A.1 / alias / rendu serveur |
|---|---:|---:|---:|---:|---|
| Run usine, référence 4100 EUR | 200 | 200 | 645,57 ms | 699,86 ms | Conformes |
| Run université, référence 17 | 200 | 200 | 467,54 ms | 515,88 ms | Conformes |
| Comparaison usine 4100 / 3500 EUR | 200 | 200 | 489,97 ms | 581,45 ms | Conformes |

Pour chacun des trois appels :

- réponse reçue du véritable endpoint NVIDIA avec authentification ;
- enveloppe JSON valide, modèle retourné identique au modèle demandé,
  une seule proposition et `finish_reason=stop` ;
- contenu du fournisseur conforme au schéma strict **7A.1** ;
- alias existants dans le contexte autorisé, sans doublons ;
- paragraphes exactement issus des faits du serveur et des alias validés ;
- plans historiques revérifiés, sans nouveau chiffre fourni par le LLM ;
- comparaison qualifiée comme observation, sans gain économique annoncé.

La durée fournisseur couvre transport, lecture et contrôles de l’adaptateur.
La durée API couvre l’appel ASGI sécurisé complet, dont authentification,
reconstruction et rendu. Ce ne sont ni des temps GPU seuls ni des mesures
de navigation HTTP de bout en bout. Aucun prompt ou résultat brut n’a été
persisté pour obtenir ces mesures.

## Contrôles négatifs et indépendance

| Contrôle exécuté | Résultat |
|---|---|
| Référence d’un run de l’autre tenant dans une demande de prévisualisation | HTTP **404**, avant tout appel NVIDIA |
| Réponse volontairement hors schéma, injectée localement sans requête NVIDIA supplémentaire | HTTP **502**, code `LLM_INVALID_RESPONSE` |
| Trois chemins de lecture rejoués avec entrées HiGHS/legacy/orchestrateur et réseau bloquées | **3 réussis**, zéro appel aux entrées de résolution et zéro appel externe |
| Historiques des deux références et du candidat, avant/après les inférences | Documents inchangés |
| Configuration du fournisseur après l’essai | Désactivée, clé retirée de l’environnement du processus d’essai |
| Parcours UI/API/worker usine après désactivation | Réussi, objectif vérifié de référence conservé |
| Parcours UI/API/worker université après désactivation | Réussi, objectif vérifié de référence conservé |
| Playwright ciblé après désactivation | **2 réussis**, 14,5 s |
| pytest ciblé contexte, schéma et transport | **27 réussis**, 1,18 s |

Le fournisseur local des contrôles négatifs n’est pas compté comme une inférence
authentifiée. Les réponses positives sont exclusivement les trois HTTP 200 du
tableau précédent ; aucun HTTP 401 ni résultat simulé n’est qualifié de succès.

Les résolutions des deux parcours Playwright ont été explicitement lancées
**après** désactivation de NVIDIA, avec les clés NVIDIA exclues de l’environnement
des services et du navigateur. Elles valident la disponibilité de l’interface,
du worker, du Brain et de l’historique sans le fournisseur. Les explications
empruntent uniquement le chemin de lecture/revérification, sans lancer le solveur.

## Échecs et limites

Aucun échec NVIDIA sur les trois appels authentifiés. Un contrôle préparatoire
avait initialement comparé les sources brutes dont l’ordre des fragments diffère
de l’ordre canonique conservé ; il a été ajusté pour comparer les représentations
canoniques et leurs hashes. Ce refus s’est produit **avant tout appel externe**
et n’a nécessité aucun correctif du produit.

Ce smoke test valide une compatibilité ponctuelle, pas un SLA, un benchmark,
un coût d’inférence, une certification d’optimalité ou une aptitude à traiter
des données confidentielles. Aucun coût ni quota fournisseur disponible n’a été
estimé. Les latences reposent sur trois observations, sans extrapolation.

Le contrôle d’absence de résolution comprend l’examen du chemin réel de lecture,
les historiques inchangés et le rejeu hors réseau avec blocage des véritables
points d’entrée de résolution. Il ne constitue pas un profilage CPU de NVIDIA.
Les tests de transport volontairement malformé sont locaux ; aucune réponse
malformée réelle de NVIDIA n’a été observée pendant ce test.

Les questions restent guidées et les paragraphes rendus par le serveur selon
l’ADR 0015. Les modèles publiés et historiques, le kernel, HiGHS, le compositeur
et le vérificateur n’ont pas été modifiés. Le fichier de configuration privé
est conservé ; aucun service NVIDIA actif n’est laissé par ce processus d’essai.
Aucun développement 7B, 5C ou 6 n’a été entrepris.
