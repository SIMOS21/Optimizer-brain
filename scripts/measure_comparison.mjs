// Read-only timings of the new comparison journey, on stored synthetic E2E runs.
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
let databasePath;
try {
  databasePath = new URL(process.env.BRAIN_DATABASE_URL).pathname;
} catch {
  throw new Error("Dedicated E2E configuration required");
}
if (
  process.env.STUDIO_E2E !== "1" ||
  databasePath !== "/optimizer_brain_e2e" ||
  process.env.STUDIO_BASE_URL !== "http://127.0.0.1:5181"
)
  throw new Error("Dedicated E2E measurement required");
const output = join(root, ".local/5b3/measurement");
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
const samples = [],
  pairs = {};
const browser = await chromium.launch({ headless: true });
async function get(page, path, token) {
  const response = await page.request.get(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) throw new Error("Stored comparison evidence unavailable");
  return response.json();
}
async function collection(page, base, token) {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const response = await get(
      page,
      `${base}?limit=100&offset=${offset}`,
      token,
    );
    all.push(...response.items);
    if (response.items.length < 100) return all;
  }
}
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
        const mutations = [];
        let reads = 0;
        page.on("request", (r) => {
          const path = new URL(r.url()).pathname;
          if (r.method() !== "GET" && path.startsWith("/api/v1/organizations/"))
            mutations.push(path);
          if (r.method() === "GET" && path.endsWith("/scenario-comparisons"))
            reads++;
        });
        await page.goto("/");
        await page
          .getByLabel("Identifiant", { exact: true })
          .fill("studio_demo_admin");
        await page
          .getByLabel("Mot de passe", { exact: true })
          .fill(process.env.BRAIN_DEMO_PASSWORD);
        const auth = page.waitForResponse((r) =>
          new URL(r.url()).pathname.endsWith("/auth/login"),
        );
        await page
          .getByRole("button", { name: "Accéder au workspace" })
          .click();
        const token = (await (await auth).json()).access_token;
        const base = `/api/v1/organizations/${fixture.organization.id}`;
        if (!pairs[fixture.sector]) {
          const scenarios = await collection(page, `${base}/scenarios`, token);
          const runs = await collection(
            page,
            `${base}/optimization-runs`,
            token,
          );
          for (const scenario of scenarios) {
            if (
              scenario.source_model_version_id !== fixture.model.id ||
              scenario.document.kind !== "CONTROLLED_CHANGES"
            )
              continue;
            const run = runs.find(
              (r) => r.model_version_id === scenario.model_version_id,
            );
            if (!run) continue;
            const report = await get(
              page,
              `${base}/scenario-comparisons?baseline_run_id=${fixture.run.id}&candidate_run_id=${run.id}`,
              token,
            );
            if (
              report.comparability === "QUALIFIED" &&
              report.candidate?.verified_plan &&
              report.observed_objective_delta !== null &&
              report.observed_objective_delta !== "0"
            ) {
              pairs[fixture.sector] = {
                baseline: fixture.run.id,
                candidate: run.id,
                reportHash: report.report_hash,
                baselineValue: report.baseline.objective_value,
                candidateValue: report.candidate.objective_value,
                baselineHash: report.baseline.content_hash,
                candidateHash: report.candidate.content_hash,
              };
              break;
            }
          }
          if (!pairs[fixture.sector])
            throw new Error(
              "A stored verified controlled scenario is required",
            );
        }
        await page
          .locator(
            `#main-content a[href="/organizations/${fixture.organization.id}"]`,
          )
          .click();
        await page.getByTestId("active-organization").waitFor();
        await navigate(page, "Décisions & historique");
        await page
          .getByRole("link", {
            name: "Comparer deux résultats enregistrés",
            exact: true,
          })
          .click();
        const pair = pairs[fixture.sector];
        await page
          .getByLabel("Run de référence", { exact: true })
          .selectOption(pair.baseline);
        await page
          .getByLabel("Run de scénario candidat", { exact: true })
          .selectOption(pair.candidate);
        const result = page.waitForResponse((r) =>
          new URL(r.url()).pathname.endsWith("/scenario-comparisons"),
        );
        const count = reads,
          start = performance.now();
        await page
          .getByRole("button", { name: "Vérifier la comparaison", exact: true })
          .click();
        const response = await result;
        const report = await response.json();
        await page.getByTestId("scenario-comparison-result").waitFor();
        const displayMs = performance.now() - start;
        const timing = response.request().timing();
        const httpMs =
          timing.requestStart >= 0 && timing.responseEnd >= timing.requestStart
            ? timing.responseEnd - timing.requestStart
            : null;
        if (
          report.report_hash !== pair.reportHash ||
          report.objective_improvement !== null ||
          report.economic_gain !== null
        )
          throw new Error("Immutable comparison changed or claimed a gain");
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        if (repeat === 0) {
          await page
            .getByRole("heading", {
              name: "Qualification de la comparaison",
              exact: true,
            })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(output, `${fixture.sector}-comparison-${width}.png`),
          });
          await page
            .getByTestId("comparison-candidate-objective")
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(output, `${fixture.sector}-values-${width}.png`),
          });
        }
        await page.getByRole("switch", { name: "Mode expert" }).click();
        if (repeat === 0 && width === 1440) {
          await page
            .getByText("Provenance et vérification · Candidat", { exact: true })
            .click();
          await page
            .getByText("Provenance et vérification · Candidat", { exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(output, `${fixture.sector}-expert-${width}.png`),
          });
        }
        if (reads - count !== 1 || mutations.length)
          throw new Error("Comparison must perform one GET and no mutation");
        samples.push({
          sector: fixture.sector,
          width,
          repeat,
          displayMs,
          httpMs,
          comparisonReads: reads - count,
          domainMutations: mutations.length,
          overflow,
        });
        await page
          .getByRole("button", { name: "Déconnexion", exact: true })
          .click();
        await context.close();
      }
  await writeFile(
    join(output, "measurements.json"),
    JSON.stringify(
      {
        browser: browser.version(),
        node: process.version,
        protocol:
          "Production preview; 3 fresh contexts per sector/width; button-to-render latency includes automation/local HTTP; no INP or solver timing; read-only stored inputs pinned by hash; new feature has no pre-existing comparison baseline",
        pairs,
        samples,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ samples: samples.length, domainMutations: 0 }));
} finally {
  await browser.close();
}
