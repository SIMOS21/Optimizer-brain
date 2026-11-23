// Read-only authenticated navigation, fixed protocol on the dedicated E2E DB.
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const stage = process.argv[2];
if (!["before", "after"].includes(stage) || process.env.STUDIO_E2E !== "1" || new URL(process.env.BRAIN_DATABASE_URL).pathname !== "/optimizer_brain_e2e" || process.env.STUDIO_BASE_URL !== "http://127.0.0.1:5181") throw new Error("Dedicated E2E measurement required");
const factory = JSON.parse(await readFile(join(process.env.STUDIO_E2E_FIXTURES_DIR, "factory.json"), "utf8"));
const university = JSON.parse(await readFile(join(process.env.STUDIO_E2E_FIXTURES_DIR, "university.json"), "utf8"));
const output = join(root, ".local/ux-f1", stage);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const measurements = [];
try {
  for (const width of [1440, 390]) {
    for (let sample = 0; sample < 3; sample++) {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1040 : 844 } });
      const page = await context.newPage();
      let requests = 0;
      const mutations = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/v1")) {
          requests++;
          if (request.method() !== "GET" && !path.startsWith("/api/v1/auth/")) mutations.push(path);
        }
      });
      await page.goto(process.env.STUDIO_BASE_URL);
      await page.getByLabel("Identifiant", { exact: true }).fill("studio_demo_admin");
      await page.getByLabel("Mot de passe", { exact: true }).fill(process.env.BRAIN_DEMO_PASSWORD);
      const begin = performance.now();
      await page.getByRole("button", { name: "Accéder au workspace" }).click();
      const factoryLink = `a[href="/organizations/${factory.organization.id}"]`;
      await page.locator(factoryLink).first().waitFor({ state: "visible" });
      const pickerMs = performance.now() - begin;
      const loginRequests = requests;
      if (sample === 0) await page.screenshot({ path: join(output, `organizations-${width}.png`), fullPage: true });
      const openAt = performance.now();
      await page.locator(factoryLink).first().click();
      const recordedGraph = `#main-content a[href="/organizations/${factory.organization.id}/graphs/${factory.graph.id}"]`;
      await page.locator(recordedGraph).first().waitFor({ state: "visible" });
      const openOrganizationMs = performance.now() - openAt;
      const organizationRequests = requests - loginRequests;
      if (sample === 0) await page.screenshot({ path: join(output, `organization-${width}.png`), fullPage: true });
      const beforeWarm = requests;
      // Both versions keep these exact URLs. Mobile V2 opens its real menu.
      const graphsLink = page.locator(`nav a[href="/organizations/${factory.organization.id}/graphs"]`).first();
      if (!(await graphsLink.isVisible())) await page.getByRole("button", { name: "Ouvrir le menu" }).click();
      const warmAt = performance.now();
      await graphsLink.click();
      await page.getByRole("heading", { name: "La structure, rendue explicite." }).waitFor();
      const warmNavigationMs = performance.now() - warmAt;
      const warmRequests = requests - beforeWarm;
      const switchAt = performance.now();
      const oldSelect = page.locator("select").filter({ has: page.locator(`option[value="${university.organization.id}"]`) }).first();
      if (await oldSelect.count()) await oldSelect.selectOption(university.organization.id);
      else {
        await page.getByRole("button", { name: "Changer d’organisation" }).click();
        await page.getByRole("dialog").getByLabel("Rechercher une organisation").fill(university.organization.id);
        await page.getByRole("dialog").locator(`a[href="/organizations/${university.organization.id}"]`).click();
      }
      await page.locator(`#main-content a[href="/organizations/${university.organization.id}/graphs/${university.graph.id}"]`).first().waitFor({ state: "visible" });
      const switchOrganizationMs = performance.now() - switchAt;
      if (await page.locator(recordedGraph).count()) throw new Error("Previous tenant data displayed");
      if (mutations.length) throw new Error("Measurement caused a domain mutation");
      // Public immutable artefact identities establish comparable benchmark data.
      const digest = createHash("sha256").update(JSON.stringify([factory.graph.content_hash, factory.model.content_hash, factory.run.content_hash, university.graph.content_hash, university.model.content_hash, university.run.content_hash])).digest("hex");
      measurements.push({ width, sample, pickerMs, openOrganizationMs, warmNavigationMs, switchOrganizationMs, loginRequests, organizationRequests, warmRequests, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), referenceDigest: digest });
      await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
      await context.close();
    }
  }
  const result = { stage, browser: browser.version(), node: process.version, protocol: "three fresh contexts per viewport; UI navigation only; no domain mutations", measurements };
  await writeFile(join(output, "measurements.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
