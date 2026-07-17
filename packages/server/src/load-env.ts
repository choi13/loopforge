import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load a repo-root .env into process.env before anything reads it.
 *
 * The .env file is gitignored and holds ANTHROPIC_API_KEY for the live
 * provider. Loading here (imported first in index.ts) means the key never has
 * to be passed on the command line. An already-set env var wins over the file.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../.."); // packages/server/src -> repo root
const envFile = path.join(repoRoot, ".env");

if (existsSync(envFile)) {
  // Node's built-in loader; does not override already-set vars.
  process.loadEnvFile(envFile);
}
