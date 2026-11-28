import { expect, test, type Page } from "@playwright/test";
import { factory, university } from "./support/fixtures";
import { selectOrganization } from "./support/navigation";

test.skip(
  process.env.STUDIO_ASSISTANT_FIXTURE !== "1",
  "Requires explicit isolated fake-provider launcher",
);
const screenshots =
  process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots";
async function login(page: Page, path: string, role = "viewer") {
  await page.goto(path);
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(`studio_demo_${role}`);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(process.env.BRAIN_DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
}
async function activate(page: Page) {
  await page.getByRole("button", { name: "Ouvrir l’assistant" }).click();
  await expect(
    page.getByText(
      "NVIDIA disponible pour les artefacts publics ou synthétiques autorisés.",
    ),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /J’autorise cet envoi/ }).check();
}
async function ask(page: Page) {
  await page
    .getByRole("button", { name: "Demander l’explication à NVIDIA" })
    .click();
  await expect(
    page.getByRole("region", { name: "Explication contrôlée" }),
  ).toBeVisible();
}

for (const [sector, fixture, value] of [
  ["factory", factory, "4100"],
  ["university", university, "17"],
] as const) {
  for (const width of [1440, 390]) {
    test(`${sector} verified assistant at ${width}, authorized role, keyboard and no solve`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1040 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const writes: string[] = [];
      page.on("request", (r) => {
        if (
          r.method() === "POST" &&
          /optimization-jobs|scenarios|publish/.test(r.url())
        )
          writes.push(r.url());
      });
      await login(
        page,
        `/organizations/${fixture.organization.id}/history/${fixture.run.id}`,
        sector === "factory" ? "viewer" : "admin",
      );
      await expect(page.getByTestId("mathematical-status")).toHaveText(
        "OPTIMAL",
      );
      await activate(page);
      await page
        .getByRole("button", { name: "Demander l’explication à NVIDIA" })
        .focus();
      await page.keyboard.press("Enter");
      const result = page.getByRole("region", {
        name: "Explication contrôlée",
      });
      await expect(result).toBeVisible();
      await expect(result).toContainText(value);
      await expect(result).toContainText("Aucune nouvelle preuve");
      expect(writes).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
      await page
        .getByRole("complementary", { name: "Assistant des résultats" })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${screenshots}/nim-${sector}-${width}.png`,
      });
    });
  }
}

test("comparison assistant reads the exact selected pair without a new job", async ({
  page,
}) => {
  await login(
    page,
    `/organizations/${factory.organization.id}/history/compare`,
    "admin",
  );
  await page
    .getByLabel("Run de référence", { exact: true })
    .selectOption(factory.run.id);
  await page
    .getByLabel("Run de scénario candidat", { exact: true })
    .selectOption(factory.run.id);
  await page
    .getByRole("button", { name: "Vérifier la comparaison", exact: true })
    .click();
  await activate(page);
  await ask(page);
  const region = page.getByRole("region", { name: "Explication contrôlée" });
  await expect(region).toContainText(
    "Écart observé candidat − référence : 0 EUR",
  );
  await expect(region).toContainText("Aucun gain économique démontré");
});

test("provider error retry is explicit, bounded and never solves", async ({
  page,
}) => {
  let attempts = 0;
  const solves: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("optimization-jobs"))
      solves.push(r.url());
  });
  await page.route("**/assistant/explain", async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: { code: "LLM_UNAVAILABLE" } }),
      });
    else await route.continue();
  });
  await login(
    page,
    `/organizations/${factory.organization.id}/history/${factory.run.id}`,
    "admin",
  );
  await activate(page);
  await page
    .getByRole("button", { name: "Demander l’explication à NVIDIA" })
    .click();
  await expect(
    page.getByText("NVIDIA est indisponible. Aucun calcul n’a été relancé."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Réessayer l’explication sans résoudre" })
    .click();
  await expect(
    page.getByRole("region", { name: "Explication contrôlée" }),
  ).toBeVisible();
  expect(attempts).toBe(2);
  expect(solves).toEqual([]);
});

test("late provider response cannot cross a tenant switch", async ({
  page,
}) => {
  let release!: () => void;
  let arrived!: () => void;
  const received = new Promise<void>((r) => {
    arrived = r;
  });
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/assistant/explain", async (route) => {
    const response = await route.fetch();
    arrived();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await login(
    page,
    `/organizations/${factory.organization.id}/history/${factory.run.id}`,
    "admin",
  );
  await activate(page);
  await page
    .getByRole("button", { name: "Demander l’explication à NVIDIA" })
    .click();
  await received;
  await selectOrganization(page, university.organization.id);
  release();
  await expect(page).toHaveURL(
    new RegExp(`/organizations/${university.organization.id}$`),
  );
  await expect(
    page.getByRole("region", { name: "Explication contrôlée" }),
  ).toHaveCount(0);
});

test("expired session hides every explanation and requests login", async ({
  page,
}) => {
  await login(
    page,
    `/organizations/${factory.organization.id}/history/${factory.run.id}`,
  );
  await activate(page);
  await page.route("**/assistant/explain", (route) =>
    route.fulfill({ status: 401, body: "" }),
  );
  await page
    .getByRole("button", { name: "Demander l’explication à NVIDIA" })
    .click();
  await expect(
    page.getByRole("button", { name: "Accéder au workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Explication contrôlée" }),
  ).toHaveCount(0);
});
