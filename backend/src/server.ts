/**
 * M2smart API process. Owns the only application connection to PostgreSQL.
 *
 * Usage: pnpm api:dev (watch mode) or, after pnpm --filter @m2smart/api build, node dist/server.js
 */
import type { ApiErrorResponse } from "@m2smart/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerIdentityWebhook } from "./auth/identity-webhook";
import { followBoardStatus } from "./broker/board-status";
import { connectBroker, type Broker } from "./broker/broker";
import { startCommandBridge } from "./broker/command-bridge";
import { startCommandExpiry } from "./commands/expiry";
import { createKratosVerifier } from "./auth/kratos-verifier";
import { withSessionCache, type SessionVerifier } from "./auth/session-verifier";
import { ConfigError, loadConfig, type Config } from "./config";
import { assertSafeDatabaseRole, createPool, UnsafeDatabaseRoleError } from "./db/pool";
import { startBoardSimulator, type BoardSimulator } from "./dev/board-simulator";
import { loadBackendEnv } from "./env";
import { registerDeviceRoutes } from "./http/devices";
import { registerDevReportRoute } from "./http/dev-report";
import { registerDevSmsRoute } from "./http/dev-sms";
import { registerHealthRoutes } from "./http/health";
import { registerHomeRoutes } from "./http/homes";
import { registerMeRoute } from "./http/me";
import { registerScenarioRoutes } from "./http/scenarios";
import { registerSettingsRoutes } from "./http/settings";
import { startCleanup } from "./maintenance/cleanup";

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

  // Every error uses the API's error body. Client errors (malformed JSON, oversized body, wrong
  // content type) become invalid_request; anything else is logged and answered without details,
  // so database or internal messages never reach clients.
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number } | null)?.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: "invalid_request" } satisfies ApiErrorResponse);
    }
    request.log.error({ err: error }, "Request failed");
    return reply.code(500).send({ error: "internal_error" } satisfies ApiErrorResponse);
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" } satisfies ApiErrorResponse));

  registerHealthRoutes(app, pool);
  if (services.sessionVerifier) {
    registerMeRoute(app, pool, services.sessionVerifier);
    registerHomeRoutes(app, pool, services.sessionVerifier);
    registerDeviceRoutes(app, pool, services.sessionVerifier);
    registerSettingsRoutes(app, pool, services.sessionVerifier);
    registerScenarioRoutes(app, pool, services.sessionVerifier);
  }
  if (config.kratosWebhookSecret) registerIdentityWebhook(app, pool, config.kratosWebhookSecret);
  if (config.devRoutes) {
    registerDevSmsRoute(app);
    registerDevReportRoute(app, pool);
  }
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

  const stopExpiry = startCommandExpiry(pool, app.log);
  const stopCleanup = startCleanup(pool, app.log);

  // The boards' broker. If it is not reachable yet, the API still serves users and keeps trying.
  let broker: Broker | null = null;
  let brokerRetry: NodeJS.Timeout | null = null;
  let stopBridge: (() => void) | null = null;
  let simulator: BoardSimulator | null = null;
  const startBroker = async () => {
    if (!config.broker) return app.log.warn("MQTT_URL not set: no board connection; boards never come online.");
    try {
      broker = await connectBroker(config.broker, app.log);
      followBoardStatus(broker, pool, app.log);
      stopBridge = startCommandBridge(pool, broker, app.log);
      if (config.devBoardSimulator) {
        simulator = startBoardSimulator(pool, broker, config.broker.url, app.log);
        app.log.warn("Dev board simulator enabled: simulated ESP32 boards answer commands. Never enable in production.");
      }
    } catch (error) {
      app.log.error({ err: { message: (error as Error).message } }, "Cannot reach the MQTT broker; trying again in 5 s");
      brokerRetry = setTimeout(() => void startBroker(), 5_000);
    }
  };
  void startBroker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down: finishing in-flight requests, then closing the database pool");
    stopExpiry();
    stopCleanup();
    stopBridge?.();
    if (brokerRetry) clearTimeout(brokerRetry);
    try {
      await simulator?.stop();
      await broker?.close();
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
