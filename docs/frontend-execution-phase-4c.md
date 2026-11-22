# Optimization Center — Phase 4C frontend

Prérequis : PostgreSQL migré en `0004_4c`, comptes et appartenances provisionnés,
modèles/graphes publiés via l'API sécurisée. Voir [fondations](platform-phase-4a.md),
[Studio](studio-phase-4b.md), [worker](execution-center-phase-4c.md),
[ADR navigateur](decision-records/0007-frontend-execution-and-result-trust.md).

## Lancer localement

Dans deux terminaux Python où **seul** `BRAIN_DATABASE_URL` runtime est défini :

```powershell
python -m uvicorn brain.platform.api:create_app --factory --host 127.0.0.1 --port 8001 --no-access-log
```

```powershell
python -m brain.platform.worker
```

Le rôle `brain_app` n'est ni superuser ni BYPASSRLS. Effectuer les migrations avec
le compte de migration dans un autre environnement, jamais dans les processus
API/worker. Aucun nouveau service requis par l'interface.

Dans le terminal frontend :

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Ouvrir http://127.0.0.1:5173. Le proxy `/api/v1` cible uniquement l'API sécurisée
8001. Pour tester le bundle compilé, `npm.cmd run build` puis `npm.cmd run preview`
utilise http://127.0.0.1:5180.

## Parcours utilisateur

1. Se connecter, sélectionner une organisation puis **Optimization Center**.
2. Choisir une version publiée ; consulter identifiant, version, graphe, snapshot,
   hash et source. Un brouillon n'est pas proposé au lancement.
3. Régler temps limite (strictement positif, au plus 300 s), gap relatif (0 à 1),
   presolve et nombre de nœuds facultatif (entier 0 à 2147483647). Les tolérances de
   vérification restent celles du backend ; la validation serveur est définitive.
4. **Lancer l'optimisation** crée un job avec Idempotency-Key. Un double clic ne
   crée pas deux demandes. Si la réception est incertaine, utiliser **Réessayer la
   même demande**, qui conserve corps et clé, sans relance automatique.
5. Suivre QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED. L'état affiché vient du serveur.
   Les lectures sont séquentielles, bornées et suspendues quand l'onglet est masqué.
6. ADMIN ou créateur encore BUILDER peut demander l'annulation d'un job actif.
   « Annulation demandée » ne vaut pas confirmation ; attendre CANCELLED. Une
   réussite concurrente reste consultable, sans être remplacée par une annulation.
7. Après SUCCEEDED, lire le cockpit : statut mathématique, présence ou absence de
   plan vérifié, objectif/unité, décisions, contraintes saturées et marges,
   ressources, borne/gaps, options, tolérances et provenance du run.
8. Ouvrir le lien du run immuable dans l'historique. Après rechargement, se
   reconnecter pour reprendre la même URL sous les permissions actuelles.

Routes navigateur : `/organizations/:org/execution`,
`/organizations/:org/execution/:jobId` et `/organizations/:org/history/:runId`.
Les URL ne portent ni jeton ni clé d'idempotence. Les viewers/approvers consultent
les jobs et résultats ; le lancement est réservé à ADMIN/BUILDER côté serveur.

## Lire honnêtement les résultats

- SUCCEEDED signifie qu'un run a été conservé, y compris un résultat INFEASIBLE
  ou TIME_LIMIT_NO_SOLUTION ; ce n'est pas une affirmation de faisabilité.
- OPTIMAL reste « selon les tolérances enregistrées du solveur », sans certificat
  rationnel strict inventé. Un gap cible non nul ne promet pas l'optimum exact.
- TIME_LIMIT avec plan vérifié est affiché comme faisable sans preuve d'optimalité.
  Sans plan, aucune décision exploitable n'est proposée. Un timeout de processus
  du worker est un échec technique distinct, sans run mathématique fabriqué.
- Les fractions, décimaux, marges et capacités sont affichés depuis le document
  enregistré. Aucune soustraction, évaluation d'équation ou optimisation dans React.
- Les modèles et résultats d'exemples sont synthétiques : usine **4100 EUR**,
  université **17**. Aucun gain par rapport à une baseline réelle n'est annoncé.

## Tests reproductibles

```powershell
Set-Location frontend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Pour Playwright, démarrer API et preview, provisionner les exemples selon le guide
4B et définir dans le terminal de tests `BRAIN_DATABASE_URL` runtime,
`BRAIN_DEMO_PASSWORD` de démonstration synthétique et
`STUDIO_BASE_URL=http://127.0.0.1:5180`. `STUDIO_PYTHON` peut désigner le Python
du venv ; par défaut les tests utilisent `python` du PATH.

```powershell
npm.cmd run test:e2e
```

Ne pas démarrer un worker externe sur cette base dédiée aux parcours navigateur :
les tests contrôlent leurs workers pour exercer aussi l'annulation QUEUED. Ils
ajoutent uniquement des versions et des jobs synthétiques via les API autorisées,
sans réinitialiser la base de développement ni altérer les versions existantes.
Un terminal de tests peut connaître les secrets de provisionnement, mais aucun
worker enfant ne les hérite ; une liste explicite de variables autorisées ne
conserve que la configuration runtime et l'environnement système nécessaire.

La CI lance aussi les régressions Python/PostgreSQL, migrations, Ruff et mypy.
Les [résultats réels](validation-phase-4c.md) distinguent skips et réussites.

## Limites

Pas de retry automatique de calcul, de quotas globaux entre workers, de journal
persistant d'idempotence dans le navigateur ou de progression chiffrée. Le suivi
s'arrête après 300 lectures jusqu'à reprise explicite. La liste des jobs se
rafraîchit à la demande et se pagine par 50. Un F5 supprime la session mémoire et
la demande incertaine du panneau : consulter les jobs avant un nouveau lancement.
Les scénarios, diagnostics supplémentaires, nouveaux solveurs et LLM sont exclus.
