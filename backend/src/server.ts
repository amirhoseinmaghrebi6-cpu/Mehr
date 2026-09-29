/**
 * M2smart API process. Owns the only application connection to PostgreSQL.
 *
 * Usage: pnpm api:dev (watch mode) or, after pnpm --filter @m2smart/api build, node dist/server.js
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerIdentityWebhook } from "./auth/identity-webhook";
import { createKratosVerifier } from "./auth/kratos-verifier";
import { withSessionCache, type SessionVerifier } from "./auth/session-verifier";
import { ConfigError, loadConfig, type Config } from "./config";
import { assertSafeDatabaseRole, createPool, UnsafeDatabaseRoleError } from "./db/pool";
import { loadBackendEnv } from "./env";
import { registerDevSmsRoute } from "./http/dev-sms";
import { registerHealthRoutes } from "./http/health";
import { registerMeRoute } from "./http/me";

export type ServerConfig = Pick<Config, "logLevel"> & Partial<Pick<Config, "devRoutes" | "kratosWebhookSecret">>;
export type ServerServices = {
  /** Required for authenticated routes (/v1/*); omitted in tests that only need health. */
  sessionVerifier?: SessionVerifier;
};

export function buildServer(config: ServerConfig, pool: Pool, services: ServerServices = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Defence in depth: request logs never include credentials, cookies or session data.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-session-token"]',
          'req.headers["x-webhook-secret"]',
          'res.headers["set-cookie"]',
        ],
        censor: "[redacted]",
      },
    },
  });

  registerHealthRoutes(app, pool);
  if (services.sessionVerifier) registerMeRoute(app, pool, services.sessionVerifier);
  if (config.kratosWebhookSecret) registerIdentityWebhook(app, pool, config.kratosWebhookSecret);
  if (config.devRoutes) registerDevSmsRoute(app);
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
  const sessionVerifier = withSessionCache(createKratosVerifier(config.kratosPublicUrl));
  const app = buildServer(config, pool, { sessionVerifier });
  logTarget = app;

  try {
    const role = await assertSafeDatabaseRole(pool);
    app.log.info({ role }, "Database role verified");
    if (!config.kratosWebhookSecret) app.log.warn("KRATOS_WEBHOOK_SECRET not set: identity webhook disabled; /v1/me still creates missing users.");
    if (config.devRoutes) app.log.warn("Development routes enabled (POST /internal/dev/sms logs SMS codes). Never enable in production.");
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
