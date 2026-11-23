# Validation — Phase 5B-2, hypothèses contrôlées

## Base et conservation

PR #5 fusionnée dans `main` à `3791661`, correctif `d855d72` présent dans son
ascendance, CI fusionnée réussie :
[run 45086248613](https://github.com/SIMOS21/Optimizer-brain/actions/runs/45086248613).
Synchronisation fast-forward puis branche
`feature/phase-5b-controlled-scenario-changes`. Le fichier non suivi `tatus`
reste conservé et exclu des commits. Aucun merge automatique.

AGENTS.md, spécification complète, roadmap, ADR et code réel des scénarios lus.
L'[ADR 0010](decision-records/0010-controlled-scenario-policies.md) et le
[guide de la tranche](controlled-scenarios-phase-5b2.md) décrivent contrats,
architecture, permissions et lancement. Migration additive `0006_5b2`.
Pas de changement dans kernel, compositeur, HiGHS, vérificateur ou diagnostics.

## Résultats réellement observés localement

Windows / PowerShell, Python 3.14.3, Node 24.13.0, PostgreSQL 17, rôle runtime
distinct du rôle de migration. Les remises à zéro et downgrades de tests portent
exclusivement sur `optimizer_brain_test`. Le Studio local reçoit uniquement
l'upgrade additif, sans perte d'historique.

| Contrôle | Résultat |
|---|---|
| pytest complet, PostgreSQL réel inclus | **470 passed, 8 skipped**, 203,81 s |
| Vitest complet | **140 passed**, 10 fichiers |
| Playwright complet, API/PostgreSQL/worker réels | **34 passed**, 2,2 min |
| Ruff check | Réussi : brain, tests, migrations, scripts |
| Ruff format selon les chemins CI | **65 fichiers** conformes |
| mypy strict configuré | Réussi : **45 fichiers sources** |
| TypeScript, build, ESLint | Réussis |
| OpenAPI et types générés | Export et génération réussis ; test d'égalité au contrat dans pytest |

Après la suite complète, une correction limitée remplace le rôle d'audit interne
constant par le contexte tenant réel ; les cas création, rollback et concurrence
sont réexécutés avant commit : **5 passed**, 55 désélectionnés, 8,86 s. Ruff et
mypy restent réussis. Aucun calcul mathématique n'est modifié.

Les huit skips sont les variantes SQLite de tests de file/RLS exigeant PostgreSQL ;
les variantes PostgreSQL correspondantes sont exécutées. Deux avertissements
pytest restent issus d'anyio et de Starlette/httpx. Le build avertit sur une
directive du runtime React ; aucune erreur de compilation.

## Couverture ajoutée

**60 cas Python** : catalogue de cibles et responsabilité du registre ; politique
DRAFT, hash attendu, accords nommés, publication autorisée et répétition ; refus
de chemins libres, opérations, unités, propriétaires et plages invalides ; valeurs
hors bornes, domaine entier, paramètres sans politique et tentative de contrainte
HARD ; nouveau graphe/snapshot/modèle DRAFT, publication du graphe puis du modèle
avant jobs ; provenance, parent publié et immutabilité de la référence/du parent ;
collision et concurrence idempotente, rollback atomique de graphe/modèle/scénario/
audit ; RLS sans contexte et sous un autre contexte, pool, privilèges et triggers ;
upgrade préservant clones 5B-1 et payloads ; erreurs publiques fermées ; paramètres
partagés et départementaux recompilés avec décimaux exacts sans changer les unités
ni la structure ; worker réel et vérification indépendante ; révocations du compte
responsable, du rôle publieur et du responsable enregistré après le calcul.

Les révocations après calcul utilisent un ADMIN exécutant explicitement délégué
qui demeure actif : le test vérifie bien l'autorité de la politique, pas seulement
le contrôle historique du compte du créateur de job. Aucun run n'est persisté.

**18 cas Vitest** : politiques et valeurs exponentielles exactes ; provenance
tenant/identité/clé/version/auteur ; correspondance prévisualisation/politique/
référence et confirmation/hash ; absence de délégation implicite du créateur/ADMIN ;
politiques DRAFT/révoquées indisponibles, VIEWER en lecture ; double soumission,
prévisualisation avant création, champs figés, valeurs sans arrondi ; répétition
du commit capturé après réception incertaine ; correction après refus définitif ;
réponses tardives après destruction et corps d'erreur retardé après abandon ;
codes d'erreur fermés sans réflexion de texte sensible.

**Deux nouveaux parcours Playwright** : sur usine et université, créer une
politique avec délégataire explicite, donner l'accord du responsable, publier,
refuser une valeur hors bornes, prévisualiser puis confirmer, publier le nouveau
graphe puis le modèle, résoudre avec le worker et consulter la vérification
indépendante réussie. Les 32 parcours antérieurs continuent de couvrir notamment
annulation en file/RUNNING, échec, INFEASIBLE, TIME_LIMIT, rôle et changement de
tenant, publication et références historiques.

## Valeurs calculées

Références conservées : usine **4100 EUR**, université **17**. Les parcours réels
avec nouvelles hypothèses ont produit **3500 EUR** pour capacité logistique 45,
et **10** pour une capacité de salle 1. Ces valeurs proviennent des runs vérifiés,
pas d'un calcul React ni d'un chiffre attendu fabriqué. Le cas usine modifié est
aussi comparé à une énumération exhaustive indépendante dans le test Python.
Il ne s'agit pas d'une comparaison de runs livrée au produit ni d'un gain annoncé.
Les qualifications de statut, borne, gap et tolérances restent celles du solveur.

## CI et limites

Le workflow inclut automatiquement les nouveaux tests Python/Vitest/Playwright
et ajoute le nouveau fichier Python au contrôle de formatage. Les résultats
distants de chaque commit sont consultables dans les
[Actions de la branche](https://github.com/SIMOS21/Optimizer-brain/actions?query=branch%3Afeature%2Fphase-5b-controlled-scenario-changes).
Aucune réussite distante n'est déduite de ces seuls résultats locaux ; le rapport
de livraison identifie le run GitHub effectivement contrôlé après le push.

SET numérique seulement, une règle par politique créée par l'éditeur Studio
(API jusqu'à 50), pas de délégation de ressources à propriétaires multiples.
Parent publié par identifiant, filiation contrôlée limitée à 16. Pas de garantie
de séparation des personnes entre responsable et publieur ADMIN ; deux actes
explicites. Révocation d'autorités vivantes sans mutation des historiques, pas
d'endpoint de révocation de politique. Grandes filiations non benchmarkées.
Pas de comparaison de runs, gains, sensibilité, 5C/6 ou LLM.
