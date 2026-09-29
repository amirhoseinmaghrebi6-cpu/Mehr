/**
 * Commands that no ESP32 confirmed before `expires_at` become "timed_out". Runs in every API
 * process; the update is idempotent, so several processes running it at once is harmless.
 */
import type { Pool } from "pg";
import { withSystemTx } from "../db/tx";

/** Marks expired open commands as timed out. Returns how many changed. */
export async function expireCommands(pool: Pool, limit = 500): Promise<number> {
  return withSystemTx(pool, async (tx) => {
    const { rows } = await tx.query<{ id: string; property_id: string; device_id: string }>(
      `update public.device_commands set status = 'timed_out', completed_at = now(), error_code = 'timeout'
       where id in (
         select id from public.device_commands
         where status in ('pending', 'sent') and expires_at <= now()
         order by expires_at
         limit $1
         for update skip locked
       )
       returning id, property_id, device_id`,
      [limit],
    );
    if (rows.length) {
      await tx.query(
        `insert into public.realtime_events (property_id, event_type, device_id, command_id, payload)
         select property_id, 'command.status_changed', device_id, id, '{"status":"timed_out"}'::jsonb
         from unnest($1::uuid[], $2::uuid[], $3::uuid[]) as expired (id, property_id, device_id)`,
        [rows.map((row) => row.id), rows.map((row) => row.property_id), rows.map((row) => row.device_id)],
      );
    }
    return rows.length;
  });
}

/** Runs expireCommands every `intervalMs` until stopped. Errors are logged, never thrown. */
export function startCommandExpiry(pool: Pool, log: { error: (object: object, message: string) => void }, intervalMs = 5_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    expireCommands(pool)
      .catch((error: Error) => log.error({ err: { message: error.message } }, "Command expiry failed"))
      .finally(() => (running = false));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
