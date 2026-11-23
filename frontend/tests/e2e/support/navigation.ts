import { type Page } from "@playwright/test";

export async function selectOrganization(page: Page, id: string) {
  await page.getByRole("button", { name: "Changer d’organisation" }).click();
  const dialog = page.getByRole("dialog", { name: "Choisir une organisation" });
  await dialog.getByLabel("Rechercher une organisation").fill(id);
  await dialog.locator(`a[href="/organizations/${id}"]`).click();
}
