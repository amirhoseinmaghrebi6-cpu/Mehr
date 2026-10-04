/**
 * Storing what an ESP32 reported. Only the last value per capability is kept (no history), with
 * one exception: for energy meters, one total per device per day (device_energy_daily, at most a
 * year).
 */
import { capabilityValueError, type CapabilityValue } from "@m2smart/contracts";
import type { Pool } from "pg";
import { withSystemTx, type TxClient } from "../db/tx";
import { definitionFromRow } from "../http/devices";

/** Stores a reported value: the state, the device's liveness, an event, and the day's energy. */
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
  if (capability === "energy_kwh" && typeof value === "number") await addEnergy(tx, propertyId, deviceId, value);
}

/**
 * Adds the meter's increase since its last report to today's total (today in the home's time
 * zone). The first report ever only sets the starting point. A reading lower than the last one
 * means the meter restarted from zero, so the whole reading counts.
 */
async function addEnergy(tx: TxClient, propertyId: string, deviceId: string, reading: number): Promise<void> {
  await tx.query(
    `insert into public.device_energy_daily (device_id, property_id, day, energy_kwh, last_reading_kwh)
     select $2, $1, (now() at time zone property.time_zone)::date,
       case when previous.reading is null then 0 when $3 >= previous.reading then $3 - previous.reading else $3 end, $3
     from public.properties as property
     left join lateral (
       select last_reading_kwh as reading from public.device_energy_daily where device_id = $2 order by day desc limit 1
     ) as previous on true
     where property.id = $1
     on conflict (device_id, day) do update set
       energy_kwh = public.device_energy_daily.energy_kwh
         + case when excluded.last_reading_kwh >= public.device_energy_daily.last_reading_kwh
             then excluded.last_reading_kwh - public.device_energy_daily.last_reading_kwh
             else excluded.last_reading_kwh end,
       last_reading_kwh = excluded.last_reading_kwh`,
    [propertyId, deviceId, reading],
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
