/**
 * The server keeps only the current state, never history (docs/plans/phase-4.md). This job deletes
 * what is past its time, in small batches so it never holds long locks:
 * - finished commands after 24 hours (their delivery attempts go with them);
 * - events after 1 hour (they exist only to tell open apps about a change);
 * - pairing codes that expired unused;
 * - one-time scenarios whose time and validity window have passed (commands they already sent
 *   stay until they finish);
 * - every scenario run except the latest of its scenario.
 *
 * Runs in every API process; deleting is idempotent, so several at once is harmless.
 */
import type { Pool } from "pg";
import { withSystemTx } from "../db/tx";

const BATCH = 5_000;

const RULES: Array<[name: string, sql: string]> = [
  ["commands", `delete from public.device_commands where id in (select id from public.device_commands where completed_at < now() - interval '24 hours' limit ${BATCH})`],
  ["events", `delete from public.realtime_events where id in (select id from public.realtime_events where created_at < now() - interval '1 hour' limit ${BATCH})`],
  ["pairings", "delete from public.board_pairings where expires_at <= now()"],
  [
    "one-time scenarios",
    `delete from public.scenarios as scenario using public.properties as property
     where property.id = scenario.property_id and scenario.kind = 'one_time'
       and ((scenario.local_date + scenario.local_time) at time zone property.time_zone)
         + make_interval(secs => greatest(scenario.late_window_seconds, 60)) < now() - interval '1 minute'`,
  ],
  [
    "scenario runs",
    `delete from public.scenario_runs as run
     where exists (select 1 from public.scenario_runs as newer where newer.scenario_id = run.scenario_id and newer.created_at > run.created_at)`,
  ],
];

/** Deletes one batch of everything that is past its time. Returns how many rows went, by kind. */
export async function cleanUp(pool: Pool): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const [name, sql] of RULES) {
    deleted[name] = await withSystemTx(pool, async (tx) => (await tx.query(sql)).rowCount ?? 0);
  }
  return deleted;
}

/** Runs cleanUp every `intervalMs` until stopped. Errors are logged, never thrown. */
export function startCleanup(pool: Pool, log: { error: (object: object, message: string) => void }, intervalMs = 10 * 60_000): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    cleanUp(pool)
      .catch((error: Error) => log.error({ err: { message: error.message } }, "Cleanup failed"))
      .finally(() => (running = false));
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
