/**
 * GET /v1/properties/:propertyId/activity: the home's commands of the last 24 hours, newest first
 * (at most 100), with who asked or which scenario ran them. Any member may read it. Current alerts
 * (a leak, smoke, an offline board) come from the devices themselves, not from here.
 */
import type { ActivityEntry, ActivityResponse, CapabilityName, CapabilityValue, CommandStatus } from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import { createHandler, requireAction } from "./route-helpers";

type ActivityRow = {
  id: string;
  device_id: string;
  device_name: string;
  capability: CapabilityName;
  target_value: CapabilityValue;
  status: CommandStatus;
  created_at: Date;
  completed_at: Date | null;
  requested_by_name: string | null;
  scenario_name: string | null;
};

export function registerActivityRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  const handle = createHandler(pool, verifier);
  app.get<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/activity", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<ActivityResponse> => {
      await requireAction(tx, request.params.propertyId, "property.view");
      const { rows } = await tx.query<ActivityRow>("select * from public.property_activity($1)", [request.params.propertyId]);
      return {
        entries: rows.map(
          (row): ActivityEntry => ({
            id: row.id,
            deviceId: row.device_id,
            deviceName: row.device_name,
            capability: row.capability,
            targetValue: row.target_value,
            status: row.status,
            createdAt: row.created_at.toISOString(),
            completedAt: row.completed_at?.toISOString() ?? null,
            requestedBy: row.requested_by_name,
            scenario: row.scenario_name,
          }),
        ),
      };
    }),
  );
}
