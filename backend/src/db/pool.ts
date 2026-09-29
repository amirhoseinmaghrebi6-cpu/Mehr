import { Pool } from "pg";
import type { Config } from "../config";

export type Logger = { error: (object: object, message: string) => void };

/** The API's only application connection to PostgreSQL, logged in as m2_api. */
export function createPool(config: Pick<Config, "databaseUrl" | "databasePoolMax">, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    application_name: "m2smart-api",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on("error", (error) => logger.error({ err: { message: error.message } }, "Idle database connection failed"));
  return pool;
}

export class UnsafeDatabaseRoleError extends Error {}

/**
 * Refuses to serve traffic as a role that could bypass row-level security. The API must log in
 * as m2_api (NOINHERIT, not superuser, no BYPASSRLS) and gain rights only via withUserTx /
 * withSystemTx.
 */
export async function assertSafeDatabaseRole(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolinherit: boolean }>(
    "select rolname, rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = current_user",
  );
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.rolinherit) {
    throw new UnsafeDatabaseRoleError(
      `DATABASE_URL logs in as "${role?.rolname ?? "unknown"}", which can bypass row-level security. Use the m2_api role.`,
    );
  }
  return role.rolname;
}
