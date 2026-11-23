import { expect, test, type Page } from "@playwright/test";
import { factory, university } from "./support/fixtures";
import type { ModelSource } from "../../src/api/types";

async function login(page: Page, role = "viewer") {
  if (!process.env.BRAIN_DEMO_PASSWORD)
    throw new Error("Synthetic demo password required");
  await page.goto("/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(`studio_demo_${role}`);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(process.env.BRAIN_DEMO_PASSWORD);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
}
for (const [sector, fixture, objective] of [
  ["factory", factory, "4100"],
  ["university", university, "17"],
] as const) {
  test(`${sector}: diagnostics réels du modèle et du run, lecture seule`, async ({
    page,
  }) => {
    await login(page, "admin");
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    await page
      .getByRole("combobox", { name: "Organisation", exact: true })
      .selectOption(fixture.organization.id);
    await page.getByRole("link", { name: "Modèles & contraintes" }).click();
    await page
      .locator(
        `a[href="/organizations/${fixture.organization.id}/models/${fixture.model.id}"]`,
      )
      .click();
    await page
      .getByRole("button", { name: "Consulter les diagnostics" })
      .click();
    await expect(page.getByTestId("static-conclusion")).toContainText(
      "non concluante",
    );
    await expect(
      page
        .getByTestId("constraint-diagnostics")
        .getByText("UNAVAILABLE", { exact: true }),
    ).toHaveCount(fixture.model.document.dsl.constraints.length);
    await page.getByRole("link", { name: "Historique vérifié" }).click();
    await page.getByLabel("Résultat historique").selectOption(fixture.run.id);
    await expect(page.getByTestId("recorded-objective")).toHaveText(objective);
    await page
      .getByRole("button", { name: "Consulter les diagnostics" })
      .click();
    const diagnostics = page.getByTestId("constraint-diagnostics");
    await expect(
      diagnostics.getByText(
        "Plan contrôlé indépendamment selon les tolérances enregistrées.",
      ),
    ).toBeVisible();
    await expect(
      diagnostics.getByText("NOT_EVALUATED", { exact: true }),
    ).toHaveCount(fixture.model.document.dsl.constraints.length);
    await expect(
      diagnostics.getByText("VIOLATED", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("recorded-objective")).toHaveText(objective);
    expect(writes).toEqual([]);
    await page.screenshot({
      path: `${process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots"}/diagnostics-${sector}.png`,
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Organisation", exact: true })
      .selectOption(
        sector === "factory"
          ? university.organization.id
          : factory.organization.id,
      );
    await expect(diagnostics).toHaveCount(0);
  });
}

test("contradiction Ventes/Logistique réelle, sans modifier le modèle publié", async ({
  page,
}) => {
  const auth = await page.request.post("/api/v1/auth/login", {
    data: {
      username: "studio_demo_admin",
      password: process.env.BRAIN_DEMO_PASSWORD,
    },
  });
  expect(auth.status()).toBe(200);
  const { access_token } = (await auth.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  let identity: string;
  try {
    const source = structuredClone(
      factory.model.document.organization_model,
    ) as ModelSource;
    source.model_id = "synthetic_diagnostic_conflict";
    source.model_version = `diagnostics_${Date.now()}`;
    const sales = source.fragments.find(
      (fragment) => fragment.department_id === "sales",
    )!;
    sales.constraints ??= [];
    sales.constraints.push({
      id: "synthetic_sales_demand",
      owner_department: "sales",
      kind: "HARD",
      source: "synthetic_approved_sales",
      approved: true,
      version: "1",
      terms: ["qty_A", "qty_B"].map((variable) => ({
        variable,
        coefficient: "1",
        coefficient_unit: "1",
      })),
      operator: ">=",
      rhs: "60",
      unit: "unit",
    });
    const response = await page.request.post(
      `/api/v1/organizations/${factory.organization.id}/model-versions`,
      {
        headers,
        data: {
          graph_snapshot_id: factory.model.graph_snapshot_id,
          model: source,
        },
      },
    );
    expect(response.status()).toBe(201);
    identity = ((await response.json()) as { id: string }).id;
  } finally {
    await page.request.post("/api/v1/auth/logout", { headers });
  }
  await login(page);
  await page
    .getByRole("combobox", { name: "Organisation", exact: true })
    .selectOption(factory.organization.id);
  await page.getByRole("link", { name: "Modèles & contraintes" }).click();
  await page
    .locator(
      `a[href="/organizations/${factory.organization.id}/models/${identity}"]`,
    )
    .click();
  await page.getByRole("button", { name: "Consulter les diagnostics" }).click();
  await expect(page.getByTestId("static-conclusion")).toContainText(
    "Contradiction démontrée",
  );
  const diagnostics = page.getByTestId("constraint-diagnostics");
  await expect(
    diagnostics.getByText(/synthetic_sales_demand · département sales/),
  ).toBeVisible();
  await expect(
    diagnostics.getByText(/logistics_delivery · département logistics/),
  ).toBeVisible();
  await expect(
    diagnostics.locator("p").filter({ hasText: "Aucun IIS fourni" }),
  ).toBeVisible();
  await expect(page.getByTestId("recorded-objective")).toHaveCount(0);
});
