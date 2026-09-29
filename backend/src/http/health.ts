import type { HealthResponse } from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

const READINESS_TIMEOUT_MS = 2_000;

async function databaseReady(pool: Pool): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), READINESS_TIMEOUT_MS);
  });
  const probe = pool.query("select 1").then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: FastifyInstance, pool: Pool): void {
  // Liveness: the process is running. Never checks dependencies, so a database outage does not
  // make an orchestrator restart a healthy process.
  app.get("/healthz", async (): Promise<HealthResponse> => ({ status: "ok" }));

  // Readiness: the process can serve requests right now.
  app.get("/readyz", async (request, reply): Promise<HealthResponse> => {
    const database = (await databaseReady(pool)) ? "ok" : "unavailable";
    if (database !== "ok") {
      request.log.warn("Readiness check failed: database unavailable");
      reply.code(503);
    }
    return { status: database, checks: { database } };
  });
}
