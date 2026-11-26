import { selectOrganization } from "./support/navigation";
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { factory, university } from "./support/fixtures";
import type { ChangePolicy, Scenario } from "../../src/api/types";

function startWorker() {
  if (!process.env.BRAIN_DATABASE_URL) throw new Error("Runtime URL required");
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

for (const [sector, fixture, parameter, low, high, proposed] of [
  ["factory", factory, "delivery_capacity_units", "40", "70", "45"],
  ["university", university, "room_slots", "1", "4", "1"],
] as const) {
  test(`${sector}: politique explicite → prévisualisation → publications → worker vérifié`, async ({
    page,
  }) => {
    if (!process.env.BRAIN_DEMO_PASSWORD)
      throw new Error("Synthetic password required");
    await page.goto("/");
    await page
      .getByLabel("Identifiant", { exact: true })
      .fill("studio_demo_admin");
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(process.env.BRAIN_DEMO_PASSWORD);
    const me = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith("/auth/me"),
    );
    await page.getByRole("button", { name: "Accéder au workspace" }).click();
    const user = (await (await me).json()) as { id: string };
    await selectOrganization(page, fixture.organization.id);
    await page.getByRole("link", { name: "Scénarios", exact: true }).click();
    await page
      .getByText("Nouvelle politique de changement", { exact: true })
      .click();
    await page
      .getByLabel("Référence de la politique")
      .selectOption(fixture.model.id);
    const editor = page.getByTestId("policy-editor");
    await editor.getByLabel("Cible autorisée").selectOption({
      label: `RESOURCE_CAPACITY · shared_parameters.${parameter}.value · unit`,
    });
    const suffix = `${sector}_${Date.now()}`;
    for (const [label, value] of [
      ["Clé de politique", `policy_${suffix}`],
      ["Version de politique", "1"],
      ["Nom de politique", `Synthetic ${suffix}`],
      ["Justification de politique", "Explicit synthetic hypothesis bounds"],
      ["Valeur minimale autorisée", low],
      ["Valeur maximale autorisée", high],
    ])
      await editor.getByLabel(label!).fill(value!);
    await editor.getByLabel("Domaine autorisé").selectOption("INTEGER");
    await expect(editor.getByLabel("Responsable nommé")).toHaveValue(user.id);
    await editor
      .getByRole("checkbox", { name: `${user.id} · ADMIN`, exact: true })
      .check();
    const policyResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/scenario-change-policies"),
    );
    await editor
      .getByRole("button", { name: "Créer la politique en brouillon" })
      .click();
    const createdPolicy = await policyResponse;
    expect(createdPolicy.status()).toBe(201);
    const policy = (await createdPolicy.json()) as ChangePolicy;
    const card = page.locator("article").filter({
      has: page.getByRole("heading", {
        name: `Synthetic ${suffix} · policy_${suffix} / 1`,
        exact: true,
      }),
    });
    await card
      .getByRole("button", { name: "Donner mon accord de responsable" })
      .click();
    await expect(card).toContainText(`Accords enregistrés : ${user.id}`);
    await card.getByRole("button", { name: "Publier la politique" }).click();
    await expect(card).toContainText("utilisable");
    await page
      .getByLabel("Politique publiée à utiliser")
      .selectOption(policy.id);
    const form = page.getByTestId("controlled-form");
    for (const [label, value] of [
      ["Clé du scénario contrôlé", `changed_${suffix}`],
      ["Version du scénario contrôlé", " 1 "],
      ["Nom du scénario contrôlé", `Controlled ${sector}`],
      ["Justification du scénario contrôlé", "Synthetic changed capacity"],
      ["Source des hypothèses", "synthetic_e2e"],
    ])
      await form.getByLabel(label!).fill(value!);
    const valueInput = form.getByLabel(
      "Valeur proposée · authorized_value (unit)",
      { exact: true },
    );
    await valueInput.fill("999");
    await form
      .getByRole("button", { name: "Prévisualiser les changements" })
      .click();
    await expect(form.getByRole("alert")).toContainText("bornes autorisées");
    await valueInput.fill(proposed);
    await form
      .getByRole("button", { name: "Prévisualiser les changements" })
      .click();
    await expect(page.getByTestId("change-preview")).toContainText(
      "Aucun calcul d’optimisation",
    );
    await expect(valueInput).toBeDisabled();
    const scenarioResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/controlled-scenarios"),
    );
    await form
      .getByRole("button", { name: "Confirmer la création contrôlée" })
      .click();
    const response = await scenarioResponse;
    expect(response.status()).toBe(201);
    const scenario = (await response.json()) as Scenario;
    expect(scenario.model_state).toBe("DRAFT");
    expect(scenario.document.kind).toBe("CONTROLLED_CHANGES");
    expect(scenario.document.data_snapshot_id).not.toBe(
      fixture.model.data_snapshot_id,
    );
    await page.getByTestId("scenario-graph-link").click();
    await page
      .getByRole("button", { name: "Publier cette version", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirmer la publication", exact: true })
      .click();
    await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Scénarios", exact: true }).click();
    await page
      .locator(
        `a[href="/organizations/${fixture.organization.id}/scenarios/${scenario.id}"]`,
      )
      .click();
    await page.getByTestId("scenario-model-link").click();
    await page
      .getByRole("button", { name: "Publier cette version", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirmer la publication", exact: true })
      .click();
    await expect(page.getByText("PUBLISHED", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Optimisation", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Modèle publié à exécuter", exact: true })
      .selectOption(scenario.model_version_id);
    await page
      .getByRole("button", { name: "Lancer l’optimisation", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Confirmer le lancement", exact: true }).getByRole("button", { name: "Confirmer le lancement", exact: true }).click();
    const worker = startWorker();
    try {
      await expect(page.getByTestId("job-state")).toHaveText("SUCCEEDED", {
        timeout: 30000,
      });
      await expect(page.getByTestId("independent-verification")).toContainText(
        "réussie",
      );
      // Assert an actual persisted, independently verified value; no invented new golden.
      await expect(page.getByTestId("recorded-objective")).not.toHaveText("");
      console.log(
        `${sector}: objectif réellement calculé et vérifié = ${await page.getByTestId("recorded-objective").textContent()}`,
      );
      await page.screenshot({
        path: `${process.env.STUDIO_SCREENSHOT_DIR || "test-results/screenshots"}/controlled-${sector}.png`,
        fullPage: true,
      });
    } finally {
      await stopWorker(worker);
    }
  });
}
