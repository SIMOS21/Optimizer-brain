# Validation de la phase 2 — 22 novembre 2026

Périmètre : Generic Solver & Verification Engine exclusivement. Les phases 3/4
ne sont pas commencées. Environnement local : Windows / PowerShell,
Python 3.14.3, SciPy 1.17.0, HiGHS embarqué 1.8.0 ; outils identiques à la phase 1.

## Résultats réellement exécutés

Toutes les commandes utilisent `.\.venv\Scripts\python.exe` depuis la racine.

| Commande | Résultat |
|---|---|
| `-m pytest -q` avant modifications | 102 passed, 2 warnings in 2.52s |
| `-m pytest -q` après modifications | **188 passed, 2 warnings in 3.20s** |
| `-m ruff check brain tests` | All checks passed |
| `-m ruff format --check brain/kernel brain/solvers tests/test_kernel.py tests/test_generic_solver.py` | 15 files already formatted |
| `-m mypy` | Success: no issues found in 13 source files |
| `-m brain.demo` | Succès, résultats industriels conservés : baseline 4620 EUR, optimisé 6840 EUR, scénario 82 infaisable |
| `-m brain.kernel solve examples/demo_cross_department.json --output results/golden_solve.json` | OPTIMAL à tolérance près, qty_A=40.0, qty_B=15.0, objectif recalculé 4100 EUR, vérification valide |
| `-m brain.kernel solve examples/generic_allocation.json --output results/generic_solve.json` | Même objectif et décisions, vérification valide |

Les trois fichiers de tests historiques/phase 1 sont inchangés :
`test_solver.py`, `test_api.py`, `test_kernel.py`. Les 188 cas comprennent les
102 antérieurs et **86 nouveaux cas** de phase 2. Le solveur et les modèles métier
legacy ne sont pas réécrits ; l'API legacy reçoit seulement le nouveau routeur.

## Couverture des critères d'acceptation

| Critère | Vérification exécutée |
|---|---|
| Golden 4100 EUR | Vraie résolution HiGHS, objectif/contraintes recalculés sur IR originale ; borne/gaps natifs présents sur cette instance |
| Énumération exhaustive | 12 problèmes entiers (6 graines × MIN/MAX), 125 plans potentiels chacun, équations de l'oracle indépendantes de l'adaptateur |
| MIN/MAX | Oracles précédents, conversion du signe, bornes et golden de maximisation |
| Continu/entier/binaire | Continus à 1/3, problème mixte et binaires, problèmes entiers bornés/non bornés |
| <= / >= / == | Matrices inspectées et résolutions réelles de chaque comparateur |
| Infaisable/non borné | Contradictions entre lignes, contrainte constante, infaisabilité entière ; LP et MILP réellement non bornés |
| Timeouts | Vrai appel HiGHS : 800 binaires, 12 contraintes, presolve désactivé, limite 1e-9 s ; cas injectés déterministes avec/sans incumbent |
| Ambiguïtés/erreurs | Statuts/code/message inconnus ou contradictoires, erreur native, objectif/vector absents, borne incohérente, gap négatif/non fini |
| Numérique/tolérances | 1/3 avec résidu binaire exact, tolérance nulle, plafonds de tolérance, conversion de 0.1, échelles rejetées, bornes confondues, protection des grands entiers |
| Corruption | Bornes/intégralité/contrainte violées, objectif incorrect, NaN/inf, vecteurs incomplets/trop longs, ids dupliqués ; aucun plan public |
| Hors ligne/LLM | Socket interdit et clés LLM absentes pendant la résolution ; vérificateur testé avec solveur et réseau interdits |
| API/CLI | Solve/validate, erreurs 422, JSON strict et décimaux longs, refus NaN/Infinity/exposants extrêmes, sorties et codes CLI |
| Régression | Les 14 tests MVP et 88 cas du kernel antérieurs passent, import du kernel toujours sans SciPy/OpenAI |

Le premier passage des tests de phase 2 a révélé un rejet de NaN transformé en
erreur de sérialisation par FastAPI. Le parseur précis et le traitement local des
erreurs des nouvelles routes corrigent ce cas ; le test de régression passe.

## Limites observées ou non mesurées

Deux avertissements externes persistent : anyio/pytest CallSpec2 et Starlette/httpx,
déjà présents dans la mesure initiale. Aucun avertissement de nouvelle option HiGHS
non reconnue n'est ajouté : seules les options SciPy publiques autorisées sont transmises.

Le workflow CI Linux/Windows Python 3.11 est étendu, **pas exécuté dans cette session**.
Le temps limite natif ne borne pas durement le temps mur du pipeline. Les tests de
timeouts avec incumbent utilisent des réponses natives injectées pour rester
déterministes ; le timeout sans incumbent est aussi exécuté réellement.

La version HiGHS peut rester null dans une autre version SciPy dont l'extension
n'expose pas ces constantes : le fallback sans invention est testé.
Les conversions binary64 non exactes dégradent volontairement le statut du modèle
original ; l'optimalité exacte rationnelle n'est jamais revendiquée.
La plateforme multi-tenant, l'authentification, les snapshots persistants et les
workers restent hors périmètre, comme décrit dans l'ADR 0002.
