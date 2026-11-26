import { expect, test, type Page } from "@playwright/test";
import { factory, university } from "./support/fixtures";
import type { GraphDocument } from "../../src/api/types";
import { navigateOrganization, selectOrganization } from "./support/navigation";

async function login(page: Page, role = "admin") {
  if (!process.env.BRAIN_DEMO_PASSWORD)
    throw new Error("Synthetic password required");
  await page.goto("/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(`studio_demo_${role}`);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(process.env.BRAIN_DEMO_PASSWORD);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
}
async function openMap(
  page: Page,
  fixture: typeof factory | typeof university,
) {
  await selectOrganization(page, fixture.organization.id);
  await navigateOrganization(page, "Mon organisation");
  await page
    .getByLabel("Version de la carte", { exact: true })
    .selectOption(fixture.graph.id);
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(
    fixture.graph.document.graph.departments.length +
      fixture.graph.document.graph.resources.length,
  );
  // React Flow attaches node wrappers before measuring them. focus() does not
  // wait for visibility, so counting wrappers alone can send Enter to main.
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}
const screenshots =
  process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots";
async function captureMap(page: Page, name: string) {
  // Extend only the capture height, after interaction checks at 1040px height.
  // This keeps the sticky header at the top without including history rows.
  const viewport = page.viewportSize()!;
  await page.evaluate(() => window.scrollTo(0, 0));
  const bounds = await page.locator(".organization-map-shell").boundingBox();
  if (!bounds) throw new Error("Map bounds unavailable");
  try {
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(viewport.height, Math.ceil(bounds.y + bounds.height)),
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${screenshots}/${name}.png` });
  } finally {
    await page.setViewportSize(viewport);
  }
}
for (const [sector, fixture] of [
  ["factory", factory],
  ["university", university],
] as const) {
  test(`carte ${sector} : données du snapshot, relations, recherche et expert sans mutation`, async ({
    page,
  }) => {
    await login(page);
    await openMap(page, fixture);
    const graph = fixture.graph.document.graph;
    const mutations: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") mutations.push(new URL(r.url()).pathname);
    });
    const inspector = page.locator(".map-inspector");
    const department = graph.departments[0]!;
    const node = page.locator(`.react-flow__node[data-id="${department.id}"]`);
    await node.focus();
    await page.keyboard.press("Enter");
    await expect(
      inspector.getByRole("heading", { name: department.name, exact: true }),
    ).toBeVisible();
    await expect(inspector).toContainText(department.owner_id);
    await expect(page.locator(".react-flow__edge.map-related")).toHaveCount(
      graph.edges.filter(
        (e) => e.source_id === department.id || e.target_id === department.id,
      ).length,
    );
    const resource = graph.resources[0]!;
    const capacity = (fixture.graph.document as GraphDocument)
      .shared_parameters[resource.capacity.parameter]!;
    await page.locator(`.react-flow__node[data-id="${resource.id}"]`).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("map-declared-capacity")).toHaveText(
      `${capacity.value} ${capacity.unit}`,
    );
    await expect(
      inspector.getByRole("button", {
        name: graph.departments.find((d) => d.id === resource.owner_department)!
          .name,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      inspector.getByText("Identifiant stable", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("switch", { name: "Mode expert" }).click();
    await expect(
      inspector.getByText(resource.capacity.parameter, { exact: true }),
    ).toBeVisible();
    const departmentBoxes = await page
      .locator(".react-flow__node:has(.department)")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => {
            const box = node.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom };
          })
          .sort((a, b) => a.top - b.top),
      );
    for (let index = 1; index < departmentBoxes.length; index++)
      expect(departmentBoxes[index]!.top).toBeGreaterThan(
        departmentBoxes[index - 1]!.bottom,
      );
    await captureMap(page, `ux-f3-${sector}-expert-1440`);
    for (const type of ["DEPENDS_ON", "USES_RESOURCE"]) {
      const edge = graph.edges.find((e) => e.type === type);
      if (!edge) continue;
      await page.locator(`.react-flow__edge[data-id="${edge.id}"]`).focus();
      await page.keyboard.press("Enter");
      await expect(
        inspector.getByRole("heading", { name: "Relation informative" }),
      ).toBeVisible();
      await expect(inspector.getByText(type, { exact: true })).toBeVisible();
    }
    await page.getByRole("switch", { name: "Mode expert" }).click();
    await page
      .getByLabel("Rechercher dans la carte")
      .fill("introuvable_synthetique");
    await expect(
      page.getByText("Aucun élément dans ce périmètre", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Afficher toute la carte" }).click();
    await page
      .getByLabel("Rechercher dans la carte")
      .fill(department.name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    await expect(node).toBeVisible();
    await page.getByRole("button", { name: "Effacer les filtres" }).click();
    await page
      .getByLabel("Périmètre", { exact: true })
      .selectOption(department.id);
    await expect(node).toBeVisible();
    await page.getByRole("button", { name: "Effacer les filtres" }).click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(
      graph.edges.length,
    );
    const dependency = graph.edges.find((edge) => edge.type === "DEPENDS_ON");
    if (dependency) {
      const source = graph.departments.find(
        (node) => node.id === dependency.source_id,
      )!;
      const target = graph.departments.find(
        (node) => node.id === dependency.target_id,
      )!;
      await page.getByLabel("Rechercher dans la carte").fill(target.name);
      await page.locator(`.react-flow__node[data-id="${target.id}"]`).focus();
      await page.keyboard.press("Enter");
      await inspector
        .getByRole("button", {
          name: new RegExp(`${source.name} → ${target.name}`),
        })
        .click();
      await expect(page.getByLabel("Rechercher dans la carte")).toHaveValue("");
      await expect(
        page.locator(`.react-flow__edge[data-id="${dependency.id}"]`),
      ).toBeVisible();
    }
    expect(mutations).toEqual([]);
    await captureMap(page, `ux-f3-${sector}-1440`);
  });
}

for (const width of [1440, 1280, 768, 390]) {
  test(`carte ${width}px : clavier, zoom, fiche, focus et mouvement réduit`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1040 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (width === 768)
      await page.addInitScript(() => {
        const NativeResizeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeResizeObserver {
          constructor(callback: ResizeObserverCallback) {
            super((entries, observer) => {
              window.setTimeout(() => callback(entries, observer), 150);
            });
          }
        };
      });
    await login(page);
    await openMap(page, factory);
    const node = page.locator(".react-flow__node").first();
    await expect(node).toBeVisible();
    await node.focus();
    await expect(node).toBeFocused();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Consulter la fiche", exact: true })
      .click();
    await expect(page.locator(".map-inspector h3")).toBeFocused();
    await page
      .getByRole("button", { name: "Fermer la fiche", exact: true })
      .click();
    await expect(node).toBeFocused();
    const viewport = page.locator(".react-flow__viewport").first();
    const before = await viewport.getAttribute("style");
    await page.getByRole("button", { name: "Agrandir", exact: true }).click();
    await expect(viewport).not.toHaveAttribute("style", before!);
    await page.getByRole("button", { name: "Réduire", exact: true }).click();
    await page
      .getByRole("button", { name: "Ajuster la vue", exact: true })
      .click();
    await node.focus();
    await expect(node).toBeFocused();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Consulter la fiche", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".map-inspector h3")
        .evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
    expect(
      await page
        .locator(".map-inspector")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");
    await captureMap(page, `ux-f3-inspector-${width}`);
  });
}

test("carte : réponses de version et tenant tardives ignorées, filtres réinitialisés", async ({
  page,
}) => {
  await login(page);
  await openMap(page, factory);
  await page
    .getByLabel("Rechercher dans la carte")
    .fill("introuvable_synthetique");
  const picker = page.getByLabel("Version de la carte", { exact: true });
  const ids = await picker
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
  const other = ids.find((id) => id !== factory.graph.id);
  expect(other).toBeTruthy();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const url = `**/api/v1/organizations/${factory.organization.id}/graphs/${other}`;
  await page.route(url, async (route) => {
    const response = await route.fetch();
    await barrier;
    try {
      await route.fulfill({ response });
    } catch {
      /* request aborted on tenant change */
    }
  });
  await picker.selectOption(other!);
  await expect(page.getByTestId("graph-canvas")).toHaveCount(0);
  await picker.selectOption(factory.graph.id);
  await expect(page.getByLabel("Rechercher dans la carte")).toHaveValue("");
  await selectOrganization(page, university.organization.id);
  release();
  await navigateOrganization(page, "Mon organisation");
  await page
    .getByLabel("Version de la carte", { exact: true })
    .selectOption(university.graph.id);
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await expect(page.locator(".organization-map")).not.toContainText(
    factory.graph.document.graph.resources[0]!.name,
  );
});

test("carte VIEWER : métier et expert ne donnent aucune action d’écriture", async ({
  page,
}) => {
  await login(page, "viewer");
  await openMap(page, factory);
  for (const expert of [false, true]) {
    if (expert) await page.getByRole("switch", { name: "Mode expert" }).click();
    await expect(
      page.getByRole("button", { name: "Importer un graphe JSON" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Consulter cette version" }).click();
    await expect(
      page.getByRole("button", { name: "Créer un nouveau brouillon" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Publier cette version" }),
    ).toHaveCount(0);
    await navigateOrganization(page, "Mon organisation");
  }
});
