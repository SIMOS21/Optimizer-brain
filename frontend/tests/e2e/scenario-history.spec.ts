import { expect, test, type Page } from "@playwright/test";
import { factory, university } from "./support/fixtures";
import { selectOrganization, navigateOrganization } from "./support/navigation";
import {
  startRuntimeWorker,
  stopRuntimeWorker,
} from "./support/runtime-worker";
import type {
  ChangePolicy,
  ChangeTargetInfo,
  Scenario,
  RunArtifact,
} from "../../src/api/types";

const screenshots =
  process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots";
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
async function createPublishedPolicy(page: Page): Promise<ChangePolicy> {
  const auth = await page.request.post("/api/v1/auth/login", {
    data: {
      username: "studio_demo_admin",
      password: process.env.BRAIN_DEMO_PASSWORD,
    },
  });
  expect(auth.status()).toBe(200);
  const { access_token } = (await auth.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const base = `/api/v1/organizations/${factory.organization.id}`;
  try {
    const meResponse = await page.request.get("/api/v1/auth/me", { headers });
    const me = (await meResponse.json()) as { id: string };
    const targetsResponse = await page.request.get(
      `${base}/model-versions/${factory.model.id}/scenario-targets`,
      { headers },
    );
    expect(targetsResponse.status()).toBe(200);
    const target = (
      (await targetsResponse.json()) as { items: ChangeTargetInfo[] }
    ).items.find(
      (t) =>
        t.target.kind === "RESOURCE_CAPACITY" &&
        t.target.parameter_id === "delivery_capacity_units",
    )!;
    expect(target.registered_owner_user_id).toBe(me.id);
    const response = await page.request.post(
      `${base}/scenario-change-policies`,
      {
        headers,
        data: {
          key: `uxf5_policy_${Date.now()}`,
          version: "1",
          name: "Politique synthétique UX-F5",
          reason:
            "Vérifier SET exact et reprise sûre sans altérer la référence",
          source_model_version_id: factory.model.id,
          expected_source_content_hash: factory.model.content_hash,
          rules: [
            {
              id: "delivery",
              target: target.target,
              operation: "SET",
              unit: target.unit,
              domain: "DECIMAL",
              minimum: "40",
              maximum: "70",
              owner_department: target.owner_department,
              owner_user_id: me.id,
              allowed_user_ids: [me.id],
              approval: "OWNER_ACK_AND_PUBLICATION",
            },
          ],
        },
      },
    );
    expect(response.status()).toBe(201);
    const policy = (await response.json()) as ChangePolicy;
    expect(policy.state).toBe("DRAFT");
    const acknowledgement = await page.request.post(
      `${base}/scenario-change-policies/${policy.id}/owner-approval`,
      { headers, data: { expected_policy_content_hash: policy.content_hash } },
    );
    expect(acknowledgement.status()).toBe(200);
    const published = await page.request.post(
      `${base}/scenario-change-policies/${policy.id}/publish`,
      { headers, data: { expected_policy_content_hash: policy.content_hash } },
    );
    expect(published.status()).toBe(200);
    return (await published.json()) as ChangePolicy;
  } finally {
    await page.request.post("/api/v1/auth/logout", { headers });
  }
}

test("UX-F5 : SET décimal exact, réponse perdue, publications distinctes et worker vérifié", async ({
  page,
}) => {
  const policy = await createPublishedPolicy(page);
  await login(page);
  await selectOrganization(page, factory.organization.id);
  await navigateOrganization(page, "Scénarios");
  await page
    .getByRole("combobox", { name: "Référence de la politique", exact: true })
    .selectOption(factory.model.id);
  await page
    .getByRole("combobox", {
      name: "Politique publiée à utiliser",
      exact: true,
    })
    .selectOption(policy.id);
  await expect(
    page.getByRole("region", { name: "Politique et délégation" }),
  ).toContainText("OWNER_ACK");
  for (const [label, value] of [
    ["Clé du scénario contrôlé", `uxf5_exact_${Date.now()}`],
    ["Version du scénario contrôlé", "1"],
    ["Nom du scénario contrôlé", "Hypothèse synthétique décimale UX-F5"],
    [
      "Justification du scénario contrôlé",
      "Valider la chaîne publiée avec un SET textuel exact",
    ],
    ["Source des hypothèses", "synthetic_ux_f5"],
    ["Valeur proposée · delivery (unit)", "45.00000000000000001"],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(value);
  const changes: { body: unknown; id: string; record: Scenario }[] = [];
  await page.route(/\/controlled-scenarios$/, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    const record = (await response.json()) as Scenario;
    changes.push({
      body: route.request().postDataJSON(),
      id: record.id,
      record,
    });
    if (changes.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Prévisualiser les changements" })
    .click();
  const preview = page.getByTestId("change-preview");
  await expect(preview).toContainText("45.00000000000000001");
  await expect(preview).toContainText("Aucun calcul");
  expect(changes).toHaveLength(0);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${screenshots}/ux-f5-exact-preview-1440.png`,
  });
  await page
    .getByRole("button", { name: "Confirmer la création contrôlée" })
    .click();
  await expect(
    page.getByRole("button", { name: "Réessayer la même création contrôlée" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Référence de la politique", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Revenir aux hypothèses" }),
  ).toBeDisabled();
  expect(changes).toHaveLength(1);
  await page
    .getByRole("button", { name: "Réessayer la même création contrôlée" })
    .click();
  await expect(page.getByTestId("scenario-detail")).toBeVisible();
  expect(changes).toHaveLength(2);
  expect(changes[1]!.body).toEqual(changes[0]!.body);
  expect(changes[1]!.id).toBe(changes[0]!.id);
  const scenario = changes[1]!.record;
  expect(scenario.model_state).toBe("DRAFT");
  if (scenario.document.kind !== "CONTROLLED_CHANGES") throw new Error("Controlled scenario expected");
  expect(scenario.document.changes[0]!.proposed_value).toBe(
    "45.00000000000000001",
  );
  expect(scenario.document.source_content_hash).toBe(
    factory.model.content_hash,
  );
  await page.getByTestId("scenario-graph-link").click();
  await page.getByRole("button", { name: "Publier cette version" }).click();
  await page
    .getByRole("button", { name: "Confirmer la publication", exact: true })
    .click();
  await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
  await page.goto(
    `/organizations/${factory.organization.id}/models/${scenario.model_version_id}`,
  );
  // Full navigation intentionally loses the in-memory session; deep link resumes after login.
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill("studio_demo_admin");
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(process.env.BRAIN_DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
  await page.getByRole("button", { name: "Publier cette version" }).click();
  await page
    .getByRole("button", { name: "Confirmer la publication", exact: true })
    .click();
  await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
  await navigateOrganization(page, "Optimisation");
  await page
    .getByRole("combobox", { name: "Modèle publié à exécuter", exact: true })
    .selectOption(scenario.model_version_id);
  await page
    .getByRole("button", { name: "Lancer l’optimisation", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Confirmer le lancement", exact: true })
    .getByRole("button", { name: "Confirmer le lancement", exact: true })
    .click();
  await expect(page.getByTestId("job-state")).toHaveText("QUEUED");
  const worker = startRuntimeWorker();
  try {
    await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED", {
      timeout: 30000,
    });
    await expect(page.getByTestId("independent-verification")).toContainText(
      "réussie",
    );
    await expect(page.getByTestId("mathematical-status")).toHaveText(
      "FEASIBLE_NOT_PROVEN_OPTIMAL",
    );
    const actual = await page.getByTestId("recorded-objective").innerText();
    expect(actual).not.toBe("Non fourni");
    console.log(
      `UX-F5 exact scenario: recorded verified objective = ${actual}`,
    );
  } finally {
    await stopRuntimeWorker(worker);
  }
});

for (const [width, role] of [
  [1440, "admin"],
  [1280, "builder"],
  [768, "approver"],
  [390, "viewer"],
] as const) {
  test(`UX-F5 ${width}px ${role} : lecture, permissions, clavier et KPI responsive`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1040 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, role);
    await selectOrganization(page, factory.organization.id);
    const writes: string[] = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (
        r.method() !== "GET" &&
        path.startsWith("/api/v1") &&
        !path.startsWith("/api/v1/auth/")
      )
        writes.push(path);
    });
    await navigateOrganization(page, "Scénarios");
    const reference = page.getByRole("combobox", {
      name: "Référence de la politique",
      exact: true,
    });
    await reference.selectOption(factory.model.id);
    await expect(
      page.getByRole("region", { name: "Contexte de la référence" }),
    ).toContainText(factory.model.data_snapshot_id!);
    for (const expert of [false, true]) {
      if (expert)
        await page.getByRole("switch", { name: "Mode expert" }).click();
      if (role === "viewer" || role === "approver")
        await expect(
          page.getByText("Créer un scénario identique (5B-1)", { exact: true }),
        ).toHaveCount(0);
      if (role === "viewer")
        await expect(
          page.getByRole("button", {
            name: /Donner mon accord de responsable|Publier la politique/,
          }),
        ).toHaveCount(0);
    }
    await page.getByRole("switch", { name: "Mode expert" }).click();
    await page.keyboard.press("Tab");
    await reference.focus();
    await expect(reference).toBeFocused();
    expect(
      await reference.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
    await page.screenshot({
      path: `${screenshots}/ux-f5-scenario-${width}.png`,
    });
    await navigateOrganization(page, "Décisions & historique");
    await expect(
      page.getByRole("heading", { name: "Les résultats conservés" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Le lancement de calcul sera disponible/),
    ).toHaveCount(0);
    await page
      .getByLabel("Rechercher un run, un modèle ou un snapshot", {
        exact: true,
      })
      .fill(factory.run.id);
    await expect(page.getByTestId("history-card")).toHaveCount(1);
    await expect(page.getByTestId("history-card")).toContainText("4100");
    await page
      .getByLabel("Résultat historique", { exact: true })
      .selectOption(factory.run.id);
    await expect(page.getByTestId("recorded-objective")).toHaveText("4100");
    const metric = page.locator(".decision-cockpit .metrics > div").first();
    await metric.scrollIntoViewIfNeeded();
    if (width === 390) {
      const card = await metric.boundingBox();
      const grid = await page
        .locator(".decision-cockpit .metrics")
        .boundingBox();
      expect(card!.width).toBeGreaterThanOrEqual(grid!.width - 2);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${screenshots}/ux-f5-history-${width}.png`,
    });
    expect(writes).toEqual([]);
  });
}

test("UX-F5 : métadonnée favorable et réponse de run non vérifiée ne produisent pas de décision", async ({
  page,
}) => {
  await login(page);
  await selectOrganization(page, factory.organization.id);
  await page.route(
    `**/organizations/${factory.organization.id}/optimization-runs/${factory.run.id}`,
    async (route) => {
      const response = await route.fetch();
      const record = (await response.json()) as RunArtifact;
      record.document.solve.validation_report = {
        valid: false,
        plan: { feasible: false },
      };
      await route.fulfill({ response, json: record });
    },
  );
  await navigateOrganization(page, "Décisions & historique");
  await page
    .getByLabel("Rechercher un run, un modèle ou un snapshot", { exact: true })
    .fill(factory.run.id);
  await expect(page.getByTestId("history-card")).toContainText("Non vérifié");
  await expect(page.locator(".history-objective")).toHaveCount(0);
  await page
    .getByLabel("Résultat historique", { exact: true })
    .selectOption(factory.run.id);
  await expect(page.getByTestId("recorded-objective")).toHaveText("Non fourni");
  await expect(
    page.getByRole("heading", { name: "Variables de décision vérifiées" }),
  ).toHaveCount(0);
});

test("UX-F5 : réponses de résumés tardives après changement de tenant ignorées", async ({
  page,
}) => {
  await login(page);
  await selectOrganization(page, factory.organization.id);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    new RegExp(
      `/organizations/${factory.organization.id}/optimization-runs/[^/]+$`,
    ),
    async (route) => {
      const response = await route.fetch();
      await barrier;
      try {
        await route.fulfill({ response });
      } catch {
        /* previous tenant request aborted */
      }
    },
  );
  await navigateOrganization(page, "Décisions & historique");
  await expect(
    page.getByLabel("Résultat historique", { exact: true }),
  ).toBeVisible();
  await selectOrganization(page, university.organization.id);
  release();
  await navigateOrganization(page, "Décisions & historique");
  await page
    .getByLabel("Résultat historique", { exact: true })
    .selectOption(university.run.id);
  await expect(page.getByTestId("recorded-objective")).toHaveText("17");
  await expect(page.locator(".history-v2")).not.toContainText(
    factory.organization.id,
  );
});
