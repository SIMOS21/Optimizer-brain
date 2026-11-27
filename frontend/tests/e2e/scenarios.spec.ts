import { selectOrganization } from "./support/navigation";
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { factory, university } from "./support/fixtures";
import type { Scenario } from "../../src/api/types";

function startWorker() {
  if (!process.env.BRAIN_DATABASE_URL)
    throw new Error("Runtime database URL required");
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
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env,
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
for (const [sector, fixture, objective] of [
  ["factory", factory, "4100"],
  ["university", university, "17"],
] as const) {
  test(`${sector}: scénario isolé → publication → worker réel → résultat vérifié`, async ({
    page,
  }) => {
    if (!process.env.BRAIN_DEMO_PASSWORD)
      throw new Error("Synthetic demo password required");
    await page.goto("/");
    await page
      .getByLabel("Identifiant", { exact: true })
      .fill("studio_demo_admin");
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(process.env.BRAIN_DEMO_PASSWORD);
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    await selectOrganization(page, fixture.organization.id);
    await page.getByRole("link", { name: "Scénarios", exact: true }).click();
    await page
      .getByText("Créer un scénario identique (5B-1)", { exact: true })
      .click();
    await page
      .getByLabel("Modèle publié de référence")
      .selectOption(fixture.model.id);
    await page
      .getByLabel("Clé du scénario")
      .fill(`scenario_${sector}_${Date.now()}`);
    await page
      .getByLabel("Version du scénario")
      .fill(sector === "factory" ? " 1 " : "\u00851\u0085");
    await page
      .getByLabel("Nom du scénario")
      .fill(`Synthetic ${sector} identical clone`);
    await page
      .getByLabel("Justification du scénario")
      .fill("Validate isolation and existing governance");
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/scenarios"),
    );
    await page.getByRole("button", { name: "Créer la copie isolée" }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const record = (await response.json()) as Scenario;
    expect(record.version).toBe("1");
    expect(record.document.changes).toEqual([]);
    expect(record.source_model_version_id).toBe(fixture.model.id);
    expect(record.document.source_content_hash).toBe(
      fixture.model.content_hash,
    );
    expect(record.model_state).toBe("DRAFT");
    await expect(page.getByTestId("scenario-detail")).toContainText(
      "publié explicitement",
    );
    await page.getByTestId("scenario-model-link").click();
    await page.getByRole("button", { name: "Publier cette version" }).click();
    await page
      .getByRole("button", { name: "Confirmer la publication", exact: true })
      .click();
    await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Optimisation", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Modèle publié à exécuter", exact: true })
      .selectOption(record.model_version_id);
    await page
      .getByRole("button", { name: "Lancer l’optimisation", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Confirmer le lancement", exact: true })
      .getByRole("button", { name: "Confirmer le lancement", exact: true })
      .click();
    const worker = startWorker();
    try {
      await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED", {
        timeout: 30000,
      });
      await expect(page.getByTestId("recorded-objective")).toHaveText(
        objective,
      );
      await expect(page.getByTestId("independent-verification")).toContainText(
        "réussie",
      );
      await page.getByRole("link", { name: "Scénarios", exact: true }).click();
      await page
        .locator(
          `a[href="/organizations/${fixture.organization.id}/scenarios/${record.id}"]`,
        )
        .click();
      await expect(page.getByTestId("scenario-detail")).toContainText(
        "PUBLISHED",
      );
      await expect(page.getByTestId("scenario-detail")).toContainText(
        "Aucun gain économique n’est déduit de la création du scénario",
      );
      await expect(
        page.getByRole("link", {
          name: "Comparer des résultats vérifiés",
          exact: true,
        }),
      ).toHaveAttribute(
        "href",
        `/organizations/${fixture.organization.id}/history/compare`,
      );
      await expect(page.getByTestId("comparison-observed-delta")).toHaveCount(
        0,
      );
      await page.screenshot({
        path: `${process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots"}/scenario-${sector}.png`,
        fullPage: true,
      });
    } finally {
      await stopWorker(worker);
    }
  });
}
