/**
 * Commands and reports between the database and the boards, over the broker
 * (docs/board-protocol.md):
 *
 * - Sending: pending commands of boards that are online are marked "sent" and published. A
 *   command for an offline board stays pending; it goes out the moment the board is back, if it
 *   has not expired by then (commands/expiry.ts).
 * - Ack: the board started (acknowledged), or refuses (rejected, with its reason).
 * - State: every value that fits a capability the board really has is stored. A report that names
 *   a command completes it: "applied" if the board reached the target, "failed" if it reports
 *   something else. Nothing else ever marks a command applied.
 *
 * The board id comes from the topic, which the broker guarantees, and every lookup is limited to
 * that board, so a board can never report for, or complete a command of, another board.
 *
 * ponytail: every API process handles every message; the handling is idempotent, so that is only
 * wasted work. Use MQTT shared subscriptions if the API ever runs as many processes.
 */
import { boardAck, boardState, capabilityValueError, type CapabilityValue } from "@m2smart/contracts";
import type { Pool } from "pg";
import { withSystemTx, type TxClient } from "../db/tx";
import { storeReport } from "../devices/reports";
import { definitionFromRow } from "../http/devices";
import type { Broker } from "./broker";

type Log = { error: (object: object, message: string) => void };

type Outgoing = { id: string; board_id: string; channel_key: string; capability: string; target_value: CapabilityValue; ttl: number };

/** Marks up to `limit` pending commands of online boards as sent and returns them, oldest first. */
async function claimCommands(pool: Pool, limit: number): Promise<Outgoing[]> {
  return withSystemTx(pool, async (tx) => {
    const { rows } = await tx.query<Outgoing>(
      `with claimed as (
         update public.device_commands set status = 'sent', sent_at = now()
         where id in (
           select command.id from public.device_commands as command
           join public.devices as device on device.id = command.device_id
           join public.controllers as board on board.id = device.controller_id
           where command.status = 'pending' and command.expires_at > now() and board.online
           order by command.created_at, command.idempotency_key
           limit $1
           for update of command skip locked
         )
         returning id, device_id, capability, target_value, expires_at, created_at, idempotency_key
       )
       select claimed.id, device.controller_id as board_id, device.channel_key, claimed.capability, claimed.target_value,
         greatest(1, ceil(extract(epoch from claimed.expires_at - now())))::int as ttl
       from claimed join public.devices as device on device.id = claimed.device_id
       order by claimed.created_at, claimed.idempotency_key`,
      [limit],
    );
    return rows;
  });
}

async function commandEvent(tx: TxClient, commandId: string, status: string): Promise<void> {
  await tx.query(
    `insert into public.realtime_events (property_id, event_type, device_id, command_id, payload)
     select property_id, 'command.status_changed', device_id, id, jsonb_build_object('status', $2::text)
     from public.device_commands where id = $1`,
    [commandId, status],
  );
}

/** The board has the command and started, or refuses it. */
export async function handleAck(pool: Pool, boardId: string, payload: unknown): Promise<void> {
  const ack = boardAck.safeParse(payload);
  if (!ack.success) return;
  await withSystemTx(pool, async (tx) => {
    const ofThisBoard = "id = $1 and status = 'sent' and device_id in (select id from public.devices where controller_id = $2)";
    if (!ack.data.err) {
      await tx.query(`update public.device_commands set acknowledged_at = now() where ${ofThisBoard} and acknowledged_at is null`, [ack.data.id, boardId]);
      return;
    }
    const { rowCount } = await tx.query(
      `update public.device_commands set status = 'rejected', completed_at = now(), error_code = $3 where ${ofThisBoard}`,
      [ack.data.id, boardId, ack.data.err],
    );
    if (rowCount) await commandEvent(tx, ack.data.id, "rejected");
  });
}

type CapabilityOfBoard = {
  device_id: string;
  property_id: string;
  channel_key: string;
  capability: string;
  value_type: "boolean" | "integer" | "number" | "enum";
  min_value: string | null;
  max_value: string | null;
  enum_values: string[] | null;
  writable: boolean;
};

/** Values the board measured or reached; completes the command it names, if any. */
export async function handleState(pool: Pool, boardId: string, payload: unknown): Promise<void> {
  const state = boardState.safeParse(payload);
  if (!state.success) return;
  await withSystemTx(pool, async (tx) => {
    const { rows: known } = await tx.query<CapabilityOfBoard>(
      `select device.id as device_id, device.property_id, device.channel_key, capability.capability,
         capability.value_type, capability.min_value, capability.max_value, capability.enum_values, capability.writable
       from public.devices as device
       join public.device_capabilities as capability on capability.device_id = device.id
       where device.controller_id = $1`,
      [boardId],
    );
    const accepted: Array<{ deviceId: string; capability: string; value: CapabilityValue }> = [];
    for (const entry of state.data.values) {
      const target = known.find((row) => row.channel_key === entry.ch && row.capability === entry.cap);
      // Not a capability of this board, or a value that does not fit it: ignored.
      if (!target || capabilityValueError(definitionFromRow(target), entry.val) !== null) continue;
      await storeReport(tx, target.property_id, target.device_id, target.capability, entry.val);
      accepted.push({ deviceId: target.device_id, capability: target.capability, value: entry.val });
    }
    if (!state.data.id) return;

    const { rows } = await tx.query<{ device_id: string; capability: string; target_value: CapabilityValue }>(
      `select device_id, capability, target_value from public.device_commands
       where id = $1 and status = 'sent' and expires_at > now() and device_id in (select id from public.devices where controller_id = $2)
       for update`,
      [state.data.id, boardId],
    );
    const command = rows[0];
    const reported = command && accepted.find((entry) => entry.deviceId === command.device_id && entry.capability === command.capability);
    if (!command || !reported) return;
    if (reported.value === command.target_value) {
      await tx.query("update public.device_commands set status = 'applied', applied_at = now(), completed_at = now() where id = $1", [state.data.id]);
      await commandEvent(tx, state.data.id, "applied");
    } else {
      await tx.query("update public.device_commands set status = 'failed', completed_at = now(), error_code = 'not_reached' where id = $1", [state.data.id]);
      await commandEvent(tx, state.data.id, "failed");
    }
  });
}

/** Starts sending commands and handling acks and reports. Returns a function that stops the sending. */
export function startCommandBridge(pool: Pool, broker: Broker, log: Log, options: { pollMs?: number } = {}): () => void {
  const failed = (what: string) => (error: Error) => log.error({ err: { message: error.message } }, what);
  broker.on("ack", (boardId, payload) => void handleAck(pool, boardId, payload).catch(failed("Could not handle a board's ack")));
  broker.on("state", (boardId, payload) => void handleState(pool, boardId, payload).catch(failed("Could not handle a board's report")));

  let sending = false;
  const send = async () => {
    if (sending) return;
    sending = true;
    try {
      for (const command of await claimCommands(pool, 100)) {
        await broker.publish(command.board_id, "cmd", { id: command.id, ch: command.channel_key, cap: command.capability, val: command.target_value, ttl: command.ttl });
      }
    } catch (error) {
      failed("Could not send commands to boards")(error as Error);
    } finally {
      sending = false;
    }
  };
  const timer = setInterval(() => void send(), options.pollMs ?? 300);
  timer.unref();
  return () => clearInterval(timer);
}
