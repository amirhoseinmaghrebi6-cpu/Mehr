/**
 * POST /internal/dev/report — development stand-in for a report from an ESP32 that no command
 * caused: a wall switch was pressed, or a sensor changed. Registered only when config.devRoutes is
 * true (NODE_ENV=development set explicitly); /internal is never proxied by the web app.
 */
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { reportDeviceState } from "../dev/hub-simulator";

const reportSchema = z.strictObject({
  deviceId: z.uuid(),
  capability: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
  value: z.union([z.boolean(), z.number(), z.string().max(64)]),
});

export function registerDevReportRoute(app: FastifyInstance, pool: Pool): void {
  app.post("/internal/dev/report", async (request, reply) => {
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { deviceId, capability, value } = parsed.data;
    const result = await reportDeviceState(pool, deviceId, capability, value);
    if (result === "unknown") return reply.code(404).send({ error: "not_found" });
    if (result === "invalid") return reply.code(400).send({ error: "invalid_request" });
    return reply.code(204).send();
  });
}
