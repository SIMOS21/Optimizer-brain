import { expect, it } from "vitest";
import { e2eEnvironment } from "./e2e/support/environment";

const valid = {
  BRAIN_DATABASE_URL:
    "postgresql+psycopg://brain_app:synthetic@127.0.0.1:55432/optimizer_brain_e2e",
  STUDIO_E2E: "1",
  STUDIO_BASE_URL: "http://127.0.0.1:5181",
  STUDIO_API_TARGET: "http://127.0.0.1:8002",
  STUDIO_E2E_FIXTURES_DIR: "/synthetic/fixtures",
};
it("requires the dedicated database and separate service ports", () => {
  expect(e2eEnvironment(valid).baseURL).toBe("http://127.0.0.1:5181");
});
it.each([
  {
    BRAIN_DATABASE_URL: valid.BRAIN_DATABASE_URL.replace(
      "optimizer_brain_e2e",
      "optimizer_brain_studio",
    ),
  },
  {
    BRAIN_DATABASE_URL: valid.BRAIN_DATABASE_URL.replace(
      "optimizer_brain_e2e",
      "optimizer_brain_test",
    ),
  },
  { STUDIO_BASE_URL: "http://127.0.0.1:5180" },
  { STUDIO_API_TARGET: "http://127.0.0.1:8001" },
  { STUDIO_E2E: "0" },
  { STUDIO_E2E_FIXTURES_DIR: "" },
  { BRAIN_DATABASE_URL: "private-invalid-url" },
])(
  "refuses unsafe test boundaries without reflecting secrets: %j",
  (change) => {
    expect(() => e2eEnvironment({ ...valid, ...change })).toThrow(
      "Tests E2E refusés",
    );
    expect(() => e2eEnvironment({ ...valid, ...change })).not.toThrow(
      "private-invalid-url",
    );
  },
);
