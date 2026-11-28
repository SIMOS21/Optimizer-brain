# Assistant NVIDIA — prototype 7A

L’assistant explique des runs conservés et revérifiés, en lecture seule. Il ne
crée ni modèle ni scénario, ne modifie aucune règle et ne lance aucun calcul.
Il est facultatif : le Studio, les jobs et le Brain fonctionnent sans NVIDIA.

## Activer pour des données publiques ou synthétiques

La passerelle réelle appelle exclusivement
`https://integrate.api.nvidia.com/v1/chat/completions`. Une clé développeur NVIDIA
et les conditions du compte sont nécessaires. Ne jamais transmettre la clé dans
React, Git, un prompt, un ticket ou une capture. Injecter le secret dans
l’environnement du processus API depuis le gestionnaire de secrets local.

Variables serveur :

| Variable | Valeur / effet |
|---|---|
| `NVIDIA_ENABLED` | `true` pour activer, désactivé par défaut |
| `NVIDIA_API_KEY` | Secret serveur, absent par défaut |
| `NVIDIA_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1`, seul hôte accepté |
| `NVIDIA_TIMEOUT` | 20 secondes, de 1 à 60, timeout réseau + contrôle entre lectures |
| `NVIDIA_MAX_TOKENS` | 512, de 64 à 1024 ; sortie tronquée refusée |
| `NVIDIA_ALLOWED_ORGANIZATIONS` | IDs d’organisations, séparés par virgules |
| `NVIDIA_PUBLIC_MODEL_HASHES` | `content_hash` des modèles dont le caractère public/synthétique est autorisé, séparés par virgules |
| `NVIDIA_CALLS_PER_HOUR` | 20 appels par heure/organisation, de 1 à 100 |

Utiliser le `content_hash` complet des modèles publiés retourné par l’API, pas le
`model_hash` mathématique. Les deux modèles doivent figurer dans la liste pour
une comparaison. Tout manifeste dérivé exige sa propre autorisation. Une clé
seule ne suffit pas à activer un export. Après configuration, redémarrer
l’API selon le guide de lancement existant ; ne pas réinitialiser les bases.
Aucune migration ajoutée par 7A.

L’opérateur doit vérifier les conditions du service et le caractère public ou
synthétique des artefacts avant de les autoriser. L’essai NVIDIA n’accepte pas
les données confidentielles et n’est pas une offre de production. Aucun tarif
hébergé ni niveau de service n’est présumé. Voir l’[ADR 0015](decision-records/0015-optional-nvidia-grounded-explanations.md).

## Utiliser le Studio

Dans un résultat historique ou une paire explicitement vérifiée : ouvrir
« Assistant des résultats », choisir une question française guidée, consulter
les faits et le JSON externe, puis consentir avant « Demander l’explication ».
La prévisualisation ne contacte pas NVIDIA. Un changement de question ou de
sélection efface le consentement. Fermer puis rouvrir repart d’un état vide.

Les intentions couvrent les décisions, les ressources et la différence entre
deux résultats. Les questions ouvertes ne sont pas transmises. Le modèle
sélectionne des alias de faits ; le serveur rédige les paragraphes français et
insère les valeurs. Aucun chiffre généré librement n’est présenté comme preuve.
Les faits numériques sont consultables séparément et les liens remontent aux
artefacts réels. Le mode expert affiche modèle, fournisseur, version, empreinte
du contexte et références, sans droit supplémentaire.

Une saturation signifie une mesure dans les tolérances du run, pas une cause
économique prouvée. Un run sans plan revérifié garde son statut et son avertissement,
sans objectif ou décision exploitable. Un écart entre scénarios ne devient pas
un gain économique. Les limites du résultat historique restent applicables.

Réessayer une erreur d’explication ne lance aucune résolution. Chaque essai
consomme une réservation du quota, même si la réponse échoue. Pas de retry
automatique, d’historique conversationnel ou de mémoire inter-tenant.

## Contrats sécurisés

```http
POST /api/v1/organizations/{org}/assistant/preview
Authorization: Bearer <session en mémoire>
Content-Type: application/json

{"run_id":"<candidat>","baseline_run_id":"<référence>","intent":"COMPARISON"}
```

Pour un run seul, omettre `baseline_run_id`. Intentions fermées : `DECISIONS`,
`RESOURCES`, `COMPARISON` ; cette dernière exige une paire. La réponse contient
`context_hash`, `availability`, `outbound_json`, `facts` et `references`.

```http
POST /api/v1/organizations/{org}/assistant/explain

{"run_id":"<candidat>","baseline_run_id":"<référence>","intent":"COMPARISON",
 "context_hash":"<empreinte de prévisualisation>","consent_to_external_processing":true}
```

La réponse `7A.1` contient `presentation=GROUNDED_SELECTION`, les alias sélectionnés,
les paragraphes rendus par le serveur, les faits et les références locales. Les
schémas OpenAPI générés restent la source du client TypeScript.

Membre actif requis ; les deux artefacts sont contrôlés sous le tenant avant
constitution du contexte. Révocation/expiration pendant l’appel : résultat refusé.
Absence et ID étranger ont le même 404, y compris pour un membre des deux tenants.
Erreurs : 401/403/404, intégrité ou contexte changé 409, requête invalide 422,
quota/occupation/rate-limit 429, sortie refusée 502, désactivation/clé absente/
indisponibilité 503, timeout 504. Les erreurs du fournisseur ne sont jamais
retournées brutes. Aucun endpoint d’écriture ou de résolution fourni au modèle.

## Reproduction sans clé

```powershell
python -m pytest -q
python -m ruff check brain tests migrations scripts
python -m mypy
cd frontend
npm.cmd run build
npm.cmd run lint
npm.cmd test
cd ..
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build
python -m scripts.studio_e2e --env-file .local/e2e.env --skip-build --assistant-fixture assistant.spec.ts
```

Les tests PostgreSQL exigent les deux URLs dédiées décrites dans les guides
existants. Le lanceur utilise exclusivement `optimizer_brain_e2e` et les ports
8002/5181 ; aucune purge. Il retire toutes les clés NVIDIA héritées. La factory
de test autorise seulement les deux modèles synthétiques semés et injecte un
fournisseur déterministe sans réseau. Les huit tests assistant sont ignorés dans
le passage historique puis exécutés dans leur passage explicite. Aucun skip
n’exclut leur exécution dans la CI PostgreSQL.

Les captures simulées ne prouvent pas une inférence NVIDIA. Une validation réelle
ultérieure doit utiliser un secret injecté côté serveur, des modèles synthétiques
explicitement autorisés, et conserver uniquement les métadonnées non sensibles
du résultat. Les clés ne doivent jamais être demandées dans le chat.
