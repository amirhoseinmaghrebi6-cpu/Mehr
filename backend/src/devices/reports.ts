/**
 * Storing what an ESP32 reported. Only the last value per capability is kept, with one exception:
 * an energy meter's running total becomes the home's hourly and daily use (energy_hourly for 7
 * days, energy_daily for 12 months; the cleanup job deletes older rows).
 */
import { capabilityValueError, type CapabilityValue } from "@m2smart/contracts";
import type { Pool } from "pg";
import { withSystemTx, type TxClient } from "../db/tx";
import { definitionFromRow } from "../http/devices";

/** More than any home uses between two reports of its meter (every 15 minutes, or after an outage). */
const MAX_STEP_KWH = 500;

/** Stores a reported value: the state, the device's liveness, an event, and a meter's use. */
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
  if (capability === "energy_kwh" && typeof value === "number") await addEnergy(tx, deviceId, value);
}

/**
 * Adds an energy meter's increase since its last report to this hour and to today (the home's
 * time zone). The first report only sets the starting point. A lower total means the meter
 * started again from zero, so the whole total counts. A step no home can use between two reports
 * (over 500 kWh) is a bad reading and counts as nothing. Other devices' totals (a socket's) are
 * not kept.
 */
async function addEnergy(tx: TxClient, deviceId: string, reading: number): Promise<void> {
  await tx.query(
    `with meter as (
       select device.id, device.property_id, property.time_zone,
         (select daily.last_reading_kwh from public.energy_daily as daily where daily.device_id = device.id order by daily.day desc limit 1) as previous
       from public.devices as device
       join public.properties as property on property.id = device.property_id
       where device.id = $1 and device.device_type = 'energy_meter'
     ), used as (
       select meter.*, case
         when previous is null then 0
         when $2 >= previous then $2 - previous
         else $2 end as step
       from meter
     ), counted as (
       select used.*, case when step > ${MAX_STEP_KWH} then 0 else step end as kwh from used
     ), daily as (
       insert into public.energy_daily (device_id, property_id, day, energy_kwh, last_reading_kwh)
       select id, property_id, (now() at time zone time_zone)::date, kwh, $2 from counted
       on conflict (device_id, day) do update set
         energy_kwh = public.energy_daily.energy_kwh + excluded.energy_kwh,
         last_reading_kwh = excluded.last_reading_kwh
     )
     insert into public.energy_hourly (device_id, property_id, hour, energy_kwh)
     select id, property_id, date_trunc('hour', now()), kwh from counted where kwh > 0
     on conflict (device_id, hour) do update set energy_kwh = public.energy_hourly.energy_kwh + excluded.energy_kwh`,
    [deviceId, reading],
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
