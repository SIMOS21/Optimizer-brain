# ADR 0001 — Introduire un kernel parallèle au MVP

Date : 22 novembre 2026. Statut : adopté pour les phases 0 et 1.

## Décision et raisons

1. **Conserver `brain/` et l'API legacy.** Le MVP possède 14 tests et un exemple
   fonctionnel ; son déplacement ou sa réécriture ne contribue pas au contrat de
   phase 1. `brain/kernel/` devient une bibliothèque indépendante. L'adaptateur
   HiGHS sera ajouté ensuite, puis le template industriel sera migré délibérément.
2. **Pydantic v2 et JSON structuré fermé.** Cette dépendance existe déjà via FastAPI ;
   elle devient explicite. Aucune expression textuelle n'est interprétée en code.
   Les indices sont développés explicitement et vérifiés dans un registre fini.
3. **Decimal aux frontières, Fraction dans l'IR/interpréteur.** Cela évite les
   annulations et arrondis dus au contexte Decimal lors de l'agrégation et des
   conversions, sans ajouter de bibliothèque. Les entrées numériques sont bornées
   en taille. L'adaptateur flottant devra vérifier la conversion et ses résidus
   en phase 2. Ce choix ne promet aucun certificat symbolique d'optimalité.
4. **Algèbre d'unités fermée, facteurs rationnels.** Chaque unité est un vecteur
   d'exposants dimensionnels et un facteur d'échelle. Le produit additionne les
   exposants ; une conversion divise les échelles. Chaque terme doit satisfaire
   `dimensions(coefficient_unit × variable.unit) = dimensions(expression.unit)`.
   Les monnaies ont des dimensions distinctes. Ce petit registre est suffisant
   pour la tranche livrée et évite une dépendance d'unités supplémentaire.
5. **IR sparse immuable et compilation déterministe.** Les doublons de termes sont
   additionnés, les zéros retirés après validation et les registres triés. Pour T
   termes et V variables, le travail est essentiellement O(T + V), avec des tris
   O(T log T + V log V) au pire ; le coût arithmétique dépend aussi de la taille
   des rationnels. Aucun algorithme de résolution n'est caché dans le compilateur.
6. **Détection locale d'infaisabilité par intervalles.** Pour un terme `a*x`, les
   bornes sont `min(a*lb,a*ub)` et `max(a*lb,a*ub)`. Leur somme fournit l'intervalle
   d'une ligne. Un intervalle disjoint du membre droit selon le comparateur
   produit un avertissement. Cette analyse linéaire ne traite pas les interactions
   entre lignes ; elle ne répare ni ne relâche aucune règle.
7. **Interpréteur de témoin indépendant du solveur.** Sommes rationnelles,
   vérification des bornes et distance à l'entier le plus proche, résidus selon
   comparateur, objectif recalculé ; O(T + V). Tolérances nulles par défaut et
   explicites dans le rapport. Aucun arrondi de plan, aucun statut d'optimalité.
8. **Deux hashes.** Le hash mathématique résolu ignore l'ordre et les métadonnées
   d'affichage ; celui du manifeste conserve les différences de provenance. Ils
   identifient des artefacts, sans remplacer une signature, un contrôle d'accès
   ni le stockage des snapshots.
9. **Oracle exhaustif uniquement en test.** Le cas 41 × 36 est assez petit pour
   contrôler toutes les décisions avec des équations indépendantes. Cette preuve
   du golden couvre la compilation et l'interpréteur sans anticiper l'adaptateur
   solveur de phase 2. Sa complexité exponentielle interdit sa généralisation.

## Limites acceptées

Un seul objectif, contraintes HARD et domaines numériques bornés ; unités finies,
pas de macros d'indexation. Les marqueurs d'approbation sont déclaratifs.
Le legacy conserve ses statuts et limites identifiés dans l'audit. La phase 1
ne prétend pas remplir les critères de production, de gouvernance ou de phase 2.
