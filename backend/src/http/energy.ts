/**
 * GET /v1/properties/:propertyId/energy: the home's energy use by hour (7 days) and by day (12
 * months), all its meters added together. Any member may read it.
 */
import type { EnergyResponse } from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import { createHandler, requireAction } from "./route-helpers";

export function registerEnergyRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  const handle = createHandler(pool, verifier);
  app.get<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/energy", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<EnergyResponse> => {
      const propertyId = request.params.propertyId;
      await requireAction(tx, propertyId, "property.view");
      const hours = await tx.query<{ start: Date; kwh: string }>(
        `select hour as start, sum(energy_kwh) as kwh from public.energy_hourly
         where property_id = $1 and hour >= date_trunc('hour', now()) - interval '7 days'
         group by hour order by hour`,
        [propertyId],
      );
      const days = await tx.query<{ start: string; kwh: string }>(
        `select to_char(day, 'YYYY-MM-DD') as start, sum(energy_kwh) as kwh from public.energy_daily
         where property_id = $1 and day > current_date - 366 and energy_kwh > 0
         group by day order by day`,
        [propertyId],
      );
      return {
        hours: hours.rows.map((row) => ({ start: row.start.toISOString(), kwh: Number(row.kwh) })),
        days: days.rows.map((row) => ({ start: row.start, kwh: Number(row.kwh) })),
      };
    }),
  );
}
