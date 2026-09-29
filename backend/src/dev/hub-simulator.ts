/**
 * Development-only stand-in for the hub and the ESP32 boards, until the real hub (Phase 4) and
 * firmware (Phases 6–7) exist. Enabled only with NODE_ENV=development and
 * M2SMART_DEV_HUB_SIMULATOR=true; it never runs in production.
 *
 * It behaves like the real path will: it takes pending commands (marks them "sent"), waits for a
 * random network delay, marks them acknowledged (the ESP32 started, e.g. a door motor runs), waits
 * as long as the hardware would (a parking door takes tens of seconds), then "reports" the new
 * value from the ESP32. Only then is the command "applied" and the state stored, which is the rule for real
 * devices too. Interlocked relays (cooler low/high, curtain open/close) are inherent here: a
 * command sets a whole capability value (speed "low", curtain "open"), never two relays at once.
 *
 * Only simulated boards are handled: those whose hardware id starts with "DEV-" (created by
 * pnpm db:seed and pnpm dev:board). Anything else, such as the boards of API tests sharing the dev
 * database, is left alone.
 *
 * Wall-switch presses and sensor changes, which reach the cloud as reports without a command,
 * are simulated with reportDeviceState (POST /internal/dev/report, dev only).
 */
import { capabilityValueError, type CapabilityValue } from "@m2smart/contracts";
import type { Pool } from "pg";
import { withSystemTx, type TxClient } from "../db/tx";
import { definitionFromRow } from "../http/devices";

type Log = { info: (object: object, message: string) => void; error: (object: object, message: string) => void };

/** How long the simulated hardware takes to finish a command, by device type. */
const CONFIRM_DELAY_MS: Record<string, number> = { garage_door: 25_000, curtain: 20_000, cooler: 1_000, fan: 1_000 };
const DEFAULT_CONFIRM_DELAY_MS = 300;
/** Simulated network delay between the API, the hub and the ESP32 (each way), in ms. */
const NETWORK_DELAY_MS: [min: number, max: number] = [200, 1_200];

/** Hardware ids of simulated boards start with this. */
export const SIMULATED_BOARD_PREFIX = "DEV-";

type SentCommand = { id: string; property_id: string; device_id: string; capability: string; target_value: CapabilityValue; device_type: string | null };

/** Stores a value as reported by the ESP32: the state, the device's liveness and an event. */
async function storeReport(tx: TxClient, propertyId: string, deviceId: string, capability: string, value: CapabilityValue): Promise<void> {
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

/** Marks up to `limit` pending, unexpired commands of simulated boards as sent and returns them. */
export async function claimPendingCommands(pool: Pool, boardPrefix = SIMULATED_BOARD_PREFIX, limit = 50): Promise<SentCommand[]> {
  return withSystemTx(pool, async (tx) => {
    const { rows } = await tx.query<SentCommand>(
      `with claimed as (
         update public.device_commands set status = 'sent', sent_at = now()
         where id in (
           select command.id from public.device_commands as command
           join public.devices as device on device.id = command.device_id
           join public.controllers as board on board.id = device.controller_id
           where command.status = 'pending' and command.expires_at > now()
             and starts_with(board.hardware_uid, $2)
           order by command.created_at
           limit $1
           for update of command skip locked
         )
         returning id, property_id, device_id, capability, target_value
       )
       select claimed.*, device.device_type from claimed join public.devices as device on device.id = claimed.device_id`,
      [limit, boardPrefix],
    );
    return rows;
  });
}

/** The simulated ESP32 has the command and started carrying it out. */
export async function acknowledgeCommand(pool: Pool, commandId: string): Promise<void> {
  await withSystemTx(pool, (tx) =>
    tx.query("update public.device_commands set acknowledged_at = now() where id = $1 and status = 'sent' and acknowledged_at is null", [commandId]),
  );
}

/**
 * The simulated ESP32 reports the commanded value: stores it and marks the command applied.
 * Does nothing if the command is no longer "sent" (e.g. it timed out meanwhile).
 */
export async function confirmCommand(pool: Pool, command: SentCommand): Promise<boolean> {
  return withSystemTx(pool, async (tx) => {
    const { rows } = await tx.query(
      `update public.device_commands set status = 'applied', applied_at = now(), completed_at = now()
       where id = $1 and status = 'sent' and expires_at > now()
       returning id`,
      [command.id],
    );
    if (!rows.length) return false;
    await storeReport(tx, command.property_id, command.device_id, command.capability, command.target_value);
    await tx.query(
      `insert into public.realtime_events (property_id, event_type, device_id, command_id, payload)
       values ($1, 'command.status_changed', $2, $3, '{"status":"applied"}'::jsonb)`,
      [command.property_id, command.device_id, command.id],
    );
    return true;
  });
}

/**
 * A report with no command: a wall switch was pressed or a sensor changed. The value must fit a
 * capability the device has (writable or not).
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

export type HubSimulator = { stop: () => void };

export function startHubSimulator(
  pool: Pool,
  log: Log,
  options: { pollMs?: number; delays?: Record<string, number>; defaultDelayMs?: number; networkDelayMs?: [number, number]; boardPrefix?: string } = {},
): HubSimulator {
  const [networkMin, networkMax] = options.networkDelayMs ?? NETWORK_DELAY_MS;
  const networkDelay = () => networkMin + Math.random() * (networkMax - networkMin);
  const boardPrefix = options.boardPrefix ?? SIMULATED_BOARD_PREFIX;
  const pollMs = options.pollMs ?? 250;
  const delays = options.delays ?? CONFIRM_DELAY_MS;
  const defaultDelay = options.defaultDelayMs ?? DEFAULT_CONFIRM_DELAY_MS;
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) run();
    }, ms);
    timers.add(timer);
  };
  let polling = false;
  let stopped = false;

  const poll = async () => {
    if (polling || stopped) return;
    polling = true;
    try {
      for (const command of await claimPendingCommands(pool, boardPrefix)) {
        const fail = (error: Error) => log.error({ err: { message: error.message }, commandId: command.id }, "Dev hub simulator: command failed");
        // Network to the ESP32, which starts the hardware ...
        later(networkDelay(), () => {
          acknowledgeCommand(pool, command.id).catch(fail);
          // ... the hardware's own time, then the report travels back.
          later((delays[command.device_type ?? ""] ?? defaultDelay) + networkDelay(), () => void confirmCommand(pool, command).catch(fail));
        });
      }
    } catch (error) {
      log.error({ err: { message: (error as Error).message } }, "Dev hub simulator: poll failed");
    } finally {
      polling = false;
    }
  };

  // Simulated boards are always reachable.
  void withSystemTx(pool, async (tx) => {
    await tx.query("update public.controllers set online = true, last_seen_at = now() where starts_with(hardware_uid, $1)", [boardPrefix]);
    await tx.query(
      "update public.devices set online = true, last_seen_at = now() where controller_id in (select id from public.controllers where starts_with(hardware_uid, $1))",
      [boardPrefix],
    );
  }).catch((error: Error) => log.error({ err: { message: error.message } }, "Dev hub simulator: could not mark boards online"));

  const interval = setInterval(() => void poll(), pollMs);
  interval.unref();
  log.info({ pollMs }, "Dev hub simulator started: commands are confirmed by simulated ESP32 boards");

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
