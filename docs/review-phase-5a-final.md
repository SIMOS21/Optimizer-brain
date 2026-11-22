# Revue finale Phase 5A — Constraint Diagnostics

Code examiné : `a018d2fa0940853106404b11f596d106602c8da2`, comparé à
`main` (`2f8ca7e`). Branche : `feature/phase-5a-constraint-diagnostics`.

## Conclusion

Aucun problème bloquant précis et reproductible identifié dans les changements
de la Phase 5A. Fusion recommandée après lecture de cette revue et confirmation
des contrôles de la PR. Aucune fusion réalisée ; aucune correction du moteur
mathématique ou réécriture des fonctionnalités n'a été nécessaire.

## Preuves mathématiques

Le contrat de `diagnose` exige une IR produite par le compilateur. Celui-ci
résout les références, normalise les unités de chaque ligne, agrège les termes
par variable, supprime les coefficients nuls et ordonne les identifiants.
Ce prérequis rend le pivot non nul et la forme normalisée déterministe.

Pour une expression `sum(a_i*x_i)`, le minimum sur les bornes est obtenu en
prenant la borne inférieure de `x_i` si `a_i > 0`, sa borne supérieure sinon.
Le maximum inverse ces choix. Une borne absente demeure infinie. Par conséquent,
`minimum > rhs` contredit une ligne `<=`, et `maximum < rhs` contredit une ligne
`>=` ; une égalité est soumise aux deux contrôles. Les expressions constantes
et les termes annulés suivent cette même règle. Les calculs utilisent `Fraction`
sans arrondi. Une contradiction sur cette relaxation continue reste une
contradiction pour les domaines entiers et binaires.

Pour les lignes parallèles, diviser par le coefficient pivot conserve la
contrainte en inversant l'inégalité si le pivot est négatif. Les lignes d'un
même groupe imposent des bornes au même vecteur normalisé dans les coordonnées
numériques des variables. Si la plus grande borne inférieure dépasse strictement
la plus petite borne supérieure, aucun point ne satisfait ces lignes. Le facteur
de changement d'unité déjà appliqué à chaque ligne disparaît dans ce quotient.
Le regroupement conserve les dimensions ; l'absence de comparaisons entre groupes
est une limite de complétude, pas une source de faux certificats.

Les preuves citent leurs lignes et leurs bornes, sans revendiquer un IIS. Les
égalités, coefficients négatifs, bornes infinies, unités différentes et écarts
inférieurs aux tolérances sont couverts. L'analyse exacte et le contrôle numérique
du plan restent explicitement distincts. Aucun statut d'optimalité n'est créé
par le diagnostic ; aucune saturation n'est convertie en prix d'ombre.

## Isolation, permissions et intégrité

- Les deux nouvelles routes appartiennent exclusivement à l'application API v1
  sécurisée et dépendent de l'acteur authentifié existant.
- `artifact_diagnostics` appelle `service.tenant` avant toute lecture du modèle
  ou du run : adhésion active requise, lecture accessible aux quatre rôles selon
  les contrats existants. Les recherches incluent organisation et identifiant.
- Le tenant PostgreSQL est installé avec `set_config(..., true)`, limité à la
  transaction. Les tables modèles/runs ont RLS activée et forcée ; le démarrage
  refuse les rôles superuser/BYPASSRLS. La FK composite run/modèle conserve
  l'organisation. La RLS est une frontière par tenant ; l'autorisation de
  l'utilisateur reste contrôlée par l'application, comme avant la Phase 5A.
- Les checksums des artefacts sont contrôlés. Le document recomposé doit être
  identique au payload canonique complet. Le modèle/version, snapshot, scénario
  et les deux empreintes du run doivent correspondre à l'IR reconstruite.
- Les nouveaux GET n'écrivent aucun artefact. Les triggers d'immutabilité
  existants sont conservés. Les tests vérifient les documents avant/après,
  l'absence de mutations SQL et le refus d'une reconstruction différente.
- Le client vérifie organisation, identifiant, type d'artefact et empreinte de
  l'artefact ouvert. Le schéma est validé avant affichage ; le chargement est
  explicite. `useLoad` masque immédiatement l'ancienne identité et ignore les
  réponses tardives. Les contrôles d'annulation et de session du client existant
  restent appliqués. Le jeton demeure en mémoire et les réponses sont `no-store`.

Le diff ne modifie ni kernel, ni compositeur, ni HiGHS, ni vérificateur, ni
diagnostic legacy. Aucun accès réseau ou LLM n'est ajouté au module mathématique.

## Vérifications réellement effectuées

[CI du commit de code examiné](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45074403321) :
les jobs Ubuntu, Windows et PostgreSQL sont tous réussis. Les contrôles incluent
pytest, Ruff/format, mypy, les goldens CLI, la dérive OpenAPI/types générés,
TypeScript/build/lint, Vitest et les parcours réels API/PostgreSQL/worker.
Résultats observés : **391 Python réussis, 8 skips** avec PostgreSQL ;
**347 réussis, 52 skips** dans chacun des jobs sans PostgreSQL ;
**104 Vitest** et **30 Playwright** réussis. Les skips ne sont pas comptés comme
des succès. Les références usine **4100 EUR** et université **17** sont conservées.

Lors de cette revue, nouvelles exécutions locales :

- **54 tests Python ciblés réussis**, dont les variantes SQLite et PostgreSQL.
- **15 tests Vitest ciblés réussis**, TypeScript, Ruff et mypy strict réussis.
- Contrôle supplémentaire hors suite sur **1 000 modèles continus** générés
  avec un témoin rationnel réalisable connu, coefficients positifs/négatifs,
  égalités/inégalités et bornes finies/infinies : aucune fausse contradiction.
  Ce contrôle apporte une couverture complémentaire ; il ne remplace pas le
  raisonnement mathématique ni ne prouve l'exhaustivité du moteur.

## Risques résiduels et prochaine action

Analyse volontairement incomplète ; aucun IIS, coût marginal ou relâchement HARD.
La reconstruction synchrone n'est pas benchmarkée sur de très grands modèles.
Une évolution ultérieure du compilateur pourra entraîner un refus explicite 409
de reconstruction historique ; une compatibilité de lecture versionnée devra
alors être prévue, sans modification silencieuse des anciens artefacts.
Les checksums ne sont pas des signatures contre un administrateur de base capable
de réécrire les données et les protections ; aucune telle garantie n'est revendiquée.

Prochaine action : soumettre la branche à la revue humaine de PR et intégrer
seulement après approbation. Les Phases 5B, 5C et 6 restent hors périmètre.
Le fichier local non suivi `tatus` est conservé et exclu des commits.
