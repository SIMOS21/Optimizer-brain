// Read-only production Studio timings; no policy, scenario or job creation.
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const stage = process.argv[2];
if (
  !["before", "after"].includes(stage) ||
  process.env.STUDIO_E2E !== "1" ||
  new URL(process.env.BRAIN_DATABASE_URL).pathname !== "/optimizer_brain_e2e" ||
  process.env.STUDIO_BASE_URL !== "http://127.0.0.1:5181"
)
  throw new Error("Isolated E2E measurement required");
const output = join(root, ".local/ux-f5", stage);
await mkdir(output, { recursive: true });
const fixtures = await Promise.all(
  ["factory", "university"].map(async (sector) => ({
    sector,
    ...JSON.parse(
      await readFile(
        join(process.env.STUDIO_E2E_FIXTURES_DIR, `${sector}.json`),
        "utf8",
      ),
    ),
  })),
);
const baseline =
  stage === "after"
    ? JSON.parse(
        await readFile(
          join(root, ".local/ux-f5/before/measurements.json"),
          "utf8",
        ),
      )
    : undefined;
const identities = [];
const samples = [];
const browser = await chromium.launch({ headless: true });
async function navigate(page, name) {
  const trigger = page.getByRole("button", {
    name: "Ouvrir le menu",
    exact: true,
  });
  if (await trigger.isVisible()) {
    await trigger.click();
    await page
      .getByRole("dialog", { name: "Navigation de l’organisation" })
      .getByRole("link", { name, exact: true })
      .click();
  } else await page.getByRole("link", { name, exact: true }).click();
}
try {
  for (const fixture of fixtures)
    for (const width of [1440, 1280, 768, 390])
      for (let repeat = 0; repeat < 3; repeat++) {
        const context = await browser.newContext({
          baseURL: process.env.STUDIO_BASE_URL,
          viewport: { width, height: 1040 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        let requests = 0;
        const mutations = [];
        page.on("request", (r) => {
          const path = new URL(r.url()).pathname;
          if (path.startsWith("/api/v1")) requests++;
          if (
            r.method() !== "GET" &&
            path.startsWith("/api/v1") &&
            !path.startsWith("/api/v1/auth/")
          )
            mutations.push(path);
        });
        await page.goto(process.env.STUDIO_BASE_URL);
        await page
          .getByLabel("Identifiant", { exact: true })
          .fill("studio_demo_admin");
        await page
          .getByLabel("Mot de passe", { exact: true })
          .fill(process.env.BRAIN_DEMO_PASSWORD);
        const login = page.waitForResponse((r) =>
          new URL(r.url()).pathname.endsWith("/auth/login"),
        );
        const me = page.waitForResponse((r) =>
          new URL(r.url()).pathname.endsWith("/auth/me"),
        );
        await page
          .getByRole("button", { name: "Accéder au workspace" })
          .click();
        const { access_token } = await (await login).json();
        const user = await (await me).json();
        const policiesResponse = await page.request.get(
          `/api/v1/organizations/${fixture.organization.id}/scenario-change-policies?limit=50&offset=0`,
          { headers: { Authorization: `Bearer ${access_token}` } },
        );
        if (!policiesResponse.ok())
          throw new Error("Authorized policy read failed");
        const policies = (await policiesResponse.json()).items;
        const pinned = baseline?.identities.find(
          (i) => i.sector === fixture.sector,
        );
        const policy = policies.find(
          (p) =>
            p.state === "PUBLISHED" &&
            p.usable &&
            p.document.source_model_version_id === fixture.model.id &&
            p.document.rules.some((r) =>
              r.allowed_user_ids.includes(user.id),
            ) &&
            (!pinned || p.id === pinned.policy),
        );
        if (!policy)
          throw new Error("A real published delegated E2E policy is required");
        if (width === 1440 && repeat === 0)
          identities.push({
            sector: fixture.sector,
            model: fixture.model.id,
            modelHash: fixture.model.content_hash,
            run: fixture.run.id,
            runHash: fixture.run.content_hash,
            policy: policy.id,
            policyHash: policy.content_hash,
          });
        await page
          .locator(
            `#main-content a[href="/organizations/${fixture.organization.id}"]`,
          )
          .click();
        await page.getByTestId("active-organization").waitFor();
        let start = performance.now(),
          count = requests;
        await navigate(page, "Scénarios");
        await page
          .getByRole("heading", {
            name: `${policy.document.name} · ${policy.key} / ${policy.version}`,
            exact: true,
          })
          .waitFor();
        const scenarioMs = performance.now() - start,
          scenarioRequests = requests - count;
        const source = page.getByRole("combobox", {
          name: "Référence de la politique",
          exact: true,
        });
        if (!(await source.isVisible()))
          await page
            .getByText("Nouvelle politique de changement", { exact: true })
            .click();
        await source.selectOption(fixture.model.id);
        start = performance.now();
        count = requests;
        await page
          .getByRole("combobox", {
            name: "Politique publiée à utiliser",
            exact: true,
          })
          .selectOption(policy.id);
        await page
          .getByTestId("controlled-form")
          .getByRole("heading", {
            name: "Créer un scénario sous politique",
            exact: true,
          })
          .waitFor();
        const formMs = performance.now() - start,
          formRequests = requests - count;
        await page.getByTestId("controlled-form").scrollIntoViewIfNeeded();
        if (repeat === 0)
          await page.screenshot({
            path: join(output, `${fixture.sector}-scenario-${width}.png`),
          });
        start = performance.now();
        count = requests;
        await navigate(page, "Décisions & historique");
        await page.getByLabel("Résultat historique", { exact: true }).waitFor();
        const historyMs = performance.now() - start,
          historyRequests = requests - count;
        if (stage === "after" && repeat === 0) {
          await page.getByTestId("history-card").first().waitFor();
          await page.screenshot({
            path: join(output, `${fixture.sector}-history-overview-${width}.png`),
          });
        }
        start = performance.now();
        count = requests;
        await page
          .getByLabel("Résultat historique", { exact: true })
          .selectOption(fixture.run.id);
        await page
          .getByTestId("recorded-objective")
          .filter({
            hasText: String(fixture.run.document.solve.objective_value),
          })
          .waitFor();
        const resultMs = performance.now() - start,
          resultRequests = requests - count;
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        await page.getByTestId("recorded-objective").scrollIntoViewIfNeeded();
        if (repeat === 0)
          await page.screenshot({
            path: join(output, `${fixture.sector}-history-${width}.png`),
          });
        if (mutations.length)
          throw new Error("Measurement caused a domain mutation");
        samples.push({
          sector: fixture.sector,
          width,
          repeat,
          scenarioMs,
          scenarioRequests,
          formMs,
          formRequests,
          historyMs,
          historyRequests,
          resultMs,
          resultRequests,
          overflow,
        });
        await page
          .getByRole("button", { name: "Déconnexion", exact: true })
          .click();
        await context.close();
      }
  if (
    baseline &&
    JSON.stringify(identities) !== JSON.stringify(baseline.identities)
  )
    throw new Error("Immutable references differ");
  await writeFile(
    join(output, "measurements.json"),
    JSON.stringify(
      {
        stage,
        browser: browser.version(),
        node: process.version,
        protocol:
          "Production preview; 3 fresh contexts per sector/width; UI and network latency including automation, no solver time or INP; no domain mutations",
        identities,
        samples,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ stage, samples: samples.length, domainMutations: 0 }),
  );
} finally {
  await browser.close();
}
