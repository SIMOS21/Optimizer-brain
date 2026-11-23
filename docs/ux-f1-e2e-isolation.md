# UX-F1 — Exécutions E2E isolées et mesures

Les tests navigateur utilisent exclusivement `optimizer_brain_e2e`, distincte de
la démonstration `optimizer_brain_studio` et des tests Python `optimizer_brain_test`.
Les migrations existantes sont appliquées sans modification. Aucun reset,
TRUNCATE, DROP ou nettoyage des organisations n'est proposé par le lanceur E2E.

Préparer un fichier privé `.local/e2e.env`, ignoré par Git :

```text
BRAIN_E2E_DATABASE_URL=postgresql+psycopg://<runtime>:<secret>@127.0.0.1:<port>/optimizer_brain_e2e
BRAIN_E2E_MIGRATION_DATABASE_URL=postgresql+psycopg://<migrateur>:<secret>@127.0.0.1:<port>/optimizer_brain_e2e
```

Ces deux identités restent distinctes. Le migrateur doit pouvoir créer la base
si elle est absente ; le rôle runtime existant conserve les protections de la
plateforme. Aucun rôle ni mot de passe existant n'est réécrit. Le lanceur refuse
une autre base, un serveur non local ou des services déjà présents sur ses ports.

```powershell
python -m scripts.studio_e2e --env-file .local/e2e.env
# Provisionnement seul ; réexécutable sans effacer les historiques E2E
python -m scripts.studio_e2e --env-file .local/e2e.env --prepare-only
# Garder le Studio E2E disponible jusqu'à Ctrl+C
python -m scripts.studio_e2e --env-file .local/e2e.env --serve
# Mesures/captures de navigation sans mutation métier
python -m scripts.studio_e2e --env-file .local/e2e.env --measure before
python -m scripts.studio_e2e --env-file .local/e2e.env --measure after
```

API E2E : **8002**, Studio E2E : **5181**. Les services de démonstration 8001/5180
ne sont ni arrêtés ni réutilisés. Les services créés par le lanceur sont arrêtés
à sa sortie ; les workers restent gérés par les tests existants. Les enfants API,
Studio et workers ne reçoivent pas l'URL de migration ni le mot de passe démo.
Le navigateur de test reçoit seulement son propre mot de passe synthétique.

Les comptes E2E sont `studio_demo_admin`, `studio_demo_builder`,
`studio_demo_approver`, `studio_demo_viewer`. Leur secret est fourni par
`BRAIN_E2E_PASSWORD` ou généré une fois dans `.local/e2e/password.txt` (privé,
ignoré par Git). Ce secret est indépendant de celui de la démonstration.

Le provisionnement réutilise les exemples et publications habituels et les
résolutions vérifiées existantes ; il ajoute 20 espaces synthétiques aux clés
`studio_import_ux_fixture_XX` pour tester le catalogue. Il conserve les données des
exécutions précédentes. Les fixtures et le manifeste E2E sont écrits sous
`.local/e2e/`, sans remplacer `frontend/tests/fixtures` ni `.local/studio/manifest.json`.
Les fixtures versionnées continuent de servir aux tests Vitest hors ligne.

`npm run test:e2e` seul refuse désormais un environnement non isolé. Utiliser le
lanceur Python ; il construit le frontend puis passe les variables nécessaires
à Playwright. `--skip-build` est disponible quand le build a déjà été validé.
Les anciens lanceurs locaux pointant sur la démonstration sont refusés par le
garde Playwright, même si leur URL runtime existe.

## Protocole de mesure

Chromium, trois contextes neufs par largeur 1440/390, même machine et références
publiées. Mesurer connexion → catalogue visible, ouverture → graphe enregistré
accessible dans la page, navigation chaude vers la liste de graphes, changement
d'organisation → données du nouveau tenant. Compter les requêtes API et refuser
toute mutation hors authentification pendant la mesure. Vérifier l'absence de
débordement horizontal. Les captures et données brutes sont conservées dans
`.local/ux-f1/before` et `.local/ux-f1/after`, hors nettoyage de Playwright.

Ces durées incluent l'automatisation des interactions. Trois échantillons locaux
ne constituent ni un SLA ni une certification d'accessibilité. L'ouverture du
dialogue de sélection fait partie du parcours après refonte ; ne pas présenter
cette durée comme un simple temps réseau. Le rapport final distingue les
mesures réellement exécutées des objectifs de la spécification.
