import { readFileSync } from "node:fs";
import { join } from "node:path";
import type factoryReference from "../../fixtures/factory.json";
import type universityReference from "../../fixtures/university.json";
import { e2eEnvironment } from "./environment";

const directory = e2eEnvironment(process.env).fixtureDirectory;
// These are real responses exported by the dedicated E2E provisioner. The
// immutable checked-in fixtures used by Vitest are deliberately untouched.
export const factory = JSON.parse(
  readFileSync(join(directory, "factory.json"), "utf8"),
) as typeof factoryReference;
export const university = JSON.parse(
  readFileSync(join(directory, "university.json"), "utf8"),
) as typeof universityReference;
