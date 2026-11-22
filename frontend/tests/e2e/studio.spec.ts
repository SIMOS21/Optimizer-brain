import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import factory from "../fixtures/factory.json" with { type: "json" };
import university from "../fixtures/university.json" with { type: "json" };

const examples = [
  ["factory", factory, "4100"],
  ["university", university, "17"],
] as const;
async function login(page: Page, role = "admin") {
  const password = process.env.BRAIN_DEMO_PASSWORD;
  if (!password)
    throw new Error(
      "BRAIN_DEMO_PASSWORD requis pour le parcours réel ; aucun secret dans les fixtures.",
    );
  await page.goto("/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(`studio_demo_${role}`);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Choisissez votre espace de travail." }),
  ).toBeVisible();
}
async function openGraph(
  page: Page,
  fixture: typeof factory | typeof university,
) {
  await page
    .getByRole("combobox", { name: "Organisation", exact: true })
    .selectOption(fixture.organization.id);
  await page
    .locator(
      `a[href="/organizations/${fixture.organization.id}/graphs/${fixture.graph.id}"]`,
    )
    .click();
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(
    fixture.graph.document.graph.departments.length +
      fixture.graph.document.graph.resources.length,
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(
    fixture.graph.document.graph.edges.length,
  );
}
for (const [name, fixture, objective] of examples) {
  test(`${name}: API réelle → graphe → version publiée → modèle → historique`, async ({
    page,
  }) => {
    await login(page);
    await openGraph(page, fixture);
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET")
        mutations.push(new URL(request.url()).pathname);
    });
    const node = page.locator(".react-flow__node").first();
    await page.locator(".react-flow__edge").first().focus();
    await page.keyboard.press("Enter");
    await expect(
      page
        .locator(".inspector")
        .getByRole("heading", { name: "Relation informative" }),
    ).toBeVisible();
    await node.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator(".inspector").getByText("Identifiant stable"),
    ).toBeVisible();
    const box = await node.boundingBox();
    if (!box) throw new Error("Nœud non positionné");
    await page.mouse.move(box.x + 55, box.y + 45);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 80, { steps: 6 });
    await page.mouse.up();
    expect(mutations).toEqual([]);
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Exporter le snapshot JSON" })
      .click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("Export JSON absent");
    const exported = JSON.parse(await readFile(path, "utf8"));
    expect(exported.shared_parameters).toEqual(
      fixture.graph.document.shared_parameters,
    );
    expect(exported.graph.edges).toEqual(
      [...fixture.graph.document.graph.edges].sort((a, b) =>
        a.id < b.id ? -1 : 1,
      ),
    );
    expect(
      exported.graph.departments.every(
        (item: { position?: unknown }) => !item.position,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../docs/screenshots/studio-${name}.png`,
      fullPage: true,
    });
    const version = `ui_${Date.now()}_${name}`;
    await page
      .getByRole("button", { name: "Créer un nouveau brouillon" })
      .click();
    await page.getByLabel("Nouvelle version du graphe").fill(version);
    await page
      .getByRole("button", { name: "Valider et enregistrer le brouillon" })
      .click();
    await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
    expect(mutations.filter((url) => url.includes("/publish"))).toEqual([]);
    await page.getByRole("button", { name: "Publier cette version" }).click();
    await expect(
      page.getByRole("group", { name: "Confirmation de publication" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirmer la publication", exact: true })
      .click();
    await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Modèles & contraintes" }).click();
    await page
      .locator(
        `a[href="/organizations/${fixture.organization.id}/models/${fixture.model.id}"]`,
      )
      .click();
    await expect(
      page.getByText(
        `Contraintes compilées · ${fixture.model.document.dsl.constraints.length}`,
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Créer une version de modèle" })
      .click();
    await page
      .getByLabel("Nouvelle version du modèle", { exact: true })
      .fill(version);
    await page
      .getByRole("button", { name: "Valider et enregistrer le modèle" })
      .click();
    await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Publier cette version" }).click();
    await page
      .getByRole("button", { name: "Confirmer la publication", exact: true })
      .click();
    await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
    await page.getByLabel("Version à comparer").selectOption(fixture.model.id);
    await expect(
      page.getByRole("cell", { name: "model_version", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Historique vérifié" }).click();
    await page.getByLabel("Résultat historique").selectOption(fixture.run.id);
    await expect(page.getByTestId("recorded-objective")).toHaveText(objective);
    await expect(
      page.getByText(/Vérification indépendante réussie/),
    ).toBeVisible();
    expect(
      mutations.some(
        (url) =>
          url.endsWith("/optimization-runs") || url.includes("/optimize"),
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "Déconnexion" }).click();
    await expect(
      page.getByRole("heading", { name: "Se connecter au Studio" }),
    ).toBeVisible();
    await expect(page.getByTestId("recorded-objective")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          Object.keys(localStorage).length + Object.keys(sessionStorage).length,
      ),
    ).toBe(0);
  });
}
test("changement de tenant, purge et rechargement sans session persistante", async ({
  page,
}) => {
  await login(page);
  await openGraph(page, factory);
  await page
    .getByText(factory.graph.document.graph.resources[0]!.name, { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Organisation", exact: true })
    .selectOption(university.organization.id);
  await expect(
    page.getByRole("heading", { name: "Une organisation. Un modèle commun." }),
  ).toBeVisible();
  await expect(
    page.getByText(factory.graph.document.graph.resources[0]!.name, {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Se connecter au Studio" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Navigation de l’organisation" }),
  ).toHaveCount(0);
});
test("VIEWER sans action de publication ni autre organisation", async ({
  page,
}) => {
  await login(page, "viewer");
  await expect(
    page
      .getByRole("combobox", { name: "Organisation", exact: true })
      .locator(`option[value="${university.organization.id}"]`),
  ).toHaveCount(0);
  await openGraph(page, factory);
  await expect(
    page.getByRole("button", { name: "Créer un nouveau brouillon" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publier cette version" }),
  ).toHaveCount(0);
});

test("BUILDER peut préparer une version mais ne peut pas la publier", async ({
  page,
}) => {
  await login(page, "builder");
  await openGraph(page, factory);
  await page
    .getByRole("button", { name: "Créer un nouveau brouillon" })
    .click();
  await page
    .getByLabel("Nouvelle version du graphe")
    .fill(`builder_${Date.now()}`);
  await page
    .getByRole("button", { name: "Valider et enregistrer le brouillon" })
    .click();
  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publier cette version" }),
  ).toHaveCount(0);
});
for (const status of [401, 403, 404, 409, 422, 413]) {
  test(`erreur HTTP ${status} fidèle au contrat, sans contenu sensible réfléchi`, async ({
    page,
  }) => {
    await login(page);
    await page.route(
      `**/api/v1/organizations/${factory.organization.id}/graphs/${factory.graph.id}`,
      (route) =>
        route.fulfill({
          status,
          json: { detail: "sensitive-response-must-not-be-shown" },
        }),
    );
    await page
      .getByRole("combobox", { name: "Organisation", exact: true })
      .selectOption(factory.organization.id);
    await page
      .locator(
        `a[href="/organizations/${factory.organization.id}/graphs/${factory.graph.id}"]`,
      )
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByText("sensitive-response-must-not-be-shown"),
    ).toHaveCount(0);
    if (status === 401)
      await expect(
        page.getByRole("heading", { name: "Se connecter au Studio" }),
      ).toBeVisible();
  });
}
test("layout mobile sans débordement horizontal du workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openGraph(page, university);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/studio-mobile.png",
    fullPage: true,
  });
});

test("organisation vide → départements → import graphe → modèle, sans run inventé", async ({
  page,
}) => {
  await login(page);
  const key = `studio_import_${Date.now()}`;
  await page.getByRole("button", { name: "Créer une organisation" }).click();
  await page.getByLabel("Clé de l’organisation").fill(key);
  await page
    .getByLabel("Nom de l’organisation")
    .fill("Organisation synthétique importée");
  await page.getByRole("button", { name: "Créer l’espace" }).click();
  await expect(
    page.getByRole("heading", { name: "Départements enregistrés" }),
  ).toBeVisible();
  for (const department of factory.graph.document.graph.departments) {
    await page.getByLabel("Identifiant du département").fill(department.id);
    await page.getByLabel("Nom du département").fill(department.name);
    await page
      .getByRole("button", { name: "Enregistrer un département" })
      .click();
    await expect(
      page.getByRole("heading", { name: department.name, exact: true }),
    ).toBeVisible();
  }
  const graph = structuredClone(factory.graph.document);
  graph.graph.organization.id = key;
  graph.graph.organization.name = "Organisation synthétique importée";
  graph.graph.organization.data_snapshot_id = `${key}_data`;
  await page
    .getByRole("link", { name: "Organization Graph", exact: true })
    .click();
  await page.getByRole("button", { name: "Importer un graphe JSON" }).click();
  await page.getByLabel("Document JSON à importer").fill(JSON.stringify(graph));
  await page
    .getByRole("button", { name: "Valider et enregistrer l’import" })
    .click();
  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
  const graphId = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "Publier cette version" }).click();
  await page
    .getByRole("button", { name: "Confirmer la publication", exact: true })
    .click();
  await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
  const source = structuredClone(factory.model.document.organization_model);
  source.graph = graph.graph;
  source.shared_parameters = graph.shared_parameters;
  source.fragments.forEach((fragment) => {
    fragment.organization_id = key;
  });
  await page.getByRole("link", { name: "Modèles & contraintes" }).click();
  await page.getByRole("button", { name: "Importer un modèle JSON" }).click();
  await page
    .getByRole("combobox", { name: "Graphe publié de l’import", exact: true })
    .selectOption(graphId);
  await page
    .getByLabel("Document JSON à importer")
    .fill(JSON.stringify(source));
  await page
    .getByRole("button", { name: "Valider et enregistrer l’import" })
    .click();
  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
  await expect(page.getByText("Contraintes compilées · 3")).toBeVisible();
  await page.getByRole("link", { name: "Historique vérifié" }).click();
  await expect(
    page.getByText(/Aucun run enregistré pour cette organisation/),
  ).toBeVisible();
  await expect(page.getByTestId("recorded-objective")).toHaveCount(0);
});
