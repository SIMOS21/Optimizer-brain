# ADR 0012 — Carte organisationnelle liée au snapshot

Date : 26 novembre 2026. Statut : adopté pour UX-F3.

## Contexte

La page Graphs conservait les liens vers les artefacts ; leur détail présentait
une carte surtout technique. `GraphCanvas` possédait déjà des renderers stables,
un layout déterministe en deux colonnes, des filtres et React Flow. Il exécutait
deux projections à l’initialisation et dépendait du remontage par le parent pour
réinitialiser ses états. Aucun nouveau contrat backend n’est nécessaire.

## Décision

`OrganizationMap` choisit par défaut le dernier snapshot publié autorisé, ou le
dernier brouillon en l’absence de publication. Toutes les versions restent
consultables, avec état explicite et liens profonds existants. Le détail est lu
via `ApiClient.graph` et le hook `useLoad` existants. L’identité inclut tenant et
artefact ; les anciennes données disparaissent dès son changement et les réponses
tardives sont ignorées. Le Workspace garde son remontage par organisation et
l’annulation des requêtes lors de la sélection d’un autre tenant.

`GraphCanvas` projette une seule fois par référence de document immuable.
Une clé canonique de contenu identifie sa session visuelle : un changement de
snapshot réinitialise positions locales, sélection, filtres et viewport. Cette
clé n’est ni un hash de modèle, ni une preuve mathématique. Aucun déplacement
local n’est exporté ou sauvegardé dans les artefacts.

Les renderers restent définis au niveau du module ; `OrganizationNode` est
mémorisé. Les callbacks et projections dérivées sont mémorisés. Les arêtes
`smoothstep` de React Flow sont conservées ; aucun nouveau moteur de layout ou
registre de types d’arêtes n’est ajouté. L’ordre reste trié par identifiant,
indépendant des filtres. Les mesures avant/après sont conservées sans promesse
de gain systématique.

Les pas verticaux passent à 220 px pour les départements et 250 px pour les
ressources afin de réserver de la place aux cartes enrichies et aux métadonnées
expert. Il s’agit uniquement du placement visuel initial, sans changement du
GraphDocument ; aucune relation ne dépend de ces coordonnées.

`GraphInspector` présente les valeurs du GraphDocument seulement. Le nom du
département propriétaire est résolu par son identifiant dans ce même document.
`owner_id` est une déclaration descriptive, pas une identité authentifiée ni une
permission. Les valeurs décimales et unités sont affichées comme chaînes exactes.
Aucune consommation, saturation ou contrainte n’est inférée du graphe.

Le périmètre d’un département contient celui-ci, ses ressources déclarées comme
possédées/partagées et ses voisins directs par arêtes enregistrées. La recherche
française intersecte ce périmètre. Seules les arêtes originales dont les deux
extrémités sont visibles sont dessinées. Propriété et partage ne créent jamais
d’arête. Le surlignage concerne uniquement les relations incidentes enregistrées.
Les espaces d’identifiants des nœuds et des arêtes restent distincts.

## Présentation et accès

Le mode métier est celui du contexte UX existant. L’expert ajoute identifiants,
types exacts, paramètres, provenance, versions et JSON secondaire. Les mêmes
capacités serveur conditionnent édition et publication dans les deux modes.
Les liens profonds, l’édition versionnée, les confirmations et l’export restent
accessibles. Aucun endpoint, droit, historique ou contrat mathématique ne change.

Les contrôles React Flow restent disponibles au clavier. Une liste textuelle
offre une autre entrée vers les nœuds. La fiche peut recevoir le focus et être
fermée avec retour vers l’élément déclencheur, ou le canvas en repli. Sous 1100 px,
la fiche passe sous le canvas ; à 390 px la minimap disparaît, les contrôles de
zoom restent disponibles. Les animations CSS sont désactivées en mouvement réduit.

## Limites

Le layout fixe peut devenir dense et le fit global rend les grands graphes petits :
recherche, périmètre, zoom et liste aident l’exploration. Pas de placement
automatique optimisé, de persistance du layout, de nouveau diagnostic ou de
mesure de consommation. Pas de nouvelle dépendance. Pas d’UX-F4/F5 ou de 5B-3.
