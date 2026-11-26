import { expect, type Page } from "@playwright/test";

export async function selectOrganization(page: Page, id: string) {
  await page.getByRole("button", { name: "Changer d’organisation" }).click();
  const dialog = page.getByRole("dialog", { name: "Choisir une organisation" });
  await dialog.getByLabel("Rechercher une organisation").fill(id);
  await dialog.locator(`a[href="/organizations/${id}"]`).click();
}

export async function navigateOrganization(page: Page, destination: string) {
  const trigger = page.getByRole("button", {
    name: "Ouvrir le menu",
    exact: true,
  });
  if (await trigger.isVisible()) {
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Navigation de l’organisation",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("link", { name: destination, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  } else {
    await page.getByRole("link", { name: destination, exact: true }).click();
  }
}
