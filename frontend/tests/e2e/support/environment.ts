/** Refuse accidental browser/worker tests against the user's demonstration. */
export function e2eEnvironment(env: Record<string, string | undefined>) {
  try {
    const database = new URL(env.BRAIN_DATABASE_URL || "");
    const studio = new URL(env.STUDIO_BASE_URL || "");
    const api = new URL(env.STUDIO_API_TARGET || "");
    if (
      env.STUDIO_E2E !== "1" ||
      database.protocol !== "postgresql+psycopg:" ||
      database.pathname !== "/optimizer_brain_e2e" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
      studio.origin !== "http://127.0.0.1:5181" ||
      api.origin !== "http://127.0.0.1:8002" ||
      studio.pathname !== "/" ||
      api.pathname !== "/" ||
      studio.username ||
      studio.password ||
      api.username ||
      api.password ||
      !env.STUDIO_E2E_FIXTURES_DIR
    )
      throw new Error("Invalid E2E boundary");
    return {
      baseURL: studio.origin,
      fixtureDirectory: env.STUDIO_E2E_FIXTURES_DIR,
    };
  } catch {
    // Never echo credentials from an invalid URL.
    throw new Error(
      "Tests E2E refusés : utiliser python -m scripts.studio_e2e avec la base dédiée et les ports 8002/5181.",
    );
  }
}
