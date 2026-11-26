import { expect, test, type Page } from "@playwright/test";
import { factory, university } from "./support/fixtures";
import { selectOrganization } from "./support/navigation";

async function login(page: Page, role = "admin", visit = true) {
  if (!process.env.BRAIN_DEMO_PASSWORD)
    throw new Error("Synthetic E2E password required");
  if (visit) await page.goto("/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(`studio_demo_${role}`);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(process.env.BRAIN_DEMO_PASSWORD);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
}
const screenshots =
  process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots";

test("catalogue 20+ : recherche française, groupes explicites et pagination sans suppression", async ({
  page,
}) => {
  await login(page);
  const main = page.getByRole("main");
  const group = main.getByRole("region", {
    name: "Espaces de test",
    exact: true,
  });
  await expect(group.getByRole("link")).toHaveCount(6);
  await group.getByRole("button", { name: "Suivant" }).click();
  await expect(group.getByRole("link").first()).toContainText(
    "Espace de test navigation 07",
  );
  await main.getByLabel("Rechercher une organisation").fill("universite");
  await expect(
    main.locator(`a[href="/organizations/${university.organization.id}"]`),
  ).toBeVisible();
  await main.getByLabel("Rechercher une organisation").fill("usine");
  await main
    .locator(`a[href="/organizations/${factory.organization.id}"]`)
    .click();
  await expect(page.getByTestId("active-organization")).toHaveText(
    factory.organization.name,
  );
  await expect(
    page.getByRole("switch", { name: "Mode expert" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.screenshot({
    path: `${screenshots}/ux-f1-shell-1440.png`,
    fullPage: true,
  });
});

test("les quatre rôles conservent leurs capacités en métier et expert", async ({
  page,
}) => {
  let draftId = "";
  for (const role of ["builder", "viewer", "approver", "admin"]) {
    await login(page, role);
    await selectOrganization(page, factory.organization.id);
    if (draftId && ["viewer", "approver"].includes(role)) {
      await page
        .getByRole("link", { name: "Mon organisation", exact: true })
        .click();
      await page
        .locator(
          `a[href="/organizations/${factory.organization.id}/graphs/${draftId}"]`,
        )
        .click();
    } else {
      await page
        .getByRole("link", { name: "Mon organisation", exact: true })
        .click();
      await page
        .locator(
          `a[href="/organizations/${factory.organization.id}/graphs/${factory.graph.id}"]`,
        )
        .click();
    }
    const mode = page.getByRole("switch", { name: "Mode expert" });
    await expect(mode).toHaveAttribute("aria-checked", "false");
    for (const expert of [false, true]) {
      if (expert) await mode.click();
      await expect(page.getByTestId("active-role")).toContainText(
        role.toUpperCase(),
      );
      await expect(
        page.getByRole("button", {
          name: "Créer un nouveau brouillon",
          exact: true,
        }),
      ).toHaveCount(["builder", "admin"].includes(role) ? 1 : 0);
      if (role === "viewer")
        await expect(
          page.getByRole("button", {
            name: "Publier cette version",
            exact: true,
          }),
        ).toHaveCount(0);
      if (role === "approver")
        await expect(
          page.getByRole("button", {
            name: "Publier cette version",
            exact: true,
          }),
        ).toBeVisible();
    }
    if (role === "builder") {
      await page
        .getByRole("button", {
          name: "Créer un nouveau brouillon",
          exact: true,
        })
        .click();
      await page
        .getByLabel("Nouvelle version du graphe")
        .fill(`ux_roles_${Date.now()}`);
      const created = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/graphs"),
      );
      await page
        .getByRole("button", { name: "Valider et enregistrer le brouillon" })
        .click();
      const response = await created;
      expect(response.status()).toBe(201);
      draftId = ((await response.json()) as { id: string }).id;
    }
    if (role === "approver") {
      await page
        .getByRole("button", { name: "Publier cette version", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirmer la publication", exact: true })
        .click();
      await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Déconnexion", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Se connecter au Studio" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
  }
});

test("lien profond modèle conservé après connexion VIEWER, sans privilège expert", async ({
  page,
}) => {
  const target = `/organizations/${factory.organization.id}/models/${factory.model.id}`;
  await page.goto(target);
  await login(page, "viewer", false);
  await expect(page).toHaveURL(new RegExp(`${target}$`));
  await expect(
    page.getByText("IR originale enregistrée", { exact: true }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Mode expert" }).click();
  await expect(page.getByTestId("active-role")).toContainText("VIEWER");
  await expect(
    page.getByRole("button", { name: "Publier cette version", exact: true }),
  ).toHaveCount(0);
});

test("changement de tenant : identité effacée immédiatement et réponse tardive ignorée", async ({
  page,
}) => {
  await login(page);
  await selectOrganization(page, factory.organization.id);
  const resultLink = page.getByRole("link", {
    name: "Comprendre ce résultat",
    exact: true,
  });
  await expect(resultLink).toBeVisible();
  const recordedHref = await resultLink.getAttribute("href");
  expect(recordedHref).toMatch(
    new RegExp(`^/organizations/${factory.organization.id}/history/`),
  );
  const oldDashboardLink = `#main-content a[href="${recordedHref}"]`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/v1/organizations/${university.organization.id}`,
    async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    },
  );
  try {
    await selectOrganization(page, university.organization.id);
    await expect(page.getByTestId("active-organization")).toHaveText(
      "Chargement de l’organisation…",
    );
    await expect(page.locator(oldDashboardLink)).toHaveCount(0);
    await page.goBack();
    await expect(page.getByTestId("active-organization")).toHaveText(
      factory.organization.name,
    );
    release();
    await expect(page.locator(oldDashboardLink).first()).toBeVisible();
    await expect(page.getByTestId("active-organization")).not.toContainText(
      university.organization.name,
    );
  } finally {
    release();
  }
});

test("390 px : menu modal, clavier, retour du focus et absence de débordement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await selectOrganization(page, factory.organization.id);
  await expect(
    page.getByRole("heading", { name: factory.organization.name, exact: true }),
  ).toBeVisible();
  const trigger = page.getByRole("button", {
    name: "Ouvrir le menu",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Navigation de l’organisation",
  });
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
  }
  await page.screenshot({
    path: `${screenshots}/ux-f1-menu-390.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const mode = page.getByRole("switch", { name: "Mode expert" });
  await mode.focus();
  await page.keyboard.press(" ");
  await expect(mode).toHaveAttribute("aria-checked", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${screenshots}/ux-f1-shell-390.png`,
    fullPage: true,
  });
});
