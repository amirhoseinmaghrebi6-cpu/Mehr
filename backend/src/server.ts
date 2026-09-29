/**
 * M2smart API process. Owns the only application connection to PostgreSQL.
 *
 * Usage: pnpm api:dev (watch mode) or, after pnpm --filter @m2smart/api build, node dist/server.js
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { ConfigError, loadConfig, type Config } from "./config";
import { assertSafeDatabaseRole, createPool, UnsafeDatabaseRoleError } from "./db/pool";
import { loadBackendEnv } from "./env";
import { registerHealthRoutes } from "./http/health";

export function buildServer(config: Pick<Config, "logLevel">, pool: Pool): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Defence in depth: request logs never include credentials, cookies or session data.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
        censor: "[redacted]",
      },
    },
  });

  registerHealthRoutes(app, pool);
  return app;
}

async function main(): Promise<void> {
  loadBackendEnv();

  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`${error.message}\nSet these in backend/.env.local (see backend/.env.example).`);
      process.exit(1);
    }
    throw error;
  }

  // The pool logs through the server's structured logger, created right after it.
  let logTarget: FastifyInstance | undefined;
  const pool = createPool(config, { error: (object, message) => logTarget?.log.error(object, message) });
  const app = buildServer(config, pool);
  logTarget = app;

  try {
    const role = await assertSafeDatabaseRole(pool);
    app.log.info({ role }, "Database role verified");
  } catch (error) {
    const message = error instanceof UnsafeDatabaseRoleError ? error.message : `Cannot connect to PostgreSQL: ${(error as Error).message}`;
    app.log.fatal(message);
    await pool.end();
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down: finishing in-flight requests, then closing the database pool");
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "Shutdown failed");
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
}

if (require.main === module) {
  void main();
}
