# ADR 0002 — HiGHS générique, conversions et qualification des résultats

Date : 22 novembre 2026. Statut : adopté pour la phase 2 uniquement.

## Contexte vérifié

Les 102 tests des phases 0/1 passent avant modification. Le MVP utilise déjà
SciPy `milp` ; le kernel compile des rationnels immuables. Aucun worker ou stockage
de runs n'existe. L'environnement local testé est Python 3.14.3, SciPy 1.17.0,
HiGHS **1.8.0** embarqué. La version HiGHS est lue dans l'extension, jamais déduite
de la version SciPy. Les tests et le code métier legacy sont conservés.

La docstring et le code de SciPy installés ont été inspectés. Références primaires :
[SciPy milp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html),
[options HiGHS](https://ergo-code.github.io/HiGHS/dev/options/definitions/).
La documentation en ligne peut concerner une autre version ; les valeurs de
`backend_defaults` viennent exclusivement de l'installation réelle lorsqu'elles
sont accessibles. Sinon, elles restent absentes et `solver_version` peut être null.

## Architecture et algorithme

`SolverAdapter` définit supports/solve/get_capabilities. `HighsAdapter` réutilise
**le même backend SciPy/HiGHS que le MVP**, sans appeler sa formulation industrielle.
L'orchestrateur compile, contrôle la compatibilité, résout et appelle le vérificateur.
Le kernel ne charge aucun solveur à l'import ; seul `solve` en a besoin.

Les identifiants triés de l'IR déterminent les colonnes. Chaque ligne sparse est
transcrite dans `lb_row <= A*x <= ub_row`, avec deux bornes égales pour `==`.
Les domaines continu/entier/binaire deviennent respectivement 0/1/1 ; les bornes
0/1 des binaires sont conservées. MAX devient MIN de l'opposé ; l'objectif et la
borne sont remis dans le sens original en sortie. La matrice est CSC, sans
matrice dense de taille lignes × colonnes. La traduction est O(V + T + C), hors
coût de construction/conversion CSC et arithmétique rationnelle. Le branch-and-bound,
les relaxations et les preuves dans les tolérances sont délégués à HiGHS.

## Extension minimale des bornes

Un modèle dont toutes les variables ont des bornes finies ne peut pas être non borné.
Pour exprimer/tester cette classe, `lb` et `ub` restent **obligatoires**, mais acceptent
explicitement `null` : absence de borne inférieure/supérieure. L'IR utilise None ;
seul l'adaptateur produit ±inf pour ces absences. Les coefficients et membres droits
restent finis. Les binaires exigent leurs deux bornes dans [0,1].
Cette extension additive conserve les instances DSL 1.0 existantes et leur hash
mathématique ; les contrats de JSON Schema sont régénérés. L'analyse par intervalles
et le vérificateur traitent désormais également les côtés sans borne.

## Conversion rationnel → binary64

L'IR originale reste inchangée. Chaque conversion calcule exactement
`abs(Fraction.from_float(float(q)) - q)` et son ratio à `abs(q)` pour q non nul.
Le rapport expose nombres convertis/arrondis et maxima d'erreur. Ce rapport
mesure les conversions d'entrée, pas l'erreur totale de résolution.

Politique initiale prudente, rejetée par `supports()` avant appel natif :

- tous les nombres finis transmis ont une valeur absolue <= 1e12 ;
- tout coefficient non nul de matrice ou d'objectif doit avoir |valeur| > 1e-9 ;
- aucun overflow, underflow à zéro ou erreur relative de conversion > 1e-12 ;
- aucune borne distincte de l'autre ne doit se confondre avec elle après conversion.

La limite des coefficients évite notamment leur suppression par les seuils du backend.
Les bornes finies sont éloignées des seuils de traitement comme infini. Cette politique
ne détecte pas tout mauvais conditionnement. Il n'y a aucune remise à l'échelle
automatique, aucun arrondissement de coefficients ou relaxation pour rendre le
modèle acceptable : l'auteur doit changer explicitement les unités/la formulation.

**Choix conservateur :** s'il existe une conversion d'entrée non exacte, un succès
natif n'est publié que comme FEASIBLE après vérification ; une déclaration native
d'infaisabilité ou de non-bornitude devient UNKNOWN pour le modèle rationnel original.
Les bornes/gaps fournis restent des observations du modèle binary64, explicitement
qualifiées par `gap_scope`. Aucune borne rationnelle n'est extrapolée.

## Vérification indépendante

`SolutionVerifier` n'appelle ni solveur ni réseau. Les valeurs natives ne sont pas
arrondies : leurs valeurs binaires sont converties en rationnels exacts par
`Fraction.from_float`, puis évaluées avec les coefficients **originaux** de l'IR.
Cela diffère du mode décimal historique de `verify_plan`, conservé par défaut.
Le contrôle porte sur les références de variables, bornes, intégralité, chaque
comparateur et l'objectif. L'objectif annoncé est comparé à l'objectif recalculé
avec `abs_tol + rel_tol * max(abs(calculé), abs(annoncé))`.
Un objectif annoncé non fini, une décision non finie ou un plan incomplet est refusé.
Un objectif annoncé absent permet de vérifier le témoin, mais ne donne pas OPTIMAL.

Tolérances indépendantes par défaut : bornes, contraintes, intégralité = 1e-7 ;
objectif absolu = 1e-6 et relatif = 1e-9. Elles sont enregistrées dans `settings`.
Les trois tolérances de faisabilité sont limitées à 1e-4 ; objectif absolu <= 1e-3,
relatif <= 1e-6. Cette politique empêche d'utiliser les options numériques comme
relaxation métier importante. Le vérificateur de plans de phase 1 conserve son
contrat antérieur ; le nouvel orchestrateur utilise la politique de phase 2.

Les tolérances de faisabilité sont absolues dans les unités de chaque variable/ligne.
`primal_residual_max` est le maximum numérique de violations dans ces unités :
ne pas lui attribuer une unité physique commune lorsque les lignes sont hétérogènes.
Les résidus détaillés avec unités restent la référence. HiGHS peut accepter un
témoin que notre tolérance plus stricte refuse ; le statut devient alors
SOLUTION_FAILED_VALIDATION. Aucun témoin corrigé n'est fabriqué.

## Preuve, statuts et métriques

- Seul le statut natif optimal non ambigu, avec témoin et objectif vérifiés et
  conversions d'entrée exactes, permet OPTIMAL. Le code HiGHS doit être 0.
- OPTIMAL signifie toujours **« optimal à tolérance près »**, jamais optimum
  rationnel strict. `certificate_scope=solver_tolerances` qualifie une attestation
  native ; aucun fichier certificat mathématique externe n'est produit.
- `mip_rel_gap` est demandé explicitement, par défaut 0. Le seuil absolu et les
  tolérances natifs restent ceux du backend et sont enregistrés quand accessibles.
  Même gap demandé nul et gap retourné nul ne prouvent pas l'exactitude symbolique.
- SciPy code 1 regroupe plusieurs limites : TIME_LIMIT exige un message natif
  explicitement identifié comme limite de temps. Une limite ambiguë reste UNKNOWN
  sans témoin, ou FEASIBLE avec témoin vérifié. Inconnu/ambigu ne devient jamais OPTIMAL.
- TIME_LIMIT conserve sa cause même avec témoin. `public_status` distingue
  FEASIBLE_NOT_PROVEN_OPTIMAL et TIME_LIMIT_NO_SOLUTION.
- `best_bound` et `relative_gap` ne viennent que des champs natifs réels. Les valeurs
  absentes ou non finies deviennent null ; aucune égalité borne=objectif n'est inventée
  pour un LP optimal. `absolute_gap` est calculé seulement si objectif **natif** et
  borne native sont disponibles ; son périmètre reste binary64.
- Une borne incohérente avec le sens de l'objectif est écartée avec ses gaps et
  empêche OPTIMAL. Un gap négatif est écarté et empêche OPTIMAL.
- Toute validation échouée masque les décisions et l'objectif publics. Le rapport
  conserve les raisons du refus. Les exceptions backend donnent ERROR/SOLVER_ERROR.

## Traçabilité, API et périmètre

Chaque résultat porte UUID de run, version modèle, snapshot/scénario, deux hashes,
date UTC, durée du pipeline, options effectivement transmises, versions, statut brut,
rapport de conversion et rapport indépendant. `audit_actor_id=null` en développement
local ; aucune identité authentifiée n'est inventée. Les artefacts peuvent être
exportés en JSON, sans historique persistant ni registre de snapshots garanti.

Les nouvelles routes sont synchrones pour le client ; le solveur travaille dans
le pool de threads afin de ne pas bloquer la boucle HTTP. Un parseur JSON dédié
préserve les décimaux avant Pydantic, refuse les clés dupliquées/constantes non standard
et renvoie les erreurs 422 sans réinjecter les valeurs problématiques dans la réponse.
Le routage et le parseur legacy restent inchangés.

Pas de jobs, annulation, auth/RBAC, base de données, UI, orchestration multiobjectif,
template industriel migré ou phase 3/4. Une limite HiGHS n'est pas une limite dure
de temps murale du pipeline ni une isolation mémoire ; ce sera un travail de worker.
