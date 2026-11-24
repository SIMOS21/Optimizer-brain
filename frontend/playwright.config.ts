import { defineConfig } from "@playwright/test";
import { e2eEnvironment } from "./tests/e2e/support/environment";

const environment = e2eEnvironment(process.env);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: environment.baseURL,
    headless: true,
    viewport: { width: 1440, height: 1040 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  reporter: "list",
});
