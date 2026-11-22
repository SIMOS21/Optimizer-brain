import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import factory from "../fixtures/factory.json" with { type: "json" };
import university from "../fixtures/university.json" with { type: "json" };
import type { ModelSource } from "../../src/api/types";

const root = fileURLToPath(new URL("../../../", import.meta.url));
function startWorker(extra: Record<string, string> = {}): ChildProcess {
  if (!process.env.BRAIN_DATABASE_URL)
    throw new Error(
      "BRAIN_DATABASE_URL runtime requis pour les parcours avec worker réel.",
    );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      [
        "PATH",
        "Path",
        "SYSTEMROOT",
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "HOME",
        "LANG",
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "PYTHONPATH",
        "VIRTUAL_ENV",
        "BRAIN_DATABASE_URL",
      ].includes(key),
    ),
  );
  return spawn(
    process.env.STUDIO_PYTHON || "python",
    ["-m", "brain.platform.worker"],
    {
      cwd: root,
      env: { ...env, ...extra },
      stdio: "ignore",
      windowsHide: true,
    },
  );
}
async function stopWorker(worker: ChildProcess) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  const exited = once(worker, "exit");
  worker.kill("SIGTERM");
  await exited;
}
async function login(page: Page, role = "admin", visit = true) {
  const password = process.env.BRAIN_DEMO_PASSWORD;
  if (!password)
    throw new Error(
      "BRAIN_DEMO_PASSWORD requis ; aucun secret dans les fixtures.",
    );
  if (visit) await page.goto("/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(`studio_demo_${role}`);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Accéder au workspace" }).click();
}
async function selectModel(
  page: Page,
  fixture: typeof factory | typeof university,
  modelId = fixture.model.id,
) {
  await page
    .getByRole("combobox", { name: "Organisation", exact: true })
    .selectOption(fixture.organization.id);
  await page
    .getByRole("link", { name: "Optimization Center", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Modèle publié à exécuter", exact: true })
    .selectOption(modelId);
  await expect(
    page.getByRole("heading", { name: "Configurer la résolution" }),
  ).toBeVisible();
}
async function launch(page: Page) {
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /model-versions\/[^/]+\/optimization-jobs$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page
    .getByRole("button", { name: "Lancer l’optimisation", exact: true })
    .click();
  const response = await sent;
  expect(response.status()).toBe(202);
  const job = (await response.json()) as {
    id: string;
    organization_id: string;
  };
  await expect(page).toHaveURL(new RegExp(`/execution/${job.id}$`));
  return job;
}
async function publishSyntheticCase(page: Page, kind: "infeasible" | "limits") {
  const auth = await page.request.post("/api/v1/auth/login", {
    data: {
      username: "studio_demo_admin",
      password: process.env.BRAIN_DEMO_PASSWORD,
    },
  });
  expect(auth.status()).toBe(200);
  const { access_token } = (await auth.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  try {
    // Trusted fixture from the real API; every newly constructed input below
    // is validated/compiled again by the secured API before publication.
    const source = structuredClone(
      factory.model.document.organization_model,
    ) as ModelSource;
    const version = `execution_${Date.now()}`;
    source.model_id = `synthetic_execution_${kind}`;
    source.model_name = `Synthetic execution acceptance: ${kind}`;
    source.model_version = version;
    for (const fragment of source.fragments) {
      fragment.version = version;
      for (const ref of fragment.variable_refs ?? [])
        ref.declaration_version = version;
    }
    const sales = source.fragments.find(
      (fragment) => fragment.department_id === "sales",
    )!;
    sales.constraints ??= [];
    if (kind === "infeasible") {
      sales.constraints.push({
        id: "synthetic_impossible_minimum",
        owner_department: "sales",
        kind: "HARD",
        source: "synthetic_execution_acceptance",
        approved: true,
        version,
        terms: [
          {
            variable: "qty_A",
            coefficient: "1",
            coefficient_unit: "unit/unit",
          },
        ],
        operator: ">=",
        rhs: "41",
        unit: "unit",
      });
    } else {
      // Explicit synthetic MILP data, never inferred from business results.
      const finance = source.fragments.find(
        (fragment) => fragment.department_id === "finance",
      )!;
      sales.variables ??= [];
      finance.variable_refs ??= [];
      for (let index = 0; index < 300; index += 1) {
        const id = `synthetic_choice_${index}`;
        sales.variables.push({
          id,
          type: "BINARY",
          lb: "0",
          ub: "1",
          unit: "1",
          department: "sales",
        });
        finance.variable_refs.push({
          variable: id,
          owner_department: "sales",
          declaration_version: version,
          unit: "1",
        });
        source.objective.terms.push({
          variable: id,
          coefficient: String(((index * 19 + 7) % 97) + 1),
          coefficient_unit: "EUR",
        });
      }
      for (let row = 0; row < 15; row += 1) {
        sales.constraints.push({
          id: `synthetic_capacity_${row}`,
          owner_department: "sales",
          kind: "HARD",
          source: "synthetic_execution_acceptance",
          approved: true,
          version,
          terms: Array.from({ length: 300 }, (_, index) => ({
            variable: `synthetic_choice_${index}`,
            coefficient: String(
              ((index * (row * 2 + 31) + row * 13) % 101) + 1,
            ),
            coefficient_unit: "1",
          })),
          operator: "<=",
          rhs: "7000",
          unit: "1",
        });
      }
    }
    const base = `/api/v1/organizations/${factory.organization.id}/model-versions`;
    const created = await page.request.post(base, {
      headers,
      data: {
        graph_snapshot_id: factory.model.graph_snapshot_id,
        model: source,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const model = (await created.json()) as { id: string };
    expect(
      (
        await page.request.post(`${base}/${model.id}/publish`, { headers })
      ).status(),
    ).toBe(200);
    return model.id;
  } finally {
    await page.request.post("/api/v1/auth/logout", { headers });
  }
}
for (const [name, fixture, objective] of [
  ["factory", factory, "4100"],
  ["university", university, "17"],
] as const) {
  test(`${name}: lancement → worker réel → décision vérifiée → run immuable`, async ({
    page,
  }) => {
    await login(page);
    await selectModel(page, fixture);
    const worker = startWorker();
    try {
      const submitted = await launch(page);
      await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED", {
        timeout: 30000,
      });
      await expect(page.getByTestId("recorded-objective")).toHaveText(
        objective,
      );
      await expect(page.getByTestId("independent-verification")).toContainText(
        "réussie",
      );
      await page
        .getByRole("button", { name: "Consulter les diagnostics" })
        .click();
      await expect(page.getByTestId("constraint-diagnostics")).toContainText(
        "Plan contrôlé indépendamment selon les tolérances enregistrées.",
      );
      await expect(
        page.getByRole("heading", {
          name: "Contraintes et marges enregistrées",
        }),
      ).toBeVisible();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      const historical = page.locator(
        `a[href^="/organizations/${fixture.organization.id}/history/"]`,
      );
      const url = await historical.getAttribute("href");
      await historical.click();
      await expect(page.getByTestId("recorded-objective")).toHaveText(
        objective,
      );
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Se connecter au Studio" }),
      ).toBeVisible();
      await login(page, "admin", false);
      await expect(page).toHaveURL(
        new RegExp(url!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
      );
      await expect(page.getByTestId("recorded-objective")).toHaveText(
        objective,
      );
      await page
        .getByRole("link", { name: "Optimization Center", exact: true })
        .click();
      await page.getByRole("link", { name: submitted.id, exact: true }).click();
      await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED");
      const directory =
        process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots";
      await page.screenshot({
        path: `${directory}/execution-${name}.png`,
        fullPage: true,
      });
      if (name === "factory") {
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(391);
        await page.screenshot({
          path: `${directory}/execution-mobile.png`,
          fullPage: true,
        });
        await page.setViewportSize({ width: 1440, height: 1040 });
        await page
          .getByRole("combobox", { name: "Organisation", exact: true })
          .selectOption(university.organization.id);
        await expect(page.getByTestId("job-state")).toHaveCount(0);
        await expect(page.getByTestId("recorded-objective")).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: submitted.id, exact: true }),
        ).toHaveCount(0);
      }
    } finally {
      await stopWorker(worker);
    }
  });
}
test("annulation demandée en file puis confirmée par le worker réel", async ({
  page,
}) => {
  await login(page);
  await selectModel(page, factory);
  await launch(page);
  await expect(page.getByTestId("job-state")).toHaveText("QUEUED");
  await page
    .getByRole("button", { name: "Demander l’annulation", exact: true })
    .click();
  await expect(
    page.getByText(
      "Annulation demandée — arrêt non encore confirmé par le serveur.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("job-state")).toHaveText("QUEUED");
  const worker = startWorker();
  try {
    await expect(page.getByTestId("job-state")).toHaveText("CANCELLED", {
      timeout: 20000,
    });
    await expect(page.getByTestId("recorded-objective")).toHaveCount(0);
  } finally {
    await stopWorker(worker);
  }
});
test("échec réel du plafond d’exécution sans faux résultat mathématique", async ({
  page,
}) => {
  await login(page);
  await selectModel(page, factory);
  await page.getByLabel("Temps limite (secondes)").fill("0.001");
  await launch(page);
  const worker = startWorker({
    BRAIN_JOB_HARD_TIMEOUT_GRACE_SECONDS: "0.1",
    BRAIN_JOB_TERMINATION_GRACE_SECONDS: "0.1",
    BRAIN_JOB_POLL_SECONDS: "0.05",
  });
  try {
    await expect(page.getByTestId("job-state")).toHaveText("FAILED", {
      timeout: 20000,
    });
    await expect(
      page.getByText(/Le plafond d’exécution du processus a été atteint/),
    ).toBeVisible();
    await expect(page.getByTestId("job-solver-status")).toHaveText(
      "Non disponible",
    );
    await expect(page.getByTestId("recorded-objective")).toHaveCount(0);
  } finally {
    await stopWorker(worker);
  }
});
test("VIEWER consulte les jobs et ne peut ni lancer ni annuler", async ({
  page,
}) => {
  await login(page, "viewer");
  await selectModel(page, factory);
  await expect(
    page.getByRole("button", { name: "Lancer l’optimisation", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Demander l’annulation", exact: true }),
  ).toHaveCount(0);
});
test("INFEASIBLE réel conserve un run sans inventer de plan", async ({
  page,
}) => {
  const modelId = await publishSyntheticCase(page, "infeasible");
  await login(page);
  await selectModel(page, factory, modelId);
  await launch(page);
  const worker = startWorker();
  try {
    await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED", {
      timeout: 30000,
    });
    await expect(page.getByTestId("mathematical-status")).toHaveText(
      "INFEASIBLE",
    );
    await page
      .getByRole("button", { name: "Consulter les diagnostics" })
      .click();
    await expect(page.getByTestId("static-conclusion")).toContainText(
      "Contradiction démontrée",
    );
    await expect(page.getByTestId("constraint-diagnostics")).toContainText(
      "Aucun plan à contrôler",
    );
    await expect(page.getByTestId("independent-verification")).toContainText(
      "Aucun plan vérifié",
    );
    await expect(page.getByTestId("recorded-objective")).toHaveText(
      "Non fourni",
    );
  } finally {
    await stopWorker(worker);
  }
});
test("TIME_LIMIT réel est distinct d’un échec technique du worker", async ({
  page,
}) => {
  const modelId = await publishSyntheticCase(page, "limits");
  await login(page);
  await selectModel(page, factory, modelId);
  await page.getByLabel("Temps limite (secondes)").fill("0.000001");
  await page.getByLabel("Activer le presolve").uncheck();
  await launch(page);
  const worker = startWorker();
  try {
    await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED", {
      timeout: 30000,
    });
    await expect(
      page.getByText(/TIME_LIMIT — résolution interrompue/),
    ).toBeVisible();
    await expect(page.getByTestId("mathematical-status")).toHaveText(
      "TIME_LIMIT_NO_SOLUTION",
    );
    await page
      .getByRole("button", { name: "Consulter les diagnostics" })
      .click();
    await expect(page.getByTestId("static-conclusion")).toContainText(
      "non concluante",
    );
    await expect(page.getByTestId("constraint-diagnostics")).toContainText(
      "Aucun plan à contrôler",
    );
    await expect(page.getByTestId("recorded-objective")).toHaveText(
      "Non fourni",
    );
  } finally {
    await stopWorker(worker);
  }
});
test("demande d’annulation RUNNING et course avec une éventuelle réussite", async ({
  page,
}) => {
  const modelId = await publishSyntheticCase(page, "limits");
  await login(page);
  await selectModel(page, factory, modelId);
  await page.getByLabel("Temps limite (secondes)").fill("300");
  await page.getByLabel("Activer le presolve").uncheck();
  await launch(page);
  const worker = startWorker();
  try {
    await expect(page.getByTestId("job-state")).toHaveText(
      /RUNNING|SUCCEEDED/,
      { timeout: 30000 },
    );
    const cancel = page.getByRole("button", {
      name: "Demander l’annulation",
      exact: true,
    });
    try {
      if (await cancel.isVisible()) await cancel.click({ timeout: 2000 });
    } catch (error) {
      // The server may finish between visibility and click; only an observed
      // success permits this race, never an invented cancellation.
      if ((await page.getByTestId("job-state").textContent()) !== "SUCCEEDED")
        throw error;
    }
    await expect(page.getByTestId("job-state")).toHaveText(
      /CANCELLED|SUCCEEDED/,
      { timeout: 30000 },
    );
    if ((await page.getByTestId("job-state").textContent()) === "CANCELLED")
      await expect(page.getByTestId("recorded-objective")).toHaveCount(0);
    else
      await expect(page.getByTestId("independent-verification")).toContainText(
        "réussie",
      );
  } finally {
    await stopWorker(worker);
  }
});

test("réponse POST perdue puis répétition idempotente, sans deuxième job", async ({
  page,
}) => {
  await login(page, "builder");
  await selectModel(page, factory);
  const ids: string[] = [];
  const keys: string[] = [];
  await page.route(
    /\/model-versions\/[^/]+\/optimization-jobs$/,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      ids.push(((await response.json()) as { id: string }).id);
      keys.push(route.request().headers()["idempotency-key"]!);
      if (ids.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await page
    .getByRole("button", { name: "Lancer l’optimisation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Réessayer la même demande" }),
  ).toBeVisible();
  await expect(page.getByLabel("Temps limite (secondes)")).toBeDisabled();
  await page.getByRole("button", { name: "Réessayer la même demande" }).click();
  await expect(page.getByTestId("job-state")).toHaveText("QUEUED");
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  expect(keys[1]).toBe(keys[0]);
  const worker = startWorker();
  try {
    await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED", {
      timeout: 30000,
    });
  } finally {
    await stopWorker(worker);
  }
});

for (const status of [401, 403, 404, 409, 422]) {
  test(`soumission : erreur HTTP ${status} sans fuite ni retry automatique`, async ({
    page,
  }) => {
    await login(page);
    await selectModel(page, factory);
    let requests = 0;
    await page.route(
      /\/model-versions\/[^/]+\/optimization-jobs$/,
      async (route) => {
        requests += 1;
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ detail: "sensitive-test-marker" }),
        });
      },
    );
    await page
      .getByRole("button", { name: "Lancer l’optimisation", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("sensitive-test-marker")).toHaveCount(0);
    if (status === 401)
      await expect(
        page.getByRole("heading", { name: "Se connecter au Studio" }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("button", {
          name: "Lancer l’optimisation",
          exact: true,
        }),
      ).toBeEnabled();
    expect(requests).toBe(1);
  });
}
