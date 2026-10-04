/** Storing what an ESP32 reported. Only the last value per capability is kept: no history. */
import { capabilityValueError, type CapabilityValue } from "@m2smart/contracts";
import type { Pool } from "pg";
import { withSystemTx, type TxClient } from "../db/tx";
import { definitionFromRow } from "../http/devices";

/** Stores a reported value: the state, the device's liveness and an event. */
export async function storeReport(tx: TxClient, propertyId: string, deviceId: string, capability: string, value: CapabilityValue): Promise<void> {
  await tx.query(
    `insert into public.device_states (property_id, device_id, capability, value, reported_at)
     values ($1, $2, $3, $4, now())
     on conflict (device_id, capability) do update set value = excluded.value, reported_at = excluded.reported_at, updated_at = now()`,
    [propertyId, deviceId, capability, JSON.stringify(value)],
  );
  await tx.query("update public.devices set online = true, last_seen_at = now() where id = $1", [deviceId]);
  await tx.query(
    `insert into public.realtime_events (property_id, event_type, device_id, payload)
     values ($1, 'device.state_changed', $2, jsonb_build_object('capability', $3::text, 'value', $4::jsonb))`,
    [propertyId, deviceId, capability, JSON.stringify(value)],
  );
}

/**
 * A report with no command, by device id (development stand-in for a wall-switch press or a
 * sensor change; real boards report over MQTT, see broker/command-bridge.ts). The value must fit
 * a capability the device has (writable or not).
 */
export async function reportDeviceState(pool: Pool, deviceId: string, capability: string, value: CapabilityValue): Promise<"stored" | "unknown" | "invalid"> {
  return withSystemTx(pool, async (tx) => {
    const { rows } = await tx.query<{ property_id: string; value_type: "boolean" | "integer" | "number" | "enum"; min_value: string | null; max_value: string | null; enum_values: string[] | null; writable: boolean }>(
      `select device.property_id, capability.value_type, capability.min_value, capability.max_value, capability.enum_values, capability.writable
       from public.devices as device
       join public.device_capabilities as capability on capability.device_id = device.id
       where device.id = $1 and capability.capability = $2`,
      [deviceId, capability],
    );
    if (!rows.length) return "unknown";
    if (capabilityValueError(definitionFromRow(rows[0]), value) !== null) return "invalid";
    await storeReport(tx, rows[0].property_id, deviceId, capability, value);
    return "stored";
  });
}
