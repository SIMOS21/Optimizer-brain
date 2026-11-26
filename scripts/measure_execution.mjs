// Read-only production-build UX measurements, on secured immutable E2E references.
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const stage = process.argv[2];
if (!["before", "after"].includes(stage) || process.env.STUDIO_E2E !== "1" || new URL(process.env.BRAIN_DATABASE_URL).pathname !== "/optimizer_brain_e2e" || process.env.STUDIO_BASE_URL !== "http://127.0.0.1:5181") throw new Error("Isolated E2E execution measurement required");
const output = join(root, ".local/ux-f4", stage);
await mkdir(output, { recursive: true });
const fixtures = await Promise.all(["factory", "university"].map(async sector => ({ sector, ...JSON.parse(await readFile(join(process.env.STUDIO_E2E_FIXTURES_DIR, `${sector}.json`), "utf8")) })));
const identities = fixtures.map(f => ({ sector: f.sector, model: f.model.id, modelHash: f.model.content_hash, run: f.run.id, runHash: f.run.content_hash, snapshot: f.run.document.solve.data_snapshot_id }));
if (stage === "after") {
  const baseline = JSON.parse(await readFile(join(root, ".local/ux-f4/before/measurements.json"), "utf8"));
  if (JSON.stringify(baseline.identities) !== JSON.stringify(identities)) throw new Error("Reference identities changed");
}
const browser = await chromium.launch({ headless: true });
const measurements = [];
async function navigate(page, label) {
  const trigger = page.getByRole("button", { name: "Ouvrir le menu", exact: true });
  if (await trigger.isVisible()) {
    await trigger.click();
    await page.getByRole("dialog", { name: "Navigation de l’organisation" }).getByRole("link", { name: label, exact: true }).click();
  } else await page.getByRole("link", { name: label, exact: true }).click();
}
try {
  for (const width of [1440, 1280, 768, 390]) for (const fixture of fixtures) for (let sample = 0; sample < 3; sample++) {
    const context = await browser.newContext({ viewport: { width, height: 1040 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let requests = 0;
    const mutations = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1")) {
        requests++;
        if (request.method() !== "GET" && !path.startsWith("/api/v1/auth/")) mutations.push(path);
      }
    });
    await page.goto(process.env.STUDIO_BASE_URL);
    await page.getByLabel("Identifiant", { exact: true }).fill("studio_demo_admin");
    await page.getByLabel("Mot de passe", { exact: true }).fill(process.env.BRAIN_DEMO_PASSWORD);
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await page.locator(`#main-content a[href="/organizations/${fixture.organization.id}"]`).click();
    await page.getByTestId("active-organization").waitFor();
    let startRequests = requests;
    let started = performance.now();
    await navigate(page, "Optimisation");
    await page.getByRole("combobox", { name: "Modèle publié à exécuter", exact: true }).waitFor();
    const centerMs = performance.now() - started;
    const centerRequests = requests - startRequests;
    startRequests = requests;
    started = performance.now();
    await page.getByRole("combobox", { name: "Modèle publié à exécuter", exact: true }).selectOption(fixture.model.id);
    await page.getByRole("heading", { name: "Configurer la résolution", exact: true }).waitFor();
    const settingsMs = performance.now() - started;
    const settingsRequests = requests - startRequests;
    if (sample === 0) await page.screenshot({ path: join(output, `${fixture.sector}-center-${width}.png`), fullPage: true });
    await navigate(page, "Décisions & historique");
    await page.getByLabel("Résultat historique", { exact: true }).waitFor();
    startRequests = requests;
    started = performance.now();
    await page.getByLabel("Résultat historique", { exact: true }).selectOption(fixture.run.id);
    await page.getByTestId("recorded-objective").filter({ hasText: String(fixture.run.document.solve.objective_value) }).waitFor();
    const cockpitMs = performance.now() - started;
    const cockpitRequests = requests - startRequests;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (sample === 0) await page.screenshot({ path: join(output, `${fixture.sector}-cockpit-${width}.png`), fullPage: true });
    if (mutations.length) throw new Error("Measurement triggered a domain mutation");
    measurements.push({ sector: fixture.sector, width, sample, centerMs, centerRequests, settingsMs, settingsRequests, cockpitMs, cockpitRequests, overflow });
    await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
    await context.close();
  }
  await writeFile(join(output, "measurements.json"), JSON.stringify({ stage, browser: browser.version(), node: process.version, protocol: "Production preview; 3 fresh contexts per sector/width; UI latency including Playwright and network, not solver time or INP; read-only except authentication", identities, measurements }, null, 2));
  console.log(JSON.stringify({ stage, samples: measurements.length, domainMutations: 0 }));
} finally { await browser.close(); }
