import { expect, test, type Page } from "@playwright/test";
import { factory, university } from "./support/fixtures";
import { selectOrganization } from "./support/navigation";
import type { Artifact, RunArtifact } from "../../src/api/types";

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

async function latestStoredRun(
  page: Page,
  organizationId: string,
): Promise<RunArtifact> {
  const login = await page.request.post("/api/v1/auth/login", {
    data: {
      username: "studio_demo_admin",
      password: process.env.BRAIN_DEMO_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const base = `/api/v1/organizations/${organizationId}`;
  try {
    const records: Artifact[] = [];
    for (let offset = 0; ; offset += 100) {
      const response = await page.request.get(
        `${base}/optimization-runs?limit=100&offset=${offset}`,
        { headers },
      );
      expect(response.status()).toBe(200);
      const { items } = (await response.json()) as { items: Artifact[] };
      records.push(...items);
      if (items.length < 100) break;
    }
    records.sort(
      (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
    );
    const response = await page.request.get(
      `${base}/optimization-runs/${records[0]!.id}`,
      { headers },
    );
    expect(response.status()).toBe(200);
    return (await response.json()) as RunArtifact;
  } finally {
    await page.request.post("/api/v1/auth/logout", { headers });
  }
}

async function selectReference(
  page: Page,
  fixture: typeof factory | typeof university,
) {
  await page
    .getByLabel("Résultat du tableau de bord", { exact: true })
    .selectOption(fixture.run.id);
  const context = page.getByTestId("dashboard-run-context");
  await expect(
    context.getByRole("link", { name: fixture.run.id, exact: true }),
  ).toBeVisible();
  await expect(context).toContainText(
    String(fixture.run.document.solve.scenario_id),
  );
  await expect(context).toContainText(
    String(fixture.run.document.solve.data_snapshot_id),
  );
  await expect(
    page.getByTestId("dashboard-model-version").getByRole("link"),
  ).toHaveAttribute(
    "href",
    `/organizations/${fixture.organization.id}/models/${fixture.model.id}`,
  );
}

test("dashboard usine et université : objectifs réels, ressources, mode expert et switch sans fuite", async ({
  page,
}) => {
  await login(page);
  await selectOrganization(page, factory.organization.id);
  // The latest real run may be a controlled scenario. Compare identity and
  // stored value with the secured API, independently of the reference golden.
  const latest = await latestStoredRun(page, factory.organization.id);
  await expect(
    page
      .getByTestId("dashboard-run-context")
      .getByRole("link", { name: latest.id, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("dashboard-run-context")).toContainText(
    String(latest.document.solve.scenario_id),
  );
  await expect(page.getByTestId("dashboard-objective")).toHaveText(
    String(latest.document.solve.objective_value),
  );
  await page.screenshot({
    path: `${screenshots}/ux-f2-dashboard-latest-1440.png`,
    fullPage: true,
  });
  await selectReference(page, factory);
  await expect(page.getByTestId("dashboard-objective")).toHaveText("4100");
  await expect(page.getByTestId("dashboard-objective-unit")).toContainText(
    "EUR",
  );
  await expect(page.getByTestId("dashboard-decisions")).toContainText("40");
  await expect(page.getByTestId("dashboard-decisions")).toContainText("15");
  await expect(page.getByTestId("dashboard-resources")).toContainText(
    "95 / 100",
  );
  await expect(page.getByTestId("dashboard-resources")).toContainText(
    "7000 / 8000",
  );
  await expect(page.getByTestId("dashboard-resources")).toContainText(
    "55 / 55",
  );
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
  await selectReference(page, university);
  await expect(page.getByTestId("dashboard-objective")).toHaveText("17");
  await expect(page.getByText("4100")).toHaveCount(0);
  await page.screenshot({
    path: `${screenshots}/ux-f2-dashboard-university-1440.png`,
    fullPage: true,
  });
});

test("dashboard mobile 390px sans débordement horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await selectOrganization(page, factory.organization.id);
  await selectReference(page, factory);
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
  await selectReference(page, factory);
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
