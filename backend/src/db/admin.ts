/**
 * Superuser connection for platform tooling only: migrations, SQL tests and the dev seed.
 * The API never uses this; it connects as m2_api (Phase 2C).
 *
 * Reads backend/.env.local (gitignored) when present:
 *   DATABASE_ADMIN_URL          superuser URL of the target database (required)
 *   M2_API_DB_PASSWORD          optional login password applied to m2_api by the bootstrap
 *   M2_MIGRATOR_DB_PASSWORD     optional login password applied to m2_migrator by the bootstrap
 */
import { resolve } from "node:path";
import { Client } from "pg";
import { loadBackendEnv } from "../env";

export class ToolError extends Error {}

export const REPO_ROOT = resolve(__dirname, "../../..");

export async function connectAdmin(): Promise<Client> {
  loadBackendEnv();
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) {
    throw new ToolError("Missing DATABASE_ADMIN_URL. Set it in backend/.env.local (see backend/.env.example).");
  }
  const client = new Client({ connectionString, application_name: "m2smart-tooling" });
  await client.connect();
  return client;
}

export function runTool(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error instanceof ToolError ? `Blocked: ${error.message}` : error);
    process.exit(1);
  });
}
