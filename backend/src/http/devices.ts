/**
 * Devices and commands of a home:
 *   GET   /v1/properties/:propertyId/devices
 *   PATCH /v1/properties/:propertyId/devices/:deviceId          (rename, move to a room)
 *   POST  /v1/properties/:propertyId/commands                   (absolute target value)
 *   GET   /v1/properties/:propertyId/commands/:commandId
 *
 * A command is only a request: it is "applied" once the ESP32 reports the value (over MQTT, see
 * broker/command-bridge.ts; simulated boards in development). Commands nobody confirms in time become
 * "timed_out" (commands/expiry.ts). Only board devices (with a catalog type) are listed; Phase 1
 * devices without a board are not part of the product.
 *
 * Access rules and error handling: see route-helpers.ts.
 */
import {
  capabilityValueError,
  createCommandRequest,
  finalCommandStatuses,
  isCapabilityName,
  updateDeviceRequest,
  type CapabilityDefinition,
  type CapabilityName,
  type CapabilityState,
  type CapabilityValue,
  type Command,
  type CommandStatus,
  type Device,
  type DeviceListResponse,
  type DeviceType,
} from "@m2smart/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SessionVerifier } from "../auth/session-verifier";
import type { TxClient } from "../db/tx";
import { createHandler, HttpError, invalidRequest, notFound, parse, requireAction, requireUuid, withStatus } from "./route-helpers";

/** Open (pending or sent) commands allowed per device, so one client cannot flood a hub. */
export const MAX_OPEN_COMMANDS_PER_DEVICE = 20;

type CapabilityRow = {
  value_type: "boolean" | "integer" | "number" | "enum";
  min_value: string | null;
  max_value: string | null;
  enum_values: string[] | null;
  writable: boolean;
};

/** The stored capability as a contracts definition, for capabilityValueError. */
export function definitionFromRow(row: CapabilityRow): CapabilityDefinition {
  if (row.value_type === "enum") return { valueType: "enum", values: row.enum_values ?? [], writable: row.writable };
  if (row.value_type === "boolean") return { valueType: "boolean", writable: row.writable };
  return {
    valueType: row.value_type,
    writable: row.writable,
    ...(row.min_value === null ? {} : { min: Number(row.min_value) }),
    ...(row.max_value === null ? {} : { max: Number(row.max_value) }),
  };
}

type DeviceRow = {
  id: string;
  name: string;
  device_type: DeviceType;
  room_id: string | null;
  online: boolean;
  last_seen_at: Date | null;
  capabilities: Array<{ capability: string; writable: boolean; value: CapabilityValue | null; reportedAt: string | null }>;
};

const DEVICE_SELECT = `
  select device.id, device.name, device.device_type, device.room_id, device.online, device.last_seen_at,
    coalesce(
      json_agg(
        json_build_object('capability', capability.capability, 'writable', capability.writable, 'value', state.value, 'reportedAt', state.reported_at)
        order by capability.capability
      ) filter (where capability.capability is not null),
      '[]'
    ) as capabilities
  from public.devices as device
  left join public.device_capabilities as capability on capability.device_id = device.id
  left join public.device_states as state on state.device_id = capability.device_id and state.capability = capability.capability
  where device.property_id = $1 and device.device_type is not null`;

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    type: row.device_type,
    roomId: row.room_id,
    online: row.online,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    capabilities: row.capabilities
      .filter((entry): entry is typeof entry & { capability: CapabilityName } => isCapabilityName(entry.capability))
      .map((entry): CapabilityState => ({
        capability: entry.capability,
        writable: entry.writable,
        value: entry.value,
        reportedAt: entry.reportedAt ? new Date(entry.reportedAt).toISOString() : null,
      })),
  };
}

type CommandRow = {
  id: string;
  device_id: string;
  capability: CapabilityName;
  target_value: CapabilityValue;
  status: CommandStatus;
  acknowledged_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
  error_code: string | null;
};
const COMMAND_COLUMNS = "id, device_id, capability, target_value, status, acknowledged_at, created_at, completed_at, expires_at, error_code";

/** An open command past its expiry is reported as timed out even before the expiry job stores it. */
function toCommand(row: CommandRow, now = new Date()): Command {
  const expired = !finalCommandStatuses.includes(row.status) && row.expires_at <= now;
  return {
    id: row.id,
    deviceId: row.device_id,
    capability: row.capability,
    targetValue: row.target_value,
    status: expired ? "timed_out" : row.status,
    acknowledgedAt: row.acknowledged_at ? row.acknowledged_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    completedAt: expired ? row.expires_at.toISOString() : row.completed_at ? row.completed_at.toISOString() : null,
    errorCode: expired ? "timeout" : row.error_code,
  };
}

async function loadDevice(tx: TxClient, propertyId: string, deviceId: string): Promise<Device> {
  const { rows } = await tx.query<DeviceRow>(`${DEVICE_SELECT} and device.id = $2 group by device.id`, [propertyId, deviceId]);
  if (!rows.length) throw notFound();
  return toDevice(rows[0]);
}

export function registerDeviceRoutes(app: FastifyInstance, pool: Pool, verifier: SessionVerifier): void {
  const handle = createHandler(pool, verifier);

  app.get<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/devices", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<DeviceListResponse> => {
      await requireAction(tx, request.params.propertyId, "property.view");
      const { rows } = await tx.query<DeviceRow>(`${DEVICE_SELECT} group by device.id order by device.name, device.id`, [request.params.propertyId]);
      return { devices: rows.map(toDevice) };
    }),
  );

  app.patch<{ Params: { propertyId: string; deviceId: string } }>("/v1/properties/:propertyId/devices/:deviceId", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<Device> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "device.edit");
      const deviceId = requireUuid(request.params.deviceId);
      const body = parse(updateDeviceRequest, request.body);
      if (body.roomId) {
        // A room of another home is simply not found.
        const room = await tx.query("select 1 from public.rooms where id = $1 and property_id = $2", [requireUuid(body.roomId), propertyId]);
        if (!room.rows.length) throw notFound();
      }
      const { rowCount } = await tx.query(
        `update public.devices set
           name = coalesce($3, name),
           room_id = case when $4::boolean then $5::uuid else room_id end
         where id = $2 and property_id = $1 and device_type is not null`,
        [propertyId, deviceId, body.name ?? null, body.roomId !== undefined, body.roomId ?? null],
      );
      if (!rowCount) throw notFound();
      return loadDevice(tx, propertyId, deviceId);
    }),
  );

  app.post<{ Params: { propertyId: string } }>("/v1/properties/:propertyId/commands", (request, reply) =>
    handle(request, reply, 201, async (tx) => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "device.control");
      const body = parse(createCommandRequest, request.body);

      const { rows: capabilities } = await tx.query<CapabilityRow & { device_type: DeviceType }>(
        `select capability.value_type, capability.min_value, capability.max_value, capability.enum_values, capability.writable, device.device_type
         from public.device_capabilities as capability
         join public.devices as device on device.id = capability.device_id
         where device.id = $1 and device.property_id = $2 and device.device_type is not null and capability.capability = $3`,
        [body.deviceId, propertyId, body.capability],
      );
      if (!capabilities.length) {
        const device = await tx.query("select 1 from public.devices where id = $1 and property_id = $2 and device_type is not null", [body.deviceId, propertyId]);
        throw device.rows.length ? invalidRequest() : notFound();
      }
      const definition = definitionFromRow(capabilities[0]);
      if (!definition.writable || capabilityValueError(definition, body.targetValue) !== null) throw invalidRequest();
      // A camera records only while it is on (the ESP32 enforces this too).
      if (capabilities[0].device_type === "camera" && body.capability === "recording" && body.targetValue === true) {
        const power = await tx.query<{ value: unknown }>("select value from public.device_states where device_id = $1 and capability = 'power'", [body.deviceId]);
        if (power.rows[0]?.value !== true) throw new HttpError(409, "conflict");
      }

      // The same idempotency key returns the original command (a retried request), unless it was
      // used for a different command.
      const original = async () => {
        const { rows } = await tx.query<CommandRow>(
          `select ${COMMAND_COLUMNS} from public.device_commands where property_id = $1 and idempotency_key = $2`,
          [propertyId, body.idempotencyKey],
        );
        if (!rows.length) return null;
        const same = rows[0].device_id === body.deviceId && rows[0].capability === body.capability && rows[0].target_value === body.targetValue;
        if (!same) throw new HttpError(409, "conflict");
        return withStatus(200, toCommand(rows[0]));
      };
      const retried = await original();
      if (retried) return retried;

      const { rows: open } = await tx.query<{ count: string }>(
        "select count(*) from public.device_commands where device_id = $1 and status in ('pending', 'sent') and expires_at > now()",
        [body.deviceId],
      );
      if (Number(open[0].count) >= MAX_OPEN_COMMANDS_PER_DEVICE) throw new HttpError(409, "conflict");

      // A concurrent request with the same key may have inserted first: then return its command.
      const { rows } = await tx.query<CommandRow>(
        `insert into public.device_commands (property_id, device_id, capability, target_value, idempotency_key)
         values ($1, $2, $3, $4, $5)
         on conflict (property_id, idempotency_key) do nothing
         returning ${COMMAND_COLUMNS}`,
        [propertyId, body.deviceId, body.capability, JSON.stringify(body.targetValue), body.idempotencyKey],
      );
      if (rows.length) return toCommand(rows[0]);
      const concurrent = await original();
      if (!concurrent) throw new HttpError(409, "conflict");
      return concurrent;
    }),
  );

  app.get<{ Params: { propertyId: string; commandId: string } }>("/v1/properties/:propertyId/commands/:commandId", (request, reply) =>
    handle(request, reply, 200, async (tx): Promise<Command> => {
      const { propertyId } = request.params;
      await requireAction(tx, propertyId, "property.view");
      const { rows } = await tx.query<CommandRow>(
        `select ${COMMAND_COLUMNS} from public.device_commands where id = $1 and property_id = $2`,
        [requireUuid(request.params.commandId), propertyId],
      );
      if (!rows.length) throw notFound();
      return toCommand(rows[0]);
    }),
  );
}
