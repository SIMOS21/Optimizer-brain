import { expect, test, type Page } from "@playwright/test";
import { factory, university } from "./support/fixtures";
import { selectOrganization } from "./support/navigation";

async function login(page: Page, role = "admin") {
  if (!process.env.BRAIN_DEMO_PASSWORD)
    throw new Error("Synthetic E2E password required");
  await page.goto("/");
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

test("dashboard usine et université : objectifs réels, ressources, mode expert et switch sans fuite", async ({
  page,
}) => {
  await login(page);
  await selectOrganization(page, factory.organization.id);
  await expect(page.getByTestId("dashboard-objective")).toHaveText("4100");
  await expect(page.getByTestId("dashboard-objective-unit")).toContainText("EUR");
  await expect(page.getByTestId("dashboard-decisions")).toContainText("40");
  await expect(page.getByTestId("dashboard-decisions")).toContainText("15");
  await expect(page.getByTestId("dashboard-resources")).toContainText("95 / 100");
  await expect(page.getByTestId("dashboard-resources")).toContainText("7000 / 8000");
  await expect(page.getByTestId("dashboard-resources")).toContainText("55 / 55");
  await expect(page.getByTestId("dashboard-saturated")).toContainText(
    "logistics_delivery",
  );
  await page.screenshot({
    path: `${screenshots}/ux-f2-dashboard-factory-1440.png`,
    fullPage: true,
  });

  // Expert mode shows provenance without granting extra permissions
  await page.getByRole("switch", { name: "Mode expert" }).click();
  await expect(page.getByTestId("dashboard-expert-provenance")).toBeVisible();

  // Switch to university: no factory values leak
  await selectOrganization(page, university.organization.id);
  await expect(page.getByTestId("dashboard-objective")).toHaveText("17");
  await expect(page.getByText("4100")).toHaveCount(0);
});

test("dashboard mobile 390px sans débordement horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await selectOrganization(page, factory.organization.id);
  await expect(page.getByTestId("dashboard-objective")).toHaveText("4100");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${screenshots}/ux-f2-dashboard-factory-390.png`,
    fullPage: true,
  });
});

test("dashboard VIEWER : lecture seule, aucune action d'écriture en mode métier ou expert", async ({
  page,
}) => {
  await login(page, "viewer");
  await selectOrganization(page, factory.organization.id);
  await expect(page.getByTestId("dashboard-objective")).toHaveText("4100");
  await expect(
    page.getByRole("link", { name: "Lancer une optimisation" }),
  ).toHaveCount(0);
  await page.getByRole("switch", { name: "Mode expert" }).click();
  await expect(page.getByTestId("dashboard-expert-provenance")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Lancer une optimisation" }),
  ).toHaveCount(0);
});
