import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Loads backend/.env.local (gitignored) into process.env when present. */
export function loadBackendEnv(): void {
  const envFile = resolve(__dirname, "../.env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
