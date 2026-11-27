import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { factory, university } from "./support/fixtures";
import { selectOrganization, navigateOrganization } from "./support/navigation";
import {
  startRuntimeWorker,
  stopRuntimeWorker,
} from "./support/runtime-worker";
import { syntheticExecutionSource } from "./support/synthetic-execution";
import type {
  ChangePolicy,
  ChangeTargetInfo,
  Scenario,
  OptimizationJob,
  ScenarioComparison,
} from "../../src/api/types";

const screenshots =
  process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots";
const runs = new Map<string, string>();
let worker: ChildProcess | undefined;

async function controlledModel(
  api: APIRequestContext,
  headers: Record<string, string>,
  user: string,
  fixture: typeof factory | typeof university,
  sector: string,
  parameter: string,
  value: string,
  low: string,
  high: string,
) {
  const base = `/api/v1/organizations/${fixture.organization.id}`;
  const targets = await api.get(
    `${base}/model-versions/${fixture.model.id}/scenario-targets`,
    { headers },
  );
  expect(targets.status()).toBe(200);
  const target = (
    (await targets.json()) as { items: ChangeTargetInfo[] }
  ).items.find(
    (t) =>
      t.target.kind === "RESOURCE_CAPACITY" &&
      t.target.parameter_id === parameter,
  )!;
  expect(target.registered_owner_user_id).toBe(user);
  const suffix = randomUUID().replaceAll("-", "");
  const created = await api.post(`${base}/scenario-change-policies`, {
    headers,
    data: {
      key: `comparison_${sector}_${suffix}`,
      version: "1",
      name: `Synthetic comparison ${sector}`,
      reason: "Explicit synthetic comparison acceptance",
      source_model_version_id: fixture.model.id,
      expected_source_content_hash: fixture.model.content_hash,
      rules: [
        {
          id: "capacity",
          target: target.target,
          operation: "SET",
          unit: target.unit,
          domain: "INTEGER",
          minimum: low,
          maximum: high,
          owner_department: target.owner_department,
          owner_user_id: user,
          allowed_user_ids: [user],
          approval: "OWNER_ACK_AND_PUBLICATION",
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const policy = (await created.json()) as ChangePolicy;
  const expected = { expected_policy_content_hash: policy.content_hash };
  expect(
    (
      await api.post(
        `${base}/scenario-change-policies/${policy.id}/owner-approval`,
        { headers, data: expected },
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.post(`${base}/scenario-change-policies/${policy.id}/publish`, {
        headers,
        data: expected,
      })
    ).status(),
  ).toBe(200);
  const proposal = {
    key: `comparison_${suffix}`,
    version: "1",
    name: `Comparison ${sector}`,
    reason: "Isolated synthetic hypothesis",
    source_model_version_id: fixture.model.id,
    expected_source_content_hash: fixture.model.content_hash,
    policy_version_id: policy.id,
    expected_policy_content_hash: policy.content_hash,
    changes: [
      {
        rule_id: "capacity",
        operation: "SET",
        unit: target.unit,
        value,
        source: "synthetic_comparison_acceptance",
      },
    ],
  };
  const preview = await api.post(`${base}/controlled-scenarios/preview`, {
    headers,
    data: proposal,
  });
  expect(preview.status()).toBe(200);
  const confirmed = await api.post(`${base}/controlled-scenarios`, {
    headers,
    data: {
      proposal,
      expected_preview_hash: (
        (await preview.json()) as { preview_hash: string }
      ).preview_hash,
    },
  });
  expect(confirmed.status()).toBe(201);
  const scenario = (await confirmed.json()) as Scenario;
  if (scenario.document.kind !== "CONTROLLED_CHANGES")
    throw new Error("Controlled artifact required");
  expect(scenario.model_state).toBe("DRAFT");
  expect(
    (
      await api.post(
        `${base}/graphs/${scenario.document.graph_snapshot_id}/publish`,
        { headers },
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.post(
        `${base}/model-versions/${scenario.model_version_id}/publish`,
        { headers },
      )
    ).status(),
  ).toBe(200);
  return scenario.model_version_id;
}

test.beforeAll(async ({ request }) => {
  if (!process.env.BRAIN_DEMO_PASSWORD)
    throw new Error("Synthetic password required");
  const auth = await request.post("/api/v1/auth/login", {
    data: {
      username: "studio_demo_admin",
      password: process.env.BRAIN_DEMO_PASSWORD,
    },
  });
  expect(auth.status()).toBe(200);
  const headers = {
    Authorization: `Bearer ${((await auth.json()) as { access_token: string }).access_token}`,
  };
  try {
    const me = (await (
      await request.get("/api/v1/auth/me", { headers })
    ).json()) as { id: string };
    const models: {
      key: string;
      org: string;
      id: string;
      settings?: object;
    }[] = [];
    for (const [key, fixture, parameter, value, low, high] of [
      ["factory", factory, "delivery_capacity_units", "45", "40", "70"],
      ["university", university, "room_slots", "1", "1", "4"],
    ] as const) {
      models.push({
        key,
        org: fixture.organization.id,
        id: await controlledModel(
          request,
          headers,
          me.id,
          fixture,
          key,
          parameter,
          value,
          low,
          high,
        ),
      });
    }
    for (const kind of ["infeasible", "limits"] as const) {
      const source = syntheticExecutionSource(kind);
      const base = `/api/v1/organizations/${factory.organization.id}/model-versions`;
      const created = await request.post(base, {
        headers,
        data: {
          graph_snapshot_id: factory.model.graph_snapshot_id,
          model: source,
        },
      });
      expect(created.status()).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect(
        (await request.post(`${base}/${id}/publish`, { headers })).status(),
      ).toBe(200);
      models.push({
        key: kind,
        org: factory.organization.id,
        id,
        settings:
          kind === "limits"
            ? { time_limit_seconds: 0.000001, presolve: false }
            : {},
      });
    }
    const jobs: { key: string; org: string; id: string }[] = [];
    for (const model of models) {
      const response = await request.post(
        `/api/v1/organizations/${model.org}/model-versions/${model.id}/optimization-jobs`,
        {
          headers: { ...headers, "Idempotency-Key": randomUUID() },
          data: { settings: model.settings || {} },
        },
      );
      expect(response.status()).toBe(202);
      const job = (await response.json()) as OptimizationJob;
      expect(job.state).toBe("QUEUED");
      jobs.push({ key: model.key, org: model.org, id: job.id });
    }
    worker = startRuntimeWorker();
    for (const job of jobs) {
      let recorded: OptimizationJob | undefined;
      await expect
        .poll(
          async () => {
            const response = await request.get(
              `/api/v1/organizations/${job.org}/optimization-jobs/${job.id}`,
              { headers },
            );
            expect(response.status()).toBe(200);
            recorded = (await response.json()) as OptimizationJob;
            return recorded.state;
          },
          { timeout: 30000 },
        )
        .toBe("SUCCEEDED");
      expect(recorded?.run_id).toBeTruthy();
      runs.set(job.key, recorded!.run_id!);
    }
    for (const fixture of [factory, university]) {
      const stored = await request.get(
        `/api/v1/organizations/${fixture.organization.id}/model-versions/${fixture.model.id}`,
        { headers },
      );
      expect(
        ((await stored.json()) as { content_hash: string }).content_hash,
      ).toBe(fixture.model.content_hash);
    }
  } finally {
    await request.post("/api/v1/auth/logout", { headers });
  }
});
test.afterAll(async () => {
  if (worker) await stopRuntimeWorker(worker);
});

async function login(page: Page, role = "admin") {
  await page.goto("/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(`studio_demo_${role}`);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(process.env.BRAIN_DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
}
async function open(page: Page, org: string) {
  await selectOrganization(page, org);
  await navigateOrganization(page, "Décisions & historique");
  await page
    .getByRole("link", {
      name: "Comparer deux résultats enregistrés",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Comparer deux résultats enregistrés",
      exact: true,
    }),
  ).toBeVisible();
}
async function choose(page: Page, baseline: string, candidate: string) {
  await page
    .getByLabel("Run de référence", { exact: true })
    .selectOption(baseline);
  await page
    .getByLabel("Run de scénario candidat", { exact: true })
    .selectOption(candidate);
  await page
    .getByRole("button", { name: "Vérifier la comparaison", exact: true })
    .click();
}

for (const [key, fixture, candidate, delta] of [
  ["factory", factory, "3500", "-600"],
  ["university", university, "10", "-7"],
] as const) {
  test(`${key}: comparaison réelle de deux plans vérifiés sans gain économique fabriqué`, async ({
    page,
  }) => {
    await login(page);
    await open(page, fixture.organization.id);
    const writes: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() !== "GET" &&
        new URL(r.url()).pathname.startsWith("/api/v1/organizations/")
      )
        writes.push(r.url());
    });
    const response = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith("/scenario-comparisons"),
    );
    await choose(page, fixture.run.id, runs.get(key)!);
    const report = (await (await response).json()) as ScenarioComparison;
    expect(report.baseline?.verified_plan).toBe(true);
    expect(report.candidate?.verified_plan).toBe(true);
    expect(report.comparability).toBe("QUALIFIED");
    expect(report.objective_improvement).toBeNull();
    expect(report.economic_gain).toBeNull();
    await expect(
      page.getByTestId("comparison-baseline-objective"),
    ).toContainText(String(fixture.run.document.solve.objective_value));
    await expect(
      page.getByTestId("comparison-candidate-objective"),
    ).toContainText(candidate);
    await expect(page.getByTestId("comparison-observed-delta")).toContainText(
      delta,
    );
    await expect(page.getByTestId("comparison-message")).toHaveText(
      "Écart observé entre scénarios — gain non démontré.",
    );
    await page
      .getByRole("heading", { name: "Qualification de la comparaison" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${screenshots}/5b3-${key}-comparison-1440.png`,
    });
    expect(writes).toEqual([]);
  });
}

for (const [width, role] of [
  [1440, "admin"],
  [1280, "builder"],
  [768, "approver"],
  [390, "viewer"],
] as const) {
  test(`comparaison ${width}px ${role}: lecture, clavier, mode expert et aucune écriture`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1040 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, role);
    await open(page, factory.organization.id);
    const writes: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() !== "GET" &&
        new URL(r.url()).pathname.startsWith("/api/v1/organizations/")
      )
        writes.push(r.url());
    });
    await choose(page, factory.run.id, runs.get("factory")!);
    await expect(page.getByTestId("comparison-observed-delta")).toContainText(
      "-600",
    );
    await page.keyboard.press("Tab");
    const table = page.getByRole("region", {
      name: "Décisions des plans vérifiés",
      exact: true,
    });
    await table.focus();
    await expect(table).toBeFocused();
    expect(
      await table.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("heading", { name: "Qualification de la comparaison" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${screenshots}/5b3-comparison-${width}.png`,
    });
    await page.getByRole("switch", { name: "Mode expert" }).click();
    await page
      .getByText("Provenance et vérification · Candidat", { exact: true })
      .click();
    await expect(page.locator(".scenario-comparison")).toContainText(
      "best_bound",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(writes).toEqual([]);
  });
}

for (const [key, expected] of [
  ["infeasible", "INFEASIBLE"],
  ["limits", "TIME_LIMIT_NO_SOLUTION"],
] as const) {
  test(`comparaison refuse un plan absent ${expected} réellement enregistré`, async ({
    page,
  }) => {
    await login(page);
    await open(page, factory.organization.id);
    await choose(page, factory.run.id, runs.get(key)!);
    await expect(page.getByTestId("scenario-comparison-result")).toContainText(
      expected,
    );
    await expect(page.getByTestId("comparison-candidate-objective")).toHaveText(
      "Non fourni",
    );
    await expect(page.getByTestId("comparison-observed-delta")).toHaveText(
      "Non fourni",
    );
  });
}

test("comparaison tardive après changement de tenant sans fuite d’artefact", async ({
  page,
}) => {
  await login(page);
  await open(page, factory.organization.id);
  let release!: () => void, started!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetched = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    `**/organizations/${factory.organization.id}/scenario-comparisons?*`,
    async (route) => {
      const response = await route.fetch();
      started();
      await barrier;
      try {
        await route.fulfill({ response });
      } catch {
        /* previous request aborted */
      }
    },
  );
  await choose(page, factory.run.id, runs.get("factory")!);
  await fetched;
  await selectOrganization(page, university.organization.id);
  release();
  await navigateOrganization(page, "Décisions & historique");
  await page
    .getByRole("link", {
      name: "Comparer deux résultats enregistrés",
      exact: true,
    })
    .click();
  await choose(page, university.run.id, runs.get("university")!);
  await expect(page.getByTestId("comparison-observed-delta")).toContainText(
    "-7",
  );
  await expect(page.locator(".scenario-comparison")).not.toContainText(
    factory.organization.id,
  );
});

test("conflit historique affiché sans corps sensible puis répétition explicite", async ({
  page,
}) => {
  await login(page);
  await open(page, factory.organization.id);
  let first = true;
  await page.route("**/scenario-comparisons?*", async (route) => {
    if (first) {
      first = false;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "private_comparison_canary" }),
      });
    } else await route.continue();
  });
  await choose(page, factory.run.id, runs.get("factory")!);
  await expect(page.locator(".scenario-comparison")).toContainText("intégrité");
  await expect(page.locator(".scenario-comparison")).not.toContainText(
    "private_comparison_canary",
  );
  await expect(page.getByTestId("scenario-comparison-result")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Réessayer cette comparaison" })
    .click();
  await expect(page.getByTestId("comparison-observed-delta")).toContainText(
    "-600",
  );
});
